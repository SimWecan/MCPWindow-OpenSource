import { describe, expect, it } from 'vitest'
import { createBackup, parseBackup } from './backup'
import type { MCPServer, Partition } from '../types'

const localPartition: Partition = { id: 'p-local', name: 'Local', description: '', color: '#fff', kind: 'project', archived: false, createdAt: 1 }
const remotePartition: Partition = { ...localPartition, id: 'p-remote', name: 'Remote', managedBy: 'manager' }
const server: MCPServer = {
  id: 's-1', name: 'server', partitionId: 'p-local', description: '', command: 'node', args: '',
  version: '1', transport: 'stdio', status: 'running', archived: true, createdAt: 1,
  headers: { Authorization: 'Bearer secret' }, env: { TOKEN: 'secret' }, managementKey: 'admin-secret',
}

describe('脱敏配置备份', () => {
  it('不导出凭证、远程镜像和敏感配置', () => {
    const data = parseBackup(createBackup([localPartition, remotePartition], [server]))
    expect(data.format).toBe('mcpwindow-backup')
    expect(data.version).toBe(1)
    expect(data.partitions.map((item) => item.id)).toEqual(['p-local'])
    expect(data.servers[0]).toMatchObject({ headers: {}, env: {}, managementKey: '', archived: false })
    expect(JSON.stringify(data)).not.toContain('secret')
  })

  it('支持导出的备份往返解析', () => {
    const original = createBackup([localPartition], [server])
    expect(createBackup(parseBackup(original).partitions, parseBackup(original).servers)).toContain('mcpwindow-backup')
  })

  it('拒绝错误格式和不完整实体', () => {
    expect(() => parseBackup('{')).toThrow()
    expect(() => parseBackup('{"format":"other","version":1,"partitions":[],"servers":[]}')).toThrow('不是有效的 MCPWindow 备份文件')
    expect(() => parseBackup('{"format":"mcpwindow-backup","version":1,"partitions":[{}],"servers":[]}')).toThrow('备份中的分区格式不完整')
    expect(() => parseBackup('{"format":"mcpwindow-backup","version":1,"partitions":[],"servers":[{"id":"s","name":"s"}]}')).toThrow('备份中的服务器格式不完整')
  })
})
