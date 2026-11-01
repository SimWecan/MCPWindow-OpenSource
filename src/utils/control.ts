import { useStore } from '../store/useStore'
import type { MCPServer } from '../types'
import { bridge } from './bridge'
import { awaitRemoteOperation, remoteProcess, syncManagedServer } from './management'
import { runServerOperation } from './serverSync'

export { bridge } from './bridge'
export type { BridgeApi } from './bridge'

/** 是否为本地可控进程（非 http 远程服务） */
export const isControllable = (server: MCPServer): boolean =>
  !/^https?:\/\//i.test(server.command.trim())

export async function startServerProc(server: MCPServer): Promise<boolean> {
  const b = bridge()
  if (!b?.procStart) return false
  const ok = await b.procStart(server.id, server.command, server.argList ?? server.args, server.env)
  const st = useStore.getState()
  st.setProc(server.id, ok)
  st.setLiveStatus(server.id, ok ? 'online' : 'offline')
  st.setServerStatus(server.id, ok ? 'running' : 'crashed')
  return ok
}

export async function stopServerProc(server: MCPServer): Promise<boolean> {
  const b = bridge()
  if (!b?.procStop) return false
  const ok = await b.procStop(server.id)
  const st = useStore.getState()
  if (ok) {
    st.setProc(server.id, false)
    st.setLiveStatus(server.id, 'offline')
    st.setServerStatus(server.id, 'stopped')
  }
  return ok
}

export async function restartServerProc(server: MCPServer): Promise<boolean> {
  const b = bridge()
  if (!b?.procRestart) return false
  const ok = await b.procRestart(server.id, server.command, server.argList ?? server.args, server.env)
  const st = useStore.getState()
  st.setProc(server.id, ok)
  st.setLiveStatus(server.id, ok ? 'online' : 'offline')
  st.setServerStatus(server.id, ok ? 'running' : 'crashed')
  return ok
}

/** 统一执行本地或远程管理操作；与同服务器的状态刷新串行，防止旧回读造成闪屏。 */
export async function operateServer(server: MCPServer, action: 'start' | 'stop' | 'restart'): Promise<void> {
  return runServerOperation(server.id, async () => {
    if (server.managementUrl?.trim() && server.managementKey?.trim()) {
      try {
        const operation = await remoteProcess(server, action)
        await awaitRemoteOperation(server, operation)
        await syncManagedServer(server)
      } catch (error) {
        // 失败时也尽量回读真实状态，但保留原始操作错误供界面展示。
        await syncManagedServer(server).catch(() => undefined)
        throw error
      }
      return
    }
    const ok = action === 'start'
      ? await startServerProc(server)
      : action === 'stop'
        ? await stopServerProc(server)
        : await restartServerProc(server)
    if (!ok) throw new Error('进程操作失败：命令未启动、提前退出或 MCP initialize 握手未通过')
  })
}

/** 与主进程对账托管进程清单（实时监控用） */
export async function syncProcFromMain(): Promise<void> {
  const b = bridge()
  if (!b?.procList) return
  const running = new Set(await b.procList())
  const st = useStore.getState()
  for (const s of st.servers) {
    // 远程管理结果不能被本机进程表覆盖；同一配置可能使用本地命令但由管理代理控制。
    if (!isControllable(s) || (s.managementUrl?.trim() && s.managementKey?.trim())) continue
    const alive = running.has(s.id)
    st.setProc(s.id, alive)
    st.setLiveStatus(s.id, alive ? 'online' : 'offline')
  }
}

/** 订阅主进程进程退出事件；返回取消订阅函数 */
export function subscribeProcExit(): () => void {
  const b = bridge()
  if (!b?.onProcExit) return () => undefined
  return b.onProcExit((id, code) => {
    const st = useStore.getState()
    st.setProc(id, false)
    st.setLiveStatus(id, 'offline')
    // 非正常退出视为崩溃并记录；任何退出都立即清除在线状态。
    st.setServerStatus(id, code === 0 ? 'stopped' : 'crashed')
  })
}
