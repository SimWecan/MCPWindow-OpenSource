import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVER_STATUS_POLL_MS, refreshServerStatuses, startStatusPolling } from './status'
import { useStore } from '../store/useStore'
import type { MCPServer } from '../types'

describe('服务器状态调度', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('启动立即刷新，此后严格每 30 分钟刷新', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue()
    const stop = startStatusPolling(refresh)
    expect(refresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(SERVER_STATUS_POLL_MS - 1)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(SERVER_STATUS_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(3)
    stop()
  })

  it('组件清理后不再刷新，卸载也不会留下定时器', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue()
    const stop = startStatusPolling(refresh)
    stop()
    await vi.advanceTimersByTimeAsync(SERVER_STATUS_POLL_MS * 3)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('状态刷新竞态', () => {
  const original = { servers: useStore.getState().servers, liveStatus: useStore.getState().liveStatus }
  afterEach(() => {
    useStore.setState(original)
    vi.unstubAllGlobals()
  })

  it('刷新期间新增服务器会追加一轮，不停留在未探测', async () => {
    const remote = (id: string): MCPServer => ({
      id, name: id, partitionId: 'p1', description: '', command: `https://${id}.example.com/mcp`,
      args: '', version: '1', transport: 'streamable-http', status: 'stopped', archived: false, createdAt: 1,
    })
    let releaseFirst!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => { releaseFirst = resolve })
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {
      protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' },
    } })
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() => firstResponse)
      .mockImplementation(async () => new Response(body, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    useStore.setState({ servers: [remote('first')], liveStatus: {} })

    const first = refreshServerStatuses()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    useStore.setState({ servers: [remote('first'), remote('second')] })
    const second = refreshServerStatuses()
    releaseFirst(new Response(body, { status: 200 }))
    await Promise.all([first, second])

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(useStore.getState().liveStatus.second).toBe('online')
  })
})
