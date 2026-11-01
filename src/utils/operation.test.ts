import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MCPServer } from '../types'
import { awaitRemoteOperation, manageRequest, type ManagedOperation } from './management'

const server: MCPServer = {
  id: 'srv-operation', name: 'TerraFin', partitionId: 'p', description: '',
  command: 'http://127.0.0.1:8090/mcp', args: '', version: 'test',
  transport: 'streamable-http', status: 'stopped', archived: false, createdAt: 1,
  managementUrl: 'http://127.0.0.1:8091', managementKey: 'admin-secret',
}

const operation: ManagedOperation = {
  id: 'op-1', action: 'restart', status: 'accepted', created_at: '2026-10-26T22:00:00+08:00',
  finished_at: null, error: null,
}

const response = (value: ManagedOperation) => new Response(JSON.stringify({ operation: value }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
})

afterEach(() => vi.unstubAllGlobals())

describe('远程操作结果确认', () => {
  it('持续查询直到真实操作成功', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ...operation, status: 'running' }))
      .mockResolvedValueOnce(response({ ...operation, status: 'succeeded', result: { status: 'running', pid: 456 } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await awaitRemoteOperation(server, operation, 1, 100)
    expect(result.status).toBe('succeeded')
    expect(result.result?.pid).toBe(456)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('把服务端失败详情抛给界面', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ...operation, status: 'failed', error: '管理命令退出码为 1，目标状态未达成',
    })))
    await expect(awaitRemoteOperation(server, operation, 1, 100)).rejects.toThrow('退出码为 1')
  })

  it('拒绝通过明文 HTTP 访问非本机管理面', async () => {
    await expect(manageRequest({ ...server, managementUrl: 'http://example.com:8091' }, '/status'))
      .rejects.toThrow('必须使用 HTTPS')
  })

  it('旧配置未迁移时明确提示管理端地址而不是笼统 404', async () => {
    await expect(manageRequest({ ...server, managementUrl: 'http://127.0.0.1:8090/mcp' }, '/process/start', 'POST'))
      .rejects.toThrow('TerraFin 本机请改为 http://127.0.0.1:8091')
  })
})
