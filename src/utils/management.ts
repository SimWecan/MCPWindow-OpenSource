import { useStore } from '../store/useStore'
import type { Credential, MCPServer, Partition } from '../types'
import { bridge } from './bridge'
import { probeServer } from './probe'

export interface ManagedPartition {
  name: string
  path: string
}

export interface ManagedCredential {
  key_prefix: string
  name: string
  role?: 'read' | 'write' | 'admin'
  grants: Record<string, 'read' | 'write'>
  enabled: boolean
  created_at?: string
  expires_at?: string | null
  last_used_at?: string | null
  rate_limit_per_min: number
}

export interface ManagedStatus {
  ok: true
  service: string
  status: 'running' | 'stopped'
  pid: number | null
  started_at: number | null
  partitions: ManagedPartition[]
  credentials: ManagedCredential[]
}

export class ManagementError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
    this.name = 'ManagementError'
  }
}

export const canManage = (server: MCPServer): boolean =>
  Boolean(server.managementUrl?.trim() && server.managementKey?.trim())

function endpoint(server: MCPServer, path: string): string {
  const base = (server.managementUrl ?? '').trim().replace(/\/+$/, '').replace(/\/manage$/, '')
  const url = new URL(base)
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol)) throw new ManagementError('管理接口必须是 http(s) 地址')
  if (url.protocol === 'http:' && !loopback) throw new ManagementError('非本机管理接口必须使用 HTTPS')
  if (/\/mcp\/?$/i.test(url.pathname)) {
    throw new ManagementError('管理接口指向 MCP 连接端点（/mcp），不是 /manage 管理端；TerraFin 本机请改为 http://127.0.0.1:8091')
  }
  return `${base}/manage${path}`
}

/** 桌面版经主进程请求以避开 CORS；浏览器版使用同源管理 API 的 CORS。 */
export async function manageRequest<T>(server: MCPServer, path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!canManage(server)) throw new ManagementError('请先在服务器编辑页配置管理接口和全局 admin 凭证')
  try {
    const b = bridge()
    if (b?.manageRequest) {
      const result = await b.manageRequest(endpoint(server, path), server.managementKey!, method, body)
      if (result.status === 401 || result.status === 403) throw new ManagementError('管理凭证无效或权限不足', result.status)
      if (result.status < 200 || result.status >= 300) {
        const detail = result.body as { error?: string }
        throw new ManagementError(detail?.error || `管理请求失败（HTTP ${result.status}）`, result.status)
      }
      return result.body as T
    }
    const response = await fetch(endpoint(server, path), {
      method,
      headers: {
        Authorization: `Bearer ${server.managementKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    })
    const data = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new ManagementError(data.error || `管理请求失败（HTTP ${response.status}）`, response.status)
    return data as T
  } catch (error) {
    if (error instanceof ManagementError) throw error
    throw new ManagementError(error instanceof Error ? error.message : '无法连接管理接口')
  }
}

function parseServerTime(value?: string | null): number | null {
  if (!value) return null
  const ts = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}+08:00`)
  return Number.isFinite(ts) ? ts : null
}

/** 以服务器返回结果为唯一事实来源，不采用乐观更新。 */
export function applyManagedStatus(server: MCPServer, status: ManagedStatus): void {
  const st = useStore.getState()
  const oldPartitions = new Map(st.partitions.filter((p) => p.managedBy === server.id).map((p) => [p.remoteName, p]))
  const partitions: Partition[] = status.partitions.map((p, index) => {
    const old = oldPartitions.get(p.name)
    return {
      id: old?.id ?? `mp-${server.id}-${p.name}`,
      name: p.name,
      description: old?.description ?? p.path,
      color: old?.color ?? ['#4f8dff', '#22c993', '#f6a04d', '#a78bfa', '#38bdf8'][index % 5],
      kind: old?.kind ?? 'project',
      archived: false,
      createdAt: old?.createdAt ?? Date.now(),
      managedBy: server.id,
      remoteName: p.name,
      rootPath: p.path,
    }
  })
  const partIds = new Map(partitions.map((p) => [p.remoteName!, p.id]))
  const oldCredentials = new Map(st.credentials.filter((c) => c.managedBy === server.id).map((c) => [c.keyPrefix, c]))
  const credentials: Credential[] = status.credentials.map((c) => {
    const old = oldCredentials.get(c.key_prefix)
    const scopes = c.role ? partitions.map((p) => p.id) : Object.keys(c.grants).map((name) => partIds.get(name)).filter((id): id is string => Boolean(id))
    return {
      id: old?.id ?? `mc-${server.id}-${c.key_prefix}`,
      name: c.name,
      keyPrefix: c.key_prefix,
      scopes,
      rateLimitPerMin: c.rate_limit_per_min,
      enabled: c.enabled,
      createdAt: old?.createdAt ?? parseServerTime(c.created_at) ?? Date.now(),
      expiresAt: parseServerTime(c.expires_at),
      lastUsedAt: parseServerTime(c.last_used_at) ?? old?.lastUsedAt ?? null,
      managedBy: server.id,
      role: c.role,
    }
  })
  st.replaceManagedState(server.id, partitions, credentials)
  // 管理端只回答进程生命周期；MCP 是否可连接必须另行用普通访问凭证握手。
  st.setServerStatus(server.id, status.status === 'running' ? 'running' : 'stopped')
  st.setLiveStatus(server.id, status.status === 'running' ? 'unknown' : 'offline')
}

export async function syncManagedServer(server: MCPServer): Promise<ManagedStatus> {
  try {
    const status = await manageRequest<ManagedStatus>(server, '/status')
    applyManagedStatus(server, status)
    if (status.status === 'running') {
      // HTTP 管理还要验证普通 MCP 访问；stdio 由管理端报告的进程状态代表可用性。
      const live = /^https?:\/\//i.test(server.command.trim()) ? await probeServer(server) : 'online'
      useStore.getState().setLiveStatus(server.id, live)
    }
    return status
  } catch (error) {
    const st = useStore.getState()
    st.setLiveStatus(server.id, error instanceof ManagementError && (error.status === 401 || error.status === 403) ? 'auth' : 'offline')
    throw error
  }
}

export interface ManagedOperation {
  id: string
  action: 'start' | 'stop' | 'restart'
  status: 'accepted' | 'running' | 'succeeded' | 'failed'
  created_at: string
  finished_at: string | null
  error: string | null
  result?: { status: 'running' | 'stopped'; pid: number | null }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function remoteProcess(server: MCPServer, action: 'start' | 'stop' | 'restart'): Promise<ManagedOperation> {
  const response = await manageRequest<{ operation: ManagedOperation }>(server, `/process/${action}`, 'POST')
  return response.operation
}

/** 跟踪到真实目标状态；命令被接受不等于启动、停止或重启成功。 */
export async function awaitRemoteOperation(
  server: MCPServer,
  initial: ManagedOperation,
  pollMs = 1_000,
  timeoutMs = 75_000,
): Promise<ManagedOperation> {
  let operation = initial
  const deadline = Date.now() + timeoutMs
  while (operation.status === 'accepted' || operation.status === 'running') {
    if (Date.now() >= deadline) throw new ManagementError(`远程${operation.action}结果确认超时`)
    await wait(pollMs)
    const response = await manageRequest<{ operation: ManagedOperation }>(server, `/operations/${operation.id}`)
    operation = response.operation
  }
  if (operation.status === 'failed') throw new ManagementError(operation.error || `远程${operation.action}失败`)
  return operation
}

export async function syncAllManagedServers(): Promise<void> {
  const servers = useStore.getState().servers.filter((s) => !s.archived && canManage(s))
  await Promise.allSettled(servers.map(syncManagedServer))
}
