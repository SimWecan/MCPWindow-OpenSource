import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import type { MCPServer } from '../types'
import { bridge } from './bridge'
import { subscribeProcExit, syncProcFromMain } from './control'

vi.mock('./bridge', () => ({ bridge: vi.fn() }))

const server: MCPServer = {
  id: 'local-1', name: 'local', partitionId: 'p', description: '', command: 'node', args: '',
  version: '1', transport: 'stdio', status: 'running', archived: false, createdAt: 1,
}

describe('本地进程退出同步', () => {
  beforeEach(() => {
    useStore.setState({ servers: [{ ...server }], liveStatus: { [server.id]: 'online' }, proc: { [server.id]: true }, crashLogs: [] })
    vi.mocked(bridge).mockReset()
  })

  it('异常退出立即离线并记录崩溃', () => {
    let listener: ((id: string, code: number | null) => void) | undefined
    vi.mocked(bridge).mockReturnValue({ onProcExit: (cb) => { listener = cb; return () => undefined } })
    const unsubscribe = subscribeProcExit()
    listener?.(server.id, 7)
    const state = useStore.getState()
    expect(state.liveStatus[server.id]).toBe('offline')
    expect(state.proc[server.id]).toBe(false)
    expect(state.servers[0].status).toBe('crashed')
    expect(state.crashLogs).toHaveLength(1)
    unsubscribe()
  })

  it('正常退出立即离线并标记停止', () => {
    let listener: ((id: string, code: number | null) => void) | undefined
    vi.mocked(bridge).mockReturnValue({ onProcExit: (cb) => { listener = cb; return () => undefined } })
    const unsubscribe = subscribeProcExit()
    listener?.(server.id, 0)
    expect(useStore.getState().liveStatus[server.id]).toBe('offline')
    expect(useStore.getState().servers[0].status).toBe('stopped')
  })

  it('本地进程对账不覆盖远程管理的真实状态', async () => {
    const managedServer = { ...server, id: 'managed-1', managementUrl: 'http://127.0.0.1:8091', managementKey: 'secret' }
    useStore.setState({ servers: [server, managedServer], liveStatus: { [server.id]: 'online', [managedServer.id]: 'online' } })
    vi.mocked(bridge).mockReturnValue({ procList: async () => [] })
    await syncProcFromMain()
    const state = useStore.getState()
    expect(state.liveStatus[server.id]).toBe('offline')
    expect(state.liveStatus[managedServer.id]).toBe('online')
  })
})
