import { useStore } from '../store/useStore'
import { syncAllAccessLogs } from './accessLogSync'
import { syncProcFromMain } from './control'
import { canManage, syncManagedServer } from './management'
import { probeServer } from './probe'
import { runServerTask, trackStatusRefresh } from './serverSync'

export const SERVER_STATUS_POLL_MS = 30 * 60 * 1000

/** 启动时立即刷新并每 30 分钟调度一次，返回可阻止后续刷新的清理函数。 */
export function startStatusPolling(refresh: () => void | Promise<void>): () => void {
  void refresh()
  const timer = setInterval(() => { void refresh() }, SERVER_STATUS_POLL_MS)
  return () => clearInterval(timer)
}

let refreshInFlight: Promise<void> | null = null
let refreshRequested = false

/** 不并发刷新；执行期间收到新请求时追加一轮，确保新配置不会被旧快照吞掉。 */
export function refreshServerStatuses(): Promise<void> {
  refreshRequested = true
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    while (refreshRequested) {
      refreshRequested = false
      const { servers, setLiveStatus, setLastProbeAt, setProbeIssue } = useStore.getState()
      await Promise.all(servers.filter((s) => !s.archived).map(async (server) => {
        await runServerTask(server.id, async () => {
          try {
            const managed = canManage(server)
            if (managed) await syncManagedServer(server)
            const status = managed ? useStore.getState().liveStatus[server.id] ?? 'unknown' : await probeServer(server)
            if (!managed) setLiveStatus(server.id, status)
            if (status === 'offline') {
              const processRunning = managed && useStore.getState().servers.find((item) => item.id === server.id)?.status === 'running'
              throw new Error(managed
                ? processRunning ? '服务进程运行中，但 MCP 服务地址无法连接或握手未通过' : '服务进程未运行，请先启动服务'
                : '无法连接服务器或 MCP initialize 握手未通过')
            }
            if (status === 'auth') throw new Error('服务进程运行中，但 MCP 访问需要有效的普通访问凭证（不是 admin 管理凭证）')
            setProbeIssue(server.id)
          } catch (error) {
            setProbeIssue(server.id, error instanceof Error ? error.message : String(error))
          }
        })
      }))
      await syncProcFromMain().catch(() => undefined)
      setLastProbeAt(Date.now())
    }
  })()
  trackStatusRefresh(refreshInFlight)
  refreshInFlight = refreshInFlight.finally(() => { refreshInFlight = null })
  return refreshInFlight
}

/** 状态与访问日志共用启动、手动刷新和 30 分钟调度；日志失败不改变在线状态。 */
export async function refreshServerData(): Promise<void> {
  await refreshServerStatuses()
  await syncAllAccessLogs()
}
