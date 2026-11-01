import type { MCPServer } from '../types'

/**
 * 本机 MCP 配置（源自 mcp.json 的 mcpServers），首次启动自动导入。
 * 仅包含连接元数据，不包含任何凭证 Secret。
 */
export interface BundledServer extends Omit<MCPServer, 'id' | 'createdAt' | 'archived'> {
  id: string
}

// 公共版本不预置任何个人服务器、路径或管理凭证。
export const bundledLocalServers: BundledServer[] = []

/** 通用 mcp.json（mcpServers 格式）解析，供“手动导入”使用 */
export interface ParsedMCPServer {
  name: string
  description: string
  command: string
  args: string
  argList?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  transport: 'stdio' | 'streamable-http'
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  return entries.length ? Object.fromEntries(entries) : undefined
}

const displayArg = (arg: string) => /[\s"']/.test(arg) ? JSON.stringify(arg) : arg

export function parseMCPConfig(json: unknown): ParsedMCPServer[] {
  const root = (json ?? {}) as Record<string, unknown>
  const servers = (root.mcpServers ?? root) as Record<string, Record<string, unknown>>
  const out: ParsedMCPServer[] = []
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object') continue
    const url = typeof cfg.url === 'string' ? cfg.url : ''
    const command = typeof cfg.command === 'string' ? cfg.command : url
    if (!command) continue
    const argList = Array.isArray(cfg.args) ? cfg.args.filter((arg): arg is string => typeof arg === 'string') : undefined
    const args = argList ? argList.map(displayArg).join(' ') : typeof cfg.args === 'string' ? cfg.args : ''
    const note = typeof cfg.note === 'string' ? cfg.note : ''
    const label = typeof cfg.name === 'string' && cfg.name ? cfg.name : name
    const env = stringRecord(cfg.env)
    const headers = stringRecord(cfg.headers)
    out.push({
      name,
      description: label + (note ? ` · ${note}` : ''),
      command,
      args,
      ...(argList ? { argList } : {}),
      ...(env ? { env } : {}),
      ...(headers ? { headers } : {}),
      transport: url ? 'streamable-http' : 'stdio',
    })
  }
  return out
}
