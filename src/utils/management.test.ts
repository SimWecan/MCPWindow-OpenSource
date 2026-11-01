import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import type { MCPServer } from '../types'
import { bridge } from './bridge'
import { applyManagedStatus, canManage, syncManagedServer, type ManagedStatus } from './management'

vi.mock('./bridge', () => ({ bridge: vi.fn() }))

const server: MCPServer = {
  id: 'srv-1', name: 'TerraFin', partitionId: 'local-p', description: '',
  command: 'http://127.0.0.1:8090/mcp', args: '', version: 'test',
  transport: 'streamable-http', status: 'stopped', archived: false, createdAt: 1,
  managementUrl: 'http://127.0.0.1:8091', managementKey: 'admin-secret',
}

const status: ManagedStatus = {
  ok: true, service: 'terafin-mcp', status: 'running', pid: 123, started_at: 1,
  partitions: [{ name: 'project-a', path: 'E:\\repo\\a' }],
  credentials: [{
    key_prefix: 'tf_public_prefix', name: 'client', grants: { 'project-a': 'write' },
    enabled: true, created_at: '2026-10-26 12:00', expires_at: null, rate_limit_per_min: 60,
  }],
}

describe('远程管理状态映射', () => {
  beforeEach(() => {
    useStore.setState({ servers: [{ ...server }], partitions: [], credentials: [], liveStatus: {} })
  })

  it('只在管理地址与凭证同时存在时启用管理', () => {
    expect(canManage(server)).toBe(true)
    expect(canManage({ ...server, managementKey: ' ' })).toBe(false)
    expect(canManage({ ...server, managementUrl: undefined })).toBe(false)
  })

  it('映射真实分区、凭证权限和运行状态', () => {
    applyManagedStatus(server, status)
    const state = useStore.getState()
    expect(state.servers[0].status).toBe('running')
    expect(state.liveStatus[server.id]).toBe('unknown')
    expect(state.partitions).toHaveLength(1)
    expect(state.partitions[0]).toMatchObject({ managedBy: server.id, remoteName: 'project-a', rootPath: 'E:\\repo\\a' })
    expect(state.credentials[0].scopes).toEqual([state.partitions[0].id])
    expect(state.credentials[0].rateLimitPerMin).toBe(60)
  })

  it('管理代理在线但主服务停止时显示 stopped/offline', () => {
    applyManagedStatus(server, { ...status, status: 'stopped', pid: null, started_at: null })
    const state = useStore.getState()
    expect(state.servers[0].status).toBe('stopped')
    expect(state.liveStatus[server.id]).toBe('offline')
  })

  it('全局角色获得全部分区，重复同步不重复添加数据', () => {
    const globalAdmin = { ...status.credentials[0], role: 'admin' as const, grants: {} }
    applyManagedStatus(server, { ...status, credentials: [globalAdmin] })
    applyManagedStatus(server, { ...status, credentials: [globalAdmin] })
    const state = useStore.getState()
    expect(state.partitions).toHaveLength(1)
    expect(state.credentials).toHaveLength(1)
    expect(state.credentials[0].scopes).toEqual([state.partitions[0].id])
  })

  it('相同管理状态重复同步时保留引用，避免整页无效重渲染', () => {
    applyManagedStatus(server, status)
    const before = useStore.getState()
    const partitions = before.partitions
    const credentials = before.credentials
    const servers = before.servers
    const liveStatus = before.liveStatus
    applyManagedStatus(server, status)
    const after = useStore.getState()
    expect(after.partitions).toBe(partitions)
    expect(after.credentials).toBe(credentials)
    expect(after.servers).toBe(servers)
    expect(after.liveStatus).toBe(liveStatus)
  })

  it('进程运行但 MCP 返回 401 时保留 running 并显示需凭证，不下发停止', async () => {
    const manageRequest = vi.fn(async (_url: string, _key: string, _method: string) => ({ status: 200, body: status }))
    vi.mocked(bridge).mockReturnValue({
      manageRequest,
      probeHttp: async () => ({ status: 401, body: '' }),
    })
    await syncManagedServer(server)
    const state = useStore.getState()
    expect(state.servers[0].status).toBe('running')
    expect(state.liveStatus[server.id]).toBe('auth')
    expect(manageRequest).toHaveBeenCalledTimes(1)
    expect(manageRequest.mock.calls[0][0]).toBe('http://127.0.0.1:8091/manage/status')
  })
})
