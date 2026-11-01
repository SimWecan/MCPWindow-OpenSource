import { describe, expect, it } from 'vitest'
import { parseMcpInitialize } from './probe'

const result = {
  jsonrpc: '2.0', id: 1,
  result: {
    protocolVersion: '2024-11-05', capabilities: { tools: {} },
    serverInfo: { name: 'fixture', version: '1.0.0' },
  },
}

describe('MCP initialize 响应校验', () => {
  it('接受字段完整的 JSON 与 SSE 成功响应', () => {
    expect(parseMcpInitialize(200, JSON.stringify(result))).toBe('online')
    expect(parseMcpInitialize(200, `event: message\ndata: ${JSON.stringify(result)}\n\n`)).toBe('online')
  })

  it('拒绝普通网页、空响应、JSON-RPC 错误和不完整结果', () => {
    expect(parseMcpInitialize(200, '<html>ok</html>')).toBe('offline')
    expect(parseMcpInitialize(200, '')).toBe('offline')
    expect(parseMcpInitialize(200, JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad' } }))).toBe('offline')
    expect(parseMcpInitialize(200, JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }))).toBe('offline')
  })

  it('保留鉴权与 HTTP 错误的区别', () => {
    expect(parseMcpInitialize(401, '')).toBe('auth')
    expect(parseMcpInitialize(403, '')).toBe('auth')
    expect(parseMcpInitialize(503, JSON.stringify(result))).toBe('offline')
  })
})
