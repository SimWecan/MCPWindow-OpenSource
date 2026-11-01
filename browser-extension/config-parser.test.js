import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMCPConfig, reorderByIds } from './config-parser.js'

test('智能识别标准 mcp.json 的 Bearer 认证', () => {
  const result = parseMCPConfig(JSON.stringify({ mcpServers: { remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret' } } } }))
  assert.equal(result.servers.length, 1)
  assert.deepEqual(result.servers[0], { name: 'remote', url: 'https://example.com/mcp', authType: 'bearer', username: '', headerName: 'X-API-Key', credential: 'secret' })
  assert.equal(result.skipped, 0)
})

test('识别 UTF-8 Basic Auth 与自定义 API Key 请求头', () => {
  const basic = Buffer.from('用户:密码').toString('base64')
  const result = parseMCPConfig(JSON.stringify({ mcpServers: {
    basic: { url: 'https://example.com/basic', headers: { Authorization: `Basic ${basic}` } },
    key: { url: 'https://example.com/key', headers: { 'X-Custom-Token': 'abc' } },
  } }))
  assert.equal(result.servers[0].authType, 'basic')
  assert.equal(result.servers[0].username, '用户')
  assert.equal(result.servers[0].credential, '密码')
  assert.equal(result.servers[1].authType, 'api-key')
  assert.equal(result.servers[1].headerName, 'X-Custom-Token')
})

test('支持单服务器配置并明确跳过 stdio 项', () => {
  const single = parseMCPConfig('{"name":"single","url":"https://example.com/mcp","token":"abc"}')
  assert.equal(single.servers[0].name, 'single')
  assert.equal(single.servers[0].authType, 'bearer')
  const mixed = parseMCPConfig('{"mcpServers":{"local":{"command":"node"},"remote":{"url":"https://example.com/mcp"}}}')
  assert.equal(mixed.servers.length, 1)
  assert.equal(mixed.skipped, 1)
})

test('无效 JSON 和只有 stdio 的配置给出可读错误', () => {
  assert.throws(() => parseMCPConfig('{'), /JSON 格式无效/)
  assert.throws(() => parseMCPConfig('{"mcpServers":{"local":{"command":"node"}}}'), /stdio/)
})

test('插件重排保留所有服务器并拒绝重复 ID', () => {
  const servers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(reorderByIds(servers, ['c', 'a', 'b']).map(item => item.id), ['c', 'a', 'b'])
  assert.deepEqual(reorderByIds(servers, ['c', 'c', 'a']), servers)
  assert.deepEqual(reorderByIds(servers, ['c', 'a']), servers)
})
