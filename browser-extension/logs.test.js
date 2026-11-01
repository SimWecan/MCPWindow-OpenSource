import test from 'node:test'
import assert from 'node:assert/strict'
import {
  accessLogsUrl,
  fetchAccessLogs,
  mergeAccessLogs,
  normalizeAccessLog,
  normalizeAccessLogs,
  normalizeManagementUrl,
} from './logs.js'

test('校验并规范化日志管理接口地址', () => {
  assert.equal(normalizeManagementUrl(''), '')
  assert.equal(normalizeManagementUrl('https://example.com/manage/?ignored=1#top'), 'https://example.com')
  assert.equal(normalizeManagementUrl('http://127.0.0.1:8091/manage'), 'http://127.0.0.1:8091')
  assert.throws(() => normalizeManagementUrl('http://example.com/manage'), /HTTPS/)
  assert.throws(() => normalizeManagementUrl('file:///tmp/manage'), /HTTP/)
})

test('日志接口使用管理地址，缺省时回退到 MCP 同源地址', () => {
  assert.equal(
    accessLogsUrl({ url: 'https://mcp.example.com/mcp', managementUrl: 'https://admin.example.com/manage' }),
    'https://admin.example.com/manage/access-logs?limit=20000',
  )
  assert.equal(
    accessLogsUrl({ url: 'https://mcp.example.com/mcp', managementUrl: '' }),
    'https://mcp.example.com/manage/access-logs?limit=20000',
  )
})

test('admin 凭证优先，支持 logs 数组及未知耗时', async () => {
  const original = globalThis.fetch
  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      status: 200,
      async json() { return { logs: [{ request_id: 'req-1', timestamp: '2026-10-30T01:00:00Z', path: '/mcp', status: 200 }] } },
    }
  }
  try {
    const logs = await fetchAccessLogs({
      id: 'alpha', url: 'https://example.com/mcp', managementUrl: 'https://example.com/manage',
      managementKey: 'admin-secret', authType: 'bearer', credential: 'user-secret',
    })
    assert.equal(request.options.headers.Authorization, 'Bearer admin-secret')
    assert.equal(logs.length, 1)
    assert.equal(logs[0].latencyMs, null)
    assert.equal(logs[0].count, 1)
    assert.equal(logs[0].sourceKey, 'remote:alpha:req-1')
  } finally { globalThis.fetch = original }
})

test('兼容 records 响应、秒级时间戳和聚合计数', () => {
  const [log] = normalizeAccessLogs({ records: [{ id: 'aggregate', ts: 1790000000, count: 7, duration_ms: 12.5 }] }, 'alpha')
  assert.equal(log.ts, 1790000000000)
  assert.equal(log.count, 7)
  assert.equal(log.latencyMs, 12.5)
  assert.equal(normalizeAccessLog({ endpoint: '/mcp' }, 'alpha'), null)
  assert.throws(() => normalizeAccessLogs({ unexpected: [] }, 'alpha'), /logs/)
})

test('按服务器与来源键去重，重复来源不会覆盖其他服务器', () => {
  const first = normalizeAccessLog({ id: 'same', ts: 1790000000000 }, 'alpha')
  const duplicate = normalizeAccessLog({ id: 'same', ts: 1790000000000 }, 'alpha')
  const otherServer = normalizeAccessLog({ id: 'same', ts: 1790000000000 }, 'beta')
  const merged = mergeAccessLogs([first], [duplicate, otherServer])
  assert.equal(merged.length, 2)
  assert.deepEqual(new Set(merged.map(log => log.serverId)), new Set(['alpha', 'beta']))
})
