// 移动端配对：把 zustand 状态编码为移动端快照并经主进程配对服务对外提供。
// 桌面端是数据源与执行方；主进程 pairingServer 只做传输、鉴权和命令转发。
import { useStore } from '../store/useStore'
import type { State } from '../store/useStore'
import type { MCPServer } from '../types'
import { bridge } from './bridge'
import { operateServer } from './control'

export interface PairingStatus {
  running: boolean
  port: number | null
  token: string
  addresses: string[]
  url: string | null
  deviceCount: number
}

type MobileStatus = 'online' | 'needsCredentials' | 'offline'
type MobileTransport = 'stdio' | 'streamableHttp'
type CredentialType = 'none' | 'bearerToken' | 'basicAuth' | 'apiKey'
type AlertSeverity = 'info' | 'warning' | 'critical'

interface MobileServer {
  id: string
  name: string
  description: string
  partition: string
  transport: MobileTransport
  status: MobileStatus
  endpoint: string
  credentialType: CredentialType
  lastSeen: number | null
  favorite: boolean
}

interface MobileAlert {
  id: string
  title: string
  message: string
  severity: AlertSeverity
  createdAt: number
  read: boolean
}

export interface MobileSnapshot {
  summary: {
    online: number
    needsCredentials: number
    offline: number
    crashesToday: number
    unreadAlerts: number
    pendingApprovals: number
  }
  servers: MobileServer[]
  alerts: MobileAlert[]
  approvals: unknown[]
  generatedAt: number
}

const readAlertIds = new Set<string>()
let runtimeStarted = false
let syncTimer: ReturnType<typeof setTimeout> | null = null

function serverStatus(server: MCPServer, live: string | undefined): MobileStatus {
  if (live === 'online') return 'online'
  if (live === 'auth') return 'needsCredentials'
  return 'offline'
}

function buildServers(state: State): MobileServer[] {
  const partitionName = new Map(state.partitions.map((p) => [p.id, p.name]))
  return state.servers
    .filter((server) => !server.archived)
    .map((server) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      partition: partitionName.get(server.partitionId) ?? '默认分区',
      transport: (server.transport === 'stdio' ? 'stdio' : 'streamableHttp') as MobileTransport,
      status: serverStatus(server, state.liveStatus[server.id]),
      endpoint: server.transport === 'stdio' ? `${server.command} ${server.args}`.trim() : server.managementUrl ?? '',
      credentialType: (server.accessAuthType === 'bearer' ? 'bearerToken'
        : server.accessAuthType === 'basic' ? 'basicAuth'
        : server.accessAuthType === 'api-key' ? 'apiKey' : 'none') as CredentialType,
      lastSeen: null,
      favorite: server.favorite ?? false,
    }))
}

function buildAlerts(state: State, servers: MobileServer[]): MobileAlert[] {
  const alerts: MobileAlert[] = []
  const lastCrash = new Map<string, number>()
  for (const log of state.crashLogs) {
    lastCrash.set(log.serverId, Math.max(lastCrash.get(log.serverId) ?? 0, log.ts))
  }
  for (const server of servers) {
    const crashed = state.servers.find((item) => item.id === server.id)?.status === 'crashed'
    if (crashed) {
      alerts.push({
        id: `alert-${server.id}-crash`,
        title: `服务器 ${server.name} 崩溃`,
        message: '进程异常退出，请在桌面端检查日志并重启。',
        severity: 'critical',
        createdAt: lastCrash.get(server.id) ?? Date.now(),
        read: readAlertIds.has(`alert-${server.id}-crash`),
      })
      continue
    }
    if (server.status === 'offline') {
      alerts.push({
        id: `alert-${server.id}-down`,
        title: `服务器 ${server.name} 连接中断`,
        message: '实时探测未通过，服务可能已停止或网络不可达。',
        severity: 'warning',
        createdAt: Date.now(),
        read: readAlertIds.has(`alert-${server.id}-down`),
      })
    } else if (server.status === 'needsCredentials') {
      alerts.push({
        id: `alert-${server.id}-auth`,
        title: `服务器 ${server.name} 需要凭证`,
        message: '服务在线但认证未通过，请在桌面端更新访问凭证。',
        severity: 'warning',
        createdAt: Date.now(),
        read: readAlertIds.has(`alert-${server.id}-auth`),
      })
    }
  }
  return alerts.sort((a, b) => b.createdAt - a.createdAt)
}

export function buildMobileSnapshot(state: State): MobileSnapshot {
  const servers = buildServers(state)
  const alerts = buildAlerts(state, servers)
  const dayStart = new Date().setHours(0, 0, 0, 0)
  return {
    summary: {
      online: servers.filter((s) => s.status === 'online').length,
      needsCredentials: servers.filter((s) => s.status === 'needsCredentials').length,
      offline: servers.filter((s) => s.status === 'offline').length,
      crashesToday: state.crashLogs.filter((log) => log.ts >= dayStart).length,
      unreadAlerts: alerts.filter((alert) => !alert.read).length,
      pendingApprovals: 0,
    },
    servers,
    alerts,
    approvals: [],
    generatedAt: Date.now(),
  }
}

function syncNow(): void {
  const api = bridge()
  if (!api?.pairingSync) return
  void api.pairingSync(buildMobileSnapshot(useStore.getState()))
}

function scheduleSync(delay = 800): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => { syncTimer = null; syncNow() }, delay)
}

/** 处理移动端经主进程转发的命令；导出以便单测。 */
export async function handlePairingCommand(id: string, method: string, params: Record<string, unknown>): Promise<void> {
  const api = bridge()
  const done = (ok: boolean, error?: string): void => api?.pairingCommandResult?.(id, { ok, error })
  const state = useStore.getState()
  try {
    switch (method) {
      case 'server.operate': {
        const serverId = String(params.id ?? '')
        const action = String(params.action ?? '') as 'start' | 'stop' | 'restart'
        const server = state.servers.find((item) => item.id === serverId)
        if (!server) { done(false, '服务器不存在'); return }
        await operateServer(server, action)
        done(true)
        return
      }
      case 'server.add': {
        const payload = (params.payload ?? {}) as Record<string, unknown>
        const name = String(payload.name ?? '').trim()
        if (!name) { done(false, '服务器名称不能为空'); return }
        const transport = payload.transport === 'stdio' ? 'stdio' : 'streamable-http'
        const partitionName = String(payload.partition ?? '').trim()
        const partition = state.partitions.find((item) => !item.archived && item.name === partitionName)
          ?? state.partitions.find((item) => !item.archived)
        if (!partition) { done(false, '没有可用分区，请先在桌面端创建分区'); return }
        // 移动端导入的 stdio 命令是整行命令（命令 + 参数），首个空格前为可执行文件。
        const commandLine = String(payload.command ?? payload.endpoint ?? '').trim()
        const spaceIndex = commandLine.indexOf(' ')
        const command = spaceIndex === -1 ? commandLine : commandLine.slice(0, spaceIndex)
        const args = spaceIndex === -1 ? '' : commandLine.slice(spaceIndex + 1)
        if (transport === 'stdio' && !command) { done(false, '启动命令不能为空'); return }
        state.addServer({
          name,
          partitionId: partition.id,
          description: String(payload.description ?? ''),
          command,
          args,
          version: String(payload.version ?? '0.0.0'),
          transport,
          status: 'stopped',
          managementUrl: transport === 'stdio' ? undefined : String(payload.endpoint ?? ''),
        })
        done(true)
        return
      }
      case 'server.remove': {
        const serverId = String(params.id ?? '')
        if (!state.servers.some((item) => item.id === serverId)) { done(false, '服务器不存在'); return }
        state.deleteServer(serverId)
        done(true)
        return
      }
      case 'alerts.readAll': {
        const snapshot = buildMobileSnapshot(state)
        for (const alert of snapshot.alerts) readAlertIds.add(alert.id)
        done(true)
        return
      }
      case 'approval.respond': {
        done(false, '桌面端暂无待审批请求')
        return
      }
      default:
        done(false, `未知命令：${method}`)
    }
  } catch (error) {
    done(false, error instanceof Error ? error.message : String(error))
  } finally {
    // 命令可能改变了状态；快照订阅也会触发，这里兜底立即同步一次。
    scheduleSync(0)
  }
}

/** 启动配对运行时：订阅状态变化同步快照，并处理移动端经主进程转发的命令。 */
export function startPairingRuntime(): () => void {
  if (runtimeStarted) return () => undefined
  runtimeStarted = true
  const api = bridge()
  const unsubscribeCommand = api?.onPairingCommand?.((id, method, params) => {
    void handlePairingCommand(id, method, params)
  })
  // 状态变化（含探测轮询写入的 liveStatus）防抖后同步到主进程。
  let lastSerialized = ''
  const unsubscribeStore = useStore.subscribe((state) => {
    const serialized = JSON.stringify([state.servers, state.partitions, state.liveStatus, state.crashLogs])
    if (serialized === lastSerialized) return
    lastSerialized = serialized
    scheduleSync()
  })
  syncNow()
  return () => {
    runtimeStarted = false
    unsubscribeCommand?.()
    unsubscribeStore()
    if (syncTimer) clearTimeout(syncTimer)
  }
}
