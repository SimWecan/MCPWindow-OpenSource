import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHeaders, parseInitialize, probeServer, validateServerUrl } from './mcp.js'

const response = JSON.stringify({ jsonrpc: '2.0', id: 'mcpwindow-extension', result: {
  protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1.0.0' },
} })

test('只接受 HTTP(S) MCP 地址', () => {
  assert.equal(validateServerUrl('https://example.com/mcp'), 'https://example.com/mcp')
  assert.throws(() => validateServerUrl('file:///tmp/mcp'))
  assert.throws(() => validateServerUrl('javascript:alert(1)'))
})

test('构造 Bearer、Basic 与 API Key 认证头', () => {
  assert.equal(buildHeaders({ authType: 'bearer', credential: 'abc' }).Authorization, 'Bearer abc')
  assert.equal(buildHeaders({ authType: 'basic', username: '用户', credential: 'pass' }).Authorization, `Basic ${Buffer.from('用户:pass').toString('base64')}`)
  assert.equal(buildHeaders({ authType: 'api-key', credential: 'key', headerName: 'X-Custom' })['X-Custom'], 'key')
})

test('严格识别 JSON 与 SSE initialize 响应', () => {
  assert.equal(parseInitialize(200, response), 'online')
  assert.equal(parseInitialize(200, `event: message\ndata: ${response}\n\n`), 'online')
  assert.equal(parseInitialize(401, ''), 'auth')
  assert.equal(parseInitialize(200, '{"jsonrpc":"2.0","id":"wrong"}'), 'offline')
  assert.equal(parseInitialize(200, 'ok'), 'offline')
})

test('网络失败返回离线，不显示假在线', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network unavailable') }
  try { assert.equal(await probeServer({ url: 'https://example.com/mcp' }), 'offline') }
  finally { globalThis.fetch = original }
})
