import type { MCPServer, Transport } from '../types'

export interface ServerConfigInput {
  name: string
  partitionId: string
  command: string
  transport: Transport
  managementUrl?: string
  managementKey?: string
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const MCP_ENDPOINT_PATH = /\/mcp\/?$/i

export const MANAGEMENT_MCP_PATH_ERROR = '管理接口不能填写 MCP 连接地址（/mcp）；TerraFin 本机请使用 http://127.0.0.1:8091'

/** 迁移早期把 TerraFin 连接地址误作管理地址的本机配置，不改动其他服务器。 */
export function migrateLegacyManagementUrl<T extends Pick<MCPServer, 'name' | 'command' | 'managementUrl'>>(server: T): T {
  if (!server.managementUrl) return server
  try {
    const management = new URL(server.managementUrl.trim())
    const connection = new URL(server.command)
    const isTerraFin = connection.hostname === 'mcp.terrafin.top' || server.name.toLowerCase().includes('terrafin')
    if (!isTerraFin || !LOOPBACK_HOSTS.has(management.hostname) || management.port !== '8090' || !MCP_ENDPOINT_PATH.test(management.pathname)) return server
    management.port = '8091'
    management.pathname = ''
    management.search = ''
    management.hash = ''
    return { ...server, managementUrl: management.origin }
  } catch {
    return server
  }
}

/** 在保存前发现连接与管理配置错误，避免留下无法探测或无法控制的配置。 */
export function validateServerConfig(form: ServerConfigInput): string | null {
  if (!form.name.trim()) return '请填写服务器名称'
  if (!form.partitionId) return '请选择所属分区'
  const command = form.command.trim()
  if (!command) return '请填写启动命令或服务地址'
  const isHttp = /^https?:\/\//i.test(command)
  if (form.transport === 'stdio' && isHttp) return 'stdio 服务应填写本地启动命令，而不是 HTTP 地址'
  if (form.transport !== 'stdio' && !isHttp) return 'SSE / Streamable HTTP 服务必须填写 http(s) 地址'
  if (isHttp) {
    try {
      const url = new URL(command)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
      if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) return '非本机 MCP 地址必须使用 HTTPS'
    } catch {
      return 'MCP 服务地址格式无效'
    }
  }

  const managementUrl = form.managementUrl?.trim() ?? ''
  const managementKey = form.managementKey?.trim() ?? ''
  if (Boolean(managementUrl) !== Boolean(managementKey)) return '管理接口地址与全局 admin 凭证必须同时填写'
  if (managementUrl) {
    try {
      const url = new URL(managementUrl)
      if (!['http:', 'https:'].includes(url.protocol)) return '管理接口必须是 http(s) 地址'
      if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) return '非本机管理接口必须使用 HTTPS'
      if (MCP_ENDPOINT_PATH.test(url.pathname)) return MANAGEMENT_MCP_PATH_ERROR
    } catch {
      return '管理接口地址格式无效'
    }
  }
  return null
}
