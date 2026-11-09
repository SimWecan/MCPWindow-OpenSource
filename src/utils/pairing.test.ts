import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { buildMobileSnapshot, handlePairingCommand } from './pairing'

const results = new Map<string, { ok: boolean; error?: string }>()

beforeEach(() => {
  results.clear()
  // 最小桥接桩：只提供命令回执；其余 API 缺省（同步与探测自然跳过）。
  ;(globalThis as Record<string, unknown>).window = {
    mcpwindow: {
      pairingCommandResult: (id: string, result: { ok: boolean; error?: string }) => results.set(id, result),
    },
  }
})

describe('buildMobileSnapshot', () => {
  it('快照结构与状态机映射正确', () => {
    const state = useStore.getState()
    const snapshot = buildMobileSnapshot(state)
    const activeServers = state.servers.filter((s) => !s.archived)
    expect(snapshot.servers).toHaveLength(activeServers.length)
    expect(snapshot.summary.online + snapshot.summary.needsCredentials + snapshot.summary.offline)
      .toBe(activeServers.length)
    expect(snapshot.approvals).toEqual([])
    for (const server of snapshot.servers) {
      expect(['stdio', 'streamableHttp']).toContain(server.transport)
      expect(['online', 'needsCredentials', 'offline']).toContain(server.status)
    }
  })
})

describe('handlePairingCommand', () => {
  it('server.add 新增服务器到桌面端存储', async () => {
    const before = useStore.getState().servers.length
    await handlePairingCommand('cmd-1', 'server.add', {
      payload: { name: '移动端测试服务', transport: 'streamableHttp', endpoint: 'http://192.168.1.5:8080/mcp' },
    })
    expect(results.get('cmd-1')).toEqual({ ok: true, error: undefined })
    expect(useStore.getState().servers.length).toBe(before + 1)
    const added = useStore.getState().servers.find((s) => s.name === '移动端测试服务')
    expect(added?.transport).toBe('streamable-http')
    expect(added?.managementUrl).toBe('http://192.168.1.5:8080/mcp')
  })

  it('stdio 命令行拆分命令与参数', async () => {
    await handlePairingCommand('cmd-2', 'server.add', {
      payload: { name: '移动端stdio服务', transport: 'stdio', command: 'node server.js --port 9000' },
    })
    expect(results.get('cmd-2')?.ok).toBe(true)
    const added = useStore.getState().servers.find((s) => s.name === '移动端stdio服务')
    expect(added?.command).toBe('node')
    expect(added?.args).toBe('server.js --port 9000')
  })

  it('缺少名称时拒绝新增', async () => {
    await handlePairingCommand('cmd-3', 'server.add', { payload: { transport: 'stdio', command: 'node x.js' } })
    expect(results.get('cmd-3')?.ok).toBe(false)
  })

  it('server.remove 删除存在的服务器', async () => {
    const target = useStore.getState().servers.find((s) => s.name === '移动端测试服务')
    await handlePairingCommand('cmd-4', 'server.remove', { id: target?.id })
    expect(results.get('cmd-4')?.ok).toBe(true)
    expect(useStore.getState().servers.some((s) => s.name === '移动端测试服务')).toBe(false)
  })

  it('alerts.readAll 后未读告警清零', async () => {
    useStore.getState().setServerStatus(useStore.getState().servers.find((s) => !s.archived)!.id, 'crashed')
    const before = buildMobileSnapshot(useStore.getState()).summary.unreadAlerts
    expect(before).toBeGreaterThan(0)
    await handlePairingCommand('cmd-5', 'alerts.readAll', {})
    expect(results.get('cmd-5')?.ok).toBe(true)
    expect(buildMobileSnapshot(useStore.getState()).summary.unreadAlerts).toBe(0)
  })

  it('桌面端暂无审批工作流，respond 返回不可用', async () => {
    await handlePairingCommand('cmd-6', 'approval.respond', { id: 'a-1', approved: true })
    expect(results.get('cmd-6')?.ok).toBe(false)
  })
})
