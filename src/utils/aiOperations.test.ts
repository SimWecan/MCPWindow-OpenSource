import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import type { MCPServer } from '../types'
import { executeAIAction, findAIActionTarget, validateAIAction } from './aiOperations'

const originalServers = useStore.getState().servers
const server: MCPServer = {
  id: 'srv-ai', name: 'AI 测试服务', partitionId: 'p', description: '', command: 'node server.js',
  args: '', version: '1', transport: 'stdio', status: 'stopped', archived: false, createdAt: 1,
}

afterEach(() => useStore.setState({ servers: originalServers }))

describe('AI 操作安全边界', () => {
  it('未授权时拒绝执行', async () => {
    useStore.setState({ servers: [server] })
    await expect(executeAIAction({ serverId: server.id, action: 'restart' }, false)).rejects.toThrow('尚未开放')
  })

  it('拒绝不存在、已归档或不可管理的目标', () => {
    useStore.setState({ servers: [server] })
    expect(() => findAIActionTarget({ serverId: 'missing', action: 'start' })).toThrow('不存在')
    useStore.setState({ servers: [{ ...server, archived: true }] })
    expect(() => findAIActionTarget({ serverId: server.id, action: 'stop' })).toThrow('已归档')
    useStore.setState({ servers: [server] })
    expect(() => validateAIAction({ serverId: server.id, action: 'start' }, true)).toThrow('未配置可用管理能力')
  })
})
