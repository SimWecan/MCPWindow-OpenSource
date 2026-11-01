import type { MCPServer, Partition } from '../types'
import { bridge } from './bridge'

export interface BackupData {
  format: 'mcpwindow-backup'
  version: 1
  exportedAt: string
  partitions: Partition[]
  servers: MCPServer[]
}

export function createBackup(partitions: Partition[], servers: MCPServer[]): string {
  const data: BackupData = {
    format: 'mcpwindow-backup', version: 1, exportedAt: new Date().toISOString(),
    partitions: partitions.filter((item) => !item.managedBy),
    servers: servers.map(({ headers: _headers, env: _env, managementKey: _managementKey, ...server }) => ({
      ...server, headers: {}, env: {}, managementKey: '', archived: false,
    })),
  }
  return JSON.stringify(data, null, 2)
}

export function parseBackup(raw: string): BackupData {
  const data = JSON.parse(raw) as BackupData
  if (data?.format !== 'mcpwindow-backup' || data.version !== 1 || !Array.isArray(data.partitions) || !Array.isArray(data.servers)) throw new Error('不是有效的 MCPWindow 备份文件')
  if (data.partitions.some((item) => !item || typeof item.id !== 'string' || typeof item.name !== 'string')) throw new Error('备份中的分区格式不完整')
  if (data.servers.some((item) => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.command !== 'string')) throw new Error('备份中的服务器格式不完整')
  return data
}

export async function saveBackup(content: string): Promise<boolean> {
  const name = `mcpwindow-backup-${new Date().toISOString().slice(0, 10)}.json`
  const api = bridge()
  if (api?.saveTextFile) return api.saveTextFile(name, content)
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
