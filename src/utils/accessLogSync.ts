import { useStore } from '../store/useStore'
import type { AccessLog, LocalAccessLogResult, MCPServer } from '../types'
import { bridge } from './bridge'
import { canManage, manageRequest } from './management'

export interface AccessLogSyncSummary {
  servers: number
  imported: number
  errors: string[]
}

const emptyResult = (): LocalAccessLogResult => ({ files: [], total: 0, skipped: 0, logs: [] })

/** 浏览器版没有本地文件权限时按“未发现记录”处理，不阻断服务器接入。 */
export async function discoverLocalHistory(server: MCPServer): Promise<LocalAccessLogResult> {
  const read = bridge()?.accessLogsDiscover
  return read ? read(server) : emptyResult()
}

function incomingLogs(server: MCPServer, result: LocalAccessLogResult, since?: number): AccessLog[] {
  return result.logs
    .filter((log) => Number.isFinite(log.ts) && (since === undefined || log.ts >= since))
    .map((log) => ({ ...log, serverId: server.id }))
}

export async function importLocalHistory(server: MCPServer): Promise<{ imported: number; total: number; skipped: number }> {
  const read = bridge()?.accessLogsRead
  if (!read) return { imported: 0, total: 0, skipped: 0 }
  const result = await read(server)
  const imported = useStore.getState().mergeAccessLogs(incomingLogs(server, result))
  return { imported, total: result.total, skipped: result.skipped }
}

let syncInFlight: Promise<AccessLogSyncSummary> | null = null

type ManagedAccessLog = Omit<AccessLog, 'serverId' | 'ts'> & { timestamp: string }

async function readServerAccessLogs(server: MCPServer): Promise<LocalAccessLogResult> {
  // 配置了管理端时以远程接口为准，避免同一文件再经本地扫描产生重复记录。
  if (canManage(server)) {
    const response = await manageRequest<{ logs: ManagedAccessLog[] }>(server, '/access-logs?limit=2000')
    const logs = response.logs.map(({ timestamp, ...log }) => ({ ...log, ts: Date.parse(timestamp) }))
      .filter((log) => Number.isFinite(log.ts))
    return { files: [], total: logs.length, skipped: response.logs.length - logs.length, logs }
  }
  const read = bridge()?.accessLogsRead
  if (!read) return emptyResult()
  return read(server)
}

/** 每 30 分钟由全局调度调用；逐台增量合并，失败不影响运行状态或其他服务器。 */
export function syncAllAccessLogs(): Promise<AccessLogSyncSummary> {
  if (syncInFlight) return syncInFlight
  syncInFlight = (async () => {
    const summary: AccessLogSyncSummary = { servers: 0, imported: 0, errors: [] }
    const servers = useStore.getState().servers.filter((server) =>
      !server.archived && server.accessLogSync !== 'pending' && server.accessLogSync !== 'disabled')
    await Promise.all(servers.map(async (configured) => {
      try {
        const result = await readServerAccessLogs(configured)
        const current = useStore.getState().servers.find((server) => server.id === configured.id)
        if (!current || current.archived) return
        summary.servers++
        summary.imported += useStore.getState().mergeAccessLogs(incomingLogs(current, result, current.accessLogSince))
      } catch (error) {
        summary.errors.push(`${configured.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }))
    useStore.getState().setLastAccessLogSyncAt(Date.now())
    return summary
  })().finally(() => { syncInFlight = null })
  return syncInFlight
}
