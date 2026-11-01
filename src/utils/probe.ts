import type { LiveStatus, MCPServer } from '../types'
import { bridge } from './bridge'

const INIT_PAYLOAD = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcpwindow', version: '0.8.4' },
  },
}

/** 只接受与本次 initialize 匹配、字段完整的 JSON-RPC 成功响应；兼容 JSON 与 SSE。 */
export function parseMcpInitialize(status: number, raw: string): LiveStatus {
  if (status === 401 || status === 403) return 'auth'
  if (status < 200 || status >= 300) return 'offline'
  const candidates = [raw, ...raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())]
  for (const candidate of candidates) {
    try {
      const message = JSON.parse(candidate)
      const result = message.result
      if (message.jsonrpc === '2.0' && message.id === INIT_PAYLOAD.id
        && typeof result?.protocolVersion === 'string'
        && typeof result?.capabilities === 'object' && result.capabilities !== null
        && typeof result?.serverInfo?.name === 'string'
        && typeof result?.serverInfo?.version === 'string') return 'online'
    } catch {
      // 尝试下一个 SSE data 事件。
    }
  }
  return 'offline'
}

/** 桌面版经主进程探测以避免 CORS；浏览器版仍需目标服务允许跨域。 */
export async function probeHttp(url: string, timeoutMs = 8000, headers: Record<string, string> = {}): Promise<LiveStatus> {
  try {
    const api = bridge()
    if (api?.probeHttp) {
      const result = await api.probeHttp(url, headers, timeoutMs)
      return parseMcpInitialize(result.status, result.body)
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(INIT_PAYLOAD),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return parseMcpInitialize(res.status, await res.text())
  } catch {
    return 'offline'
  }
}

/** 远程服务验证 MCP initialize；本地服务只以主进程托管状态为准。 */
export async function probeServer(server: MCPServer): Promise<LiveStatus> {
  const cmd = server.command.trim()
  if (/^https?:\/\//i.test(cmd)) return probeHttp(cmd, 8000, server.headers)
  const api = bridge()
  if (api?.probeLocal) {
    try {
      return await api.probeLocal(server.id, cmd)
    } catch {
      return 'unknown'
    }
  }
  return 'unknown'
}

export const LIVE_META: Record<LiveStatus, { label: string; color: string }> = {
  online: { label: '在线', color: '#22c993' },
  auth: { label: '需凭证', color: '#f6a04d' },
  offline: { label: '离线', color: '#f4586a' },
  unknown: { label: '未探测', color: '#8a93a6' },
}
