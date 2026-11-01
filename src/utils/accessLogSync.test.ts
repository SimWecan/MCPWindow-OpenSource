import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import type { MCPServer } from '../types'
import { syncAllAccessLogs } from './accessLogSync'

const server = (id: string, patch: Partial<MCPServer> = {}): MCPServer => ({
  id, name: id, partitionId: 'p', description: '', command: 'node', args: '', version: '1',
  transport: 'stdio', status: 'stopped', archived: false, createdAt: 1, accessLogSync: 'enabled', ...patch,
})
const original = { servers: useStore.getState().servers, accessLogs: useStore.getState().accessLogs, lastAccessLogSyncAt: useStore.getState().lastAccessLogSyncAt }

beforeEach(() => {
  useStore.setState({ servers: [server('enabled'), server('pending', { accessLogSync: 'pending' })], accessLogs: [], lastAccessLogSyncAt: null })
})
afterEach(() => {
  useStore.setState(original)
  vi.unstubAllGlobals()
})

describe('访问日志增量同步', () => {
  it('按服务器和来源键去重，等待历史确认的服务器不自动导入', async () => {
    const read = vi.fn(async (configured: Pick<MCPServer, 'id'>) => ({
      files: [], total: 2, skipped: 0,
      logs: [
        { ts: 1, endpoint: '/mcp', client: 'a', tool: 'call', ok: true, latencyMs: null, sourceKey: 'same' },
        { ts: 2, endpoint: '/mcp', client: 'b', tool: 'call', ok: true, latencyMs: 4, sourceKey: 'new' },
      ],
    }))
    vi.stubGlobal('window', { mcpwindow: { accessLogsRead: read } })

    expect((await syncAllAccessLogs()).imported).toBe(2)
    expect((await syncAllAccessLogs()).imported).toBe(0)
    expect(read).toHaveBeenCalledTimes(2)
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ id: 'enabled' }))
    expect(read).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'pending' }))
    expect(useStore.getState().accessLogs).toHaveLength(2)
    expect(useStore.getState().lastAccessLogSyncAt).not.toBeNull()
  })

  it('拒绝历史后仅合并指定时间之后的记录', async () => {
    useStore.setState({ servers: [server('enabled', { accessLogSince: 1_000 })], accessLogs: [] })
    vi.stubGlobal('window', { mcpwindow: { accessLogsRead: async () => ({
      files: [], total: 2, skipped: 0,
      logs: [
        { ts: 999, endpoint: '/old', client: 'a', tool: 'old', ok: true, latencyMs: null, sourceKey: 'old' },
        { ts: 1_000, endpoint: '/new', client: 'a', tool: 'new', ok: true, latencyMs: null, sourceKey: 'new' },
      ],
    }) } })
    const result = await syncAllAccessLogs()
    expect(result.imported).toBe(1)
    expect(useStore.getState().accessLogs.map((log) => log.endpoint)).toEqual(['/new'])
  })

  it('Mac 等无本地日志的桌面端通过管理接口持续同步远程日志并去重', async () => {
    useStore.setState({ servers: [server('terrafin', {
      command: 'https://mcp.terrafin.top/mcp', transport: 'streamable-http',
      managementUrl: 'https://mcp.terrafin.top', managementKey: 'admin-secret',
    })], accessLogs: [] })
    const localRead = vi.fn()
    const remoteRead = vi.fn(async () => ({
      status: 200,
      body: { logs: [
        { timestamp: '2026-11-01T10:00:00+08:00', endpoint: '/mcp', client: 'platform.kimi.com', tool: 'POST', ok: true, latencyMs: null, sourceKey: 'terafin:1' },
        { timestamp: 'invalid', endpoint: '/bad', client: 'unknown', tool: 'POST', ok: false, latencyMs: null, sourceKey: 'terafin:bad' },
      ] },
    }))
    vi.stubGlobal('window', { mcpwindow: { accessLogsRead: localRead, manageRequest: remoteRead } })

    expect((await syncAllAccessLogs()).imported).toBe(1)
    expect((await syncAllAccessLogs()).imported).toBe(0)
    expect(remoteRead).toHaveBeenCalledWith('https://mcp.terrafin.top/manage/access-logs?limit=2000', 'admin-secret', 'GET', undefined)
    expect(localRead).not.toHaveBeenCalled()
    expect(useStore.getState().accessLogs).toHaveLength(1)
    expect(useStore.getState().accessLogs[0]).toMatchObject({ serverId: 'terrafin', endpoint: '/mcp', sourceKey: 'terafin:1' })
  })
})
