export function validateServerUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('仅支持 HTTP(S) 地址')
  return url.toString()
}

export function buildHeaders(server) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  if (server.authType === 'bearer' && server.credential) headers.Authorization = `Bearer ${server.credential}`
  if (server.authType === 'basic' && (server.credential || server.username)) {
    headers.Authorization = `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${server.username || ''}:${server.credential || ''}`)))}`
  }
  if (server.authType === 'api-key' && server.credential) headers[server.headerName || 'X-API-Key'] = server.credential
  return headers
}

export function parseInitialize(status, raw) {
  if (status === 401 || status === 403) return 'auth'
  if (status < 200 || status >= 300) return 'offline'
  const candidates = [raw, ...raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim())]
  for (const candidate of candidates) {
    try {
      const message = JSON.parse(candidate)
      if (message.jsonrpc === '2.0' && message.id === 'mcpwindow-extension'
        && typeof message.result?.protocolVersion === 'string'
        && typeof message.result?.capabilities === 'object'
        && typeof message.result?.serverInfo?.name === 'string') return 'online'
    } catch { /* try the next SSE event */ }
  }
  return 'offline'
}

export async function probeServer(server, timeoutMs = 8000) {
  try {
    const response = await fetch(validateServerUrl(server.url), {
      method: 'POST', headers: buildHeaders(server), signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ jsonrpc: '2.0', id: 'mcpwindow-extension', method: 'initialize', params: {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcpwindow-extension', version: '0.8.4' },
      } }),
    })
    return parseInitialize(response.status, await response.text())
  } catch {
    return 'offline'
  }
}
