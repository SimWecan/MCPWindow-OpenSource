function decodeBasic(value) {
  try {
    const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch { throw new Error('Basic Auth 凭证不是有效的 Base64') }
}

function fromHeaders(name, url, headers = {}) {
  const server = { name, url, authType: 'none', username: '', headerName: 'X-API-Key', credential: '' }
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (typeof rawValue !== 'string') continue
    const headerName = rawName.trim()
    const value = rawValue.trim()
    if (/^authorization$/i.test(headerName)) {
      const bearer = value.match(/^Bearer\s+(.+)$/i)
      const basic = value.match(/^Basic\s+(.+)$/i)
      if (bearer) { server.authType = 'bearer'; server.credential = bearer[1].trim() }
      else if (basic) {
        const decoded = decodeBasic(basic[1])
        const separator = decoded.indexOf(':')
        server.authType = 'basic'
        server.username = separator >= 0 ? decoded.slice(0, separator) : decoded
        server.credential = separator >= 0 ? decoded.slice(separator + 1) : ''
      }
    } else {
      server.authType = 'api-key'
      server.headerName = headerName
      server.credential = rawValue
    }
  }
  return server
}

/** 仅在本机解析常见 mcp.json；调用方仍需让用户确认后才保存。 */
export function parseMCPConfig(text) {
  let input
  try { input = JSON.parse(text) } catch { throw new Error('JSON 格式无效，请检查括号、引号和逗号') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('JSON 顶层必须是对象')
  const source = input.mcpServers ?? input.servers ?? input.server ?? input
  const entries = source && typeof source === 'object' && !Array.isArray(source) && typeof source.url === 'string'
    ? [[input.name || 'MCP Server', source]]
    : Object.entries(source || {})
  const servers = []
  let skipped = 0
  for (const [name, value] of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { skipped++; continue }
    const url = typeof value.url === 'string' ? value.url : typeof value.endpoint === 'string' ? value.endpoint : null
    if (!url) { skipped++; continue }
    const parsed = fromHeaders(String(value.name || name), url, value.headers)
    if (!value.headers) {
      if (typeof value.bearerToken === 'string' || typeof value.token === 'string') {
        parsed.authType = 'bearer'; parsed.credential = value.bearerToken || value.token
      } else if (typeof value.apiKey === 'string') {
        parsed.authType = 'api-key'; parsed.credential = value.apiKey
        parsed.headerName = typeof value.headerName === 'string' ? value.headerName : 'X-API-Key'
      } else if (value.auth && typeof value.auth === 'object') {
        Object.assign(parsed, fromHeaders(parsed.name, parsed.url, value.auth.headers || {}))
      }
    }
    servers.push(parsed)
  }
  if (!servers.length) throw new Error(skipped ? '未找到远程 HTTP(S) 配置；本地 stdio 服务器请在桌面端管理' : '未找到可识别的服务器地址')
  return { servers, skipped }
}

export function reorderByIds(servers, orderedIds) {
  const byId = new Map(servers.map(server => [server.id, server]))
  if (orderedIds.length !== servers.length || new Set(orderedIds).size !== servers.length || orderedIds.some(id => !byId.has(id))) return [...servers]
  return orderedIds.map(id => byId.get(id))
}
