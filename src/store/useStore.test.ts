import { beforeEach, describe, expect, it } from 'vitest'
import type { AccessLog, ChatMessage, Credential, MCPServer, Partition } from '../types'
import { useStore } from './useStore'

const server: MCPServer = {
  id: 'manager', name: 'manager', partitionId: 'local', description: '', command: 'node', args: '',
  version: '1', transport: 'stdio', status: 'running', archived: false, createdAt: 1,
}
const partition: Partition = {
  id: 'remote-p', name: 'remote-p', description: '', color: '#fff', kind: 'project', archived: false,
  createdAt: 1, managedBy: 'manager', remoteName: 'remote-p',
}
const credential: Credential = {
  id: 'remote-c', name: 'remote-c', keyPrefix: 'prefix', scopes: ['remote-p'], rateLimitPerMin: 1,
  enabled: true, createdAt: 1, expiresAt: null, lastUsedAt: null, managedBy: 'manager',
}

describe('本机状态维护', () => {
  beforeEach(() => {
    useStore.setState({
      servers: [{ ...server }], partitions: [{ ...partition }], credentials: [{ ...credential }],
      accessLogs: [], crashLogs: [], chat: [], liveStatus: { manager: 'online' }, proc: { manager: true },
    })
  })

  it('删除管理来源时清理镜像分区、凭证和运行缓存', () => {
    useStore.getState().deleteServer('manager')
    const state = useStore.getState()
    expect(state.servers).toHaveLength(0)
    expect(state.partitions).toHaveLength(0)
    expect(state.credentials).toHaveLength(0)
    expect(state.liveStatus).toEqual({})
    expect(state.proc).toEqual({})
  })

  it('长期运行数据保持明确上限并保留最新记录', () => {
    const logs: AccessLog[] = Array.from({ length: 20000 }, (_, ts) => ({ ts, serverId: 'manager', endpoint: '/mcp', client: 'test', tool: 'ping', ok: true, latencyMs: 1 }))
    const crashes = Array.from({ length: 20000 }, (_, ts) => ({ ts, serverId: 'manager', reason: 'old' }))
    const chat: ChatMessage[] = Array.from({ length: 100 }, (_, ts) => ({ role: 'user', content: String(ts), ts }))
    useStore.setState({ accessLogs: logs, crashLogs: crashes, chat })
    useStore.getState().recordAccess({ ts: 20001, serverId: 'manager', endpoint: '/mcp', client: 'test', tool: 'new', ok: true, latencyMs: 1 })
    useStore.getState().setServerStatus('manager', 'crashed')
    useStore.getState().pushChat({ role: 'assistant', content: 'latest', ts: 20001 })
    const state = useStore.getState()
    expect(state.accessLogs).toHaveLength(20000)
    expect(state.crashLogs).toHaveLength(20000)
    expect(state.chat).toHaveLength(100)
    expect(state.accessLogs[state.accessLogs.length - 1]?.tool).toBe('new')
    expect(state.chat[state.chat.length - 1]?.content).toBe('latest')
  })

  it('新增实体使用 UUID，避免同毫秒创建发生碰撞', () => {
    const input = { name: 'p', description: '', color: '#fff', kind: 'project' as const }
    useStore.getState().addPartition(input)
    useStore.getState().addPartition(input)
    const ids = useStore.getState().partitions.filter((p) => !p.managedBy).map((p) => p.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => /^p-[0-9a-f-]{36}$/.test(id))).toBe(true)
  })

  it('清空演示工作区只移除内置示例并保留用户数据', () => {
    const seed = { ...server, id: 's-filesystem', partitionId: 'p-dev' }
    useStore.setState({
      servers: [seed, { ...server }], partitions: [{ ...partition, id: 'p-dev', managedBy: undefined }, { ...partition }],
      credentials: [{ ...credential, id: 'c-1', managedBy: undefined }, { ...credential }], demoWorkspace: true,
    })
    useStore.getState().clearDemoWorkspace()
    const state = useStore.getState()
    expect(state.servers.map((item) => item.id)).toEqual(['manager'])
    expect(state.partitions.map((item) => item.id)).toEqual(['remote-p'])
    expect(state.credentials.map((item) => item.id)).toEqual(['remote-c'])
    expect(state.demoWorkspace).toBe(false)
  })

  it('恢复备份按名称跳过冲突、重映射分区并移除敏感信息', () => {
    useStore.setState({
      servers: [{ ...server, name: 'existing' }], partitions: [{ ...partition, id: 'existing-p', name: 'Shared', managedBy: undefined }],
    })
    useStore.getState().restoreBackup([
      { ...partition, id: 'incoming-shared', name: 'Shared', managedBy: undefined },
      { ...partition, id: 'incoming-new', name: 'New', managedBy: undefined },
    ], [
      { ...server, id: 'incoming-1', partitionId: 'incoming-shared', name: 'existing' },
      { ...server, id: 'incoming-2', partitionId: 'incoming-new', name: 'restored', headers: { Authorization: 'secret' }, env: { SECRET: 'secret' }, managementKey: 'secret' },
    ])
    const state = useStore.getState()
    expect(state.partitions.map((item) => item.id)).toEqual(['existing-p', 'incoming-new'])
    expect(state.servers).toHaveLength(2)
    expect(state.servers[1]).toMatchObject({ name: 'restored', partitionId: 'incoming-new', status: 'stopped', headers: {}, env: {}, managementKey: '' })
  })

  it('v6 持久化迁移修正 TerraFin 管理地址并保留 admin 凭证', () => {
    const legacy = {
      ...server, name: 'TerraFin-MCP', command: 'https://mcp.terrafin.top/mcp',
      managementUrl: 'http://127.0.0.1:8090/mcp', managementKey: 'admin-secret',
    }
    const migrated = useStore.persist.getOptions().migrate?.({ servers: [legacy] }, 5) as StateWithServers
    expect(migrated.servers[0].managementUrl).toBe('http://127.0.0.1:8091')
    expect(migrated.servers[0].managementKey).toBe('admin-secret')
  })
})

interface StateWithServers {
  servers: MCPServer[]
}
