import { describe, expect, it } from 'vitest'
import { useStore } from '../store/useStore'
import { executePluginHostAction } from './pluginHostApi'

describe('第三方插件宿主管理 API', () => {
  it('读取真实工作区并通过插件操作创建、删除本地分区', async () => {
    const before = useStore.getState().partitions.length
    const name = `plugin-unit-${Date.now()}`
    const created = await executePluginHostAction('partitions.create', { name, description: 'unit', color: '#a78bfa', kind: 'project' }) as { ok: boolean; partition: { id: string; name: string; color: string; kind: string } }
    expect(created.ok).toBe(true)
    expect(created.partition).toMatchObject({ name, color: '#a78bfa', kind: 'project' })
    expect(useStore.getState().partitions).toHaveLength(before + 1)
    const listed = await executePluginHostAction('partitions.list', {}) as { partitions: Array<{ id: string }> }
    expect(listed.partitions.some((partition) => partition.id === created.partition.id)).toBe(true)
    await expect(executePluginHostAction('partitions.delete', { partitionId: created.partition.id })).resolves.toEqual({ ok: true, partitionId: created.partition.id })
    expect(useStore.getState().partitions).toHaveLength(before)
  })

  it('拒绝无效参数和未支持的宿主操作', async () => {
    await expect(executePluginHostAction('servers.status', {})).rejects.toThrow('serverId')
    await expect(executePluginHostAction('files.delete', {})).rejects.toThrow('不支持')
  })
})
