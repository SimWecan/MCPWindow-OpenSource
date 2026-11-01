import { useStore } from '../store/useStore'
import type { MCPServer } from '../types'
import { bridge } from './bridge'
import { operateServer } from './control'
import { buildManagedCredentialPayload, generateLocalKey } from './credential'
import { canManage, manageRequest, syncManagedServer } from './management'

function objectArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是 JSON 对象')
  return args as Record<string, unknown>
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少参数 ${key}`)
  return value.trim()
}

function serverSummary(server: MCPServer) {
  const state = useStore.getState()
  return {
    id: server.id, name: server.name, partitionId: server.partitionId,
    transport: server.transport, status: server.status,
    liveStatus: state.liveStatus[server.id] ?? 'unknown', archived: server.archived,
    managed: canManage(server),
  }
}

function findServer(id: string): MCPServer {
  const server = useStore.getState().servers.find((item) => item.id === id && !item.archived)
  if (!server) throw new Error('服务器不存在或已归档')
  return server
}

/** 仅暴露给经过主进程权限校验的插件；参数校验和真实状态变更复用产品逻辑。 */
export async function executePluginHostAction(action: string, input: unknown): Promise<unknown> {
  const args = objectArgs(input)
  const state = useStore.getState()
  if (action === 'servers.list') return { servers: state.servers.filter((server) => !server.archived).map(serverSummary) }
  if (action === 'servers.status') return serverSummary(findServer(requiredString(args, 'serverId')))
  if (action === 'partitions.list') {
    return { partitions: state.partitions.filter((partition) => !partition.archived).map((partition) => ({
      id: partition.id, name: partition.name, description: partition.description,
      kind: partition.kind, managedBy: partition.managedBy ?? null, rootPath: partition.rootPath ?? null,
    })) }
  }
  if (action === 'credentials.list') {
    return { credentials: state.credentials.map((credential) => ({
      id: credential.id, name: credential.name, keyPrefix: credential.keyPrefix,
      partitionIds: credential.scopes, enabled: credential.enabled,
      rateLimitPerMin: credential.rateLimitPerMin, expiresAt: credential.expiresAt,
      managedBy: credential.managedBy ?? null, role: credential.role ?? null,
    })) }
  }
  if (action === 'servers.operate') {
    const server = findServer(requiredString(args, 'serverId'))
    const operation = requiredString(args, 'action')
    if (!['start', 'stop', 'restart'].includes(operation)) throw new Error('action 仅支持 start、stop、restart')
    await operateServer(server, operation as 'start' | 'stop' | 'restart')
    return { ok: true, server: serverSummary(findServer(server.id)) }
  }
  if (action === 'partitions.create') {
    const partitionName = requiredString(args, 'name')
    const description = typeof args.description === 'string' ? args.description.trim() : ''
    if (args.serverId) {
      const manager = findServer(requiredString(args, 'serverId'))
      const rootPath = requiredString(args, 'rootPath')
      await manageRequest(manager, '/partitions', 'POST', { name: partitionName, path: rootPath })
      await syncManagedServer(manager)
      const partition = useStore.getState().partitions.find((item) => item.managedBy === manager.id && item.remoteName === partitionName)
      return { ok: true, partition }
    }
    if (state.partitions.some((item) => !item.archived && !item.managedBy && item.name.trim().toLowerCase() === partitionName.toLowerCase())) {
      throw new Error('同名本地分区已存在')
    }
    const color = typeof args.color === 'string' && /^#[0-9a-f]{6}$/i.test(args.color) ? args.color : '#4f8dff'
    const kind = args.kind === 'project' ? 'project' : 'business'
    state.addPartition({ name: partitionName, description, color, kind })
    return { ok: true, partition: useStore.getState().partitions.slice(-1)[0] }
  }
  if (action === 'partitions.delete') {
    const id = requiredString(args, 'partitionId')
    const partition = state.partitions.find((item) => item.id === id)
    if (!partition) throw new Error('分区不存在')
    if (partition.managedBy) {
      const manager = findServer(partition.managedBy)
      await manageRequest(manager, `/partitions/${encodeURIComponent(partition.remoteName ?? partition.name)}`, 'DELETE')
      await syncManagedServer(manager)
    } else state.deletePartition(id)
    return { ok: true, partitionId: id }
  }
  if (action === 'credentials.issue') {
    const credentialName = requiredString(args, 'name')
    const partitionIds = args.partitionIds
    if (!Array.isArray(partitionIds) || partitionIds.length === 0 || !partitionIds.every((id) => typeof id === 'string')) {
      throw new Error('partitionIds 必须是非空字符串数组')
    }
    const partitions = partitionIds.map((id) => {
      const partition = state.partitions.find((item) => item.id === id && !item.archived)
      if (!partition) throw new Error(`分区不存在：${id}`)
      return partition
    })
    const role = args.role === 'write' ? 'write' : 'read'
    const rateLimitPerMin = Math.max(1, Math.floor(Number(args.rateLimitPerMin) || 120))
    const expiresDays = Math.max(0, Math.floor(Number(args.expiresDays) || 0))
    if (args.serverId) {
      const manager = findServer(requiredString(args, 'serverId'))
      if (partitions.some((partition) => partition.managedBy !== manager.id)) throw new Error('远程凭证的分区必须属于同一管理服务器')
      const payload = buildManagedCredentialPayload(
        { name: credentialName, scopes: partitionIds, role, rateLimitPerMin, expiresDays, enabled: true },
        (id) => partitions.find((partition) => partition.id === id)?.remoteName ?? '',
        { editing: false, expiryTouched: true, preserveGlobalRole: false },
      )
      const result = await manageRequest<{ key: string }>(manager, '/credentials', 'POST', payload)
      await syncManagedServer(manager)
      return { ok: true, key: result.key, warning: '完整凭证仅返回一次，请立即保存' }
    }
    const key = generateLocalKey()
    state.addCredential({
      name: credentialName, scopes: partitionIds, rateLimitPerMin, enabled: true,
      expiresAt: expiresDays > 0 ? Date.now() + expiresDays * 86400_000 : null,
    }, key)
    return { ok: true, key, credential: useStore.getState().credentials.slice(-1)[0], warning: '完整凭证仅返回一次，请立即保存' }
  }
  if (action === 'credentials.revoke') {
    const id = requiredString(args, 'credentialId')
    const credential = state.credentials.find((item) => item.id === id)
    if (!credential) throw new Error('凭证不存在')
    if (credential.managedBy) {
      const manager = findServer(credential.managedBy)
      await manageRequest(manager, `/credentials/${encodeURIComponent(credential.keyPrefix)}`, 'DELETE')
      await syncManagedServer(manager)
    } else state.deleteCredential(id)
    return { ok: true, credentialId: id }
  }
  throw new Error('不支持的 MCPWindow 插件宿主操作')
}

export function registerPluginHost(): () => void {
  const api = bridge()
  if (!api?.onPluginHostCall || !api.pluginHostResult) return () => undefined
  return api.onPluginHostCall((id, action, args) => {
    void executePluginHostAction(action, args)
      .then((result) => api.pluginHostResult!(id, true, result))
      .catch((error) => api.pluginHostResult!(id, false, undefined, error instanceof Error ? error.message : String(error)))
  })
}
