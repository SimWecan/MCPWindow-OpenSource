import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AIProtocol } from '../types'
import { chat, validateKey, type AIChatTool } from './aiClient'

const config = { baseUrl: 'https://ai.example.com/v1/', apiKey: 'secret', model: 'model-b' }
const tools: AIChatTool[] = [{ type: 'function', function: { name: 'mcp_server_operation', description: 'test', parameters: { type: 'object' } } }]

afterEach(() => vi.unstubAllGlobals())

function mockResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('AI 模型目录认证', () => {
  it.each([
    ['openai-completions', false],
    ['openai-responses', false],
    ['anthropic-messages', true],
  ] as const)('%s 使用对应的认证请求头', async (protocol, anthropic) => {
    const fetchMock = mockResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }] })
    await expect(validateKey({ ...config, protocol })).resolves.toEqual({ ok: true, models: ['model-a', 'model-b'] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://ai.example.com/v1/models')
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('Authorization')).toBe(anthropic ? null : 'Bearer secret')
    expect(headers.get('x-api-key')).toBe(anthropic ? 'secret' : null)
    expect(headers.get('anthropic-version')).toBe(anthropic ? '2023-06-01' : null)
  })
})

describe('OpenAI Chat Completions 与工具调用', () => {
  it('保持旧协议路径并只解析白名单工具，返回待确认操作而不执行', async () => {
    const body = { choices: [{ message: { content: null, tool_calls: [
      { function: { name: 'mcp_server_operation', arguments: JSON.stringify({ serverId: 'srv-1', action: 'restart' }) } },
      { function: { name: 'delete_everything', arguments: '{}' } },
      { function: { name: 'mcp_server_operation', arguments: '{invalid' } },
    ] } }] }
    const fetchMock = mockResponse(body)
    const result = await chat(config, [], '重启服务', tools)
    expect(result).toEqual({ ok: true, content: '（空回复）', actions: [{ serverId: 'srv-1', action: 'restart' }] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://ai.example.com/v1/chat/completions')
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(payload.model).toBe('model-b')
    expect(payload.tools[0].function.name).toBe('mcp_server_operation')
  })

  it('拒绝通过非本机明文 HTTP 发送 API Key', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const result = await validateKey({ ...config, baseUrl: 'http://ai.example.com/v1' })
    expect(result.error).toContain('必须使用 HTTPS')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('OpenAI Responses 协议', () => {
  const responsesConfig = { ...config, protocol: 'openai-responses' as const }

  it('发送 input 与扁平 function 工具，并解析文本和 function_call', async () => {
    const fetchMock = mockResponse({ output: [
      { type: 'message', content: [{ type: 'output_text', text: '请确认重启。' }] },
      { type: 'function_call', name: 'mcp_server_operation', arguments: '{"serverId":"srv-r","action":"restart"}' },
      { type: 'function_call', name: 'not_allowed', arguments: '{"serverId":"srv-r","action":"stop"}' },
    ] })
    const result = await chat(responsesConfig, [{ role: 'system', content: '系统上下文' }], '重启 srv-r', tools)
    expect(result).toEqual({ ok: true, content: '请确认重启。', actions: [{ serverId: 'srv-r', action: 'restart' }] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://ai.example.com/v1/responses')
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(payload.messages).toBeUndefined()
    expect(payload.input).toEqual([{ role: 'system', content: '系统上下文' }, { role: 'user', content: '重启 srv-r' }])
    expect(payload.tools).toEqual([{ type: 'function', name: 'mcp_server_operation', description: 'test', parameters: { type: 'object' } }])
    expect(payload.tool_choice).toBe('auto')
    expect(payload).not.toHaveProperty('temperature')
  })

  it('支持顶层 output_text 和无效工具参数过滤', async () => {
    mockResponse({ output_text: '只读回答', output: [
      { type: 'function_call', name: 'mcp_server_operation', arguments: '{bad json' },
    ] })
    await expect(chat(responsesConfig, [], '状态如何', tools)).resolves.toEqual({ ok: true, content: '只读回答', actions: [] })
  })
})

describe('Anthropic Messages 协议', () => {
  const anthropicConfig = { ...config, protocol: 'anthropic-messages' as const }

  it('拆分 system，转换 input_schema，并解析 text 与 tool_use', async () => {
    const fetchMock = mockResponse({ content: [
      { type: 'text', text: '目标已核对。' },
      { type: 'tool_use', name: 'mcp_server_operation', input: { serverId: 'srv-a', action: 'stop' } },
      { type: 'tool_use', name: 'not_allowed', input: { serverId: 'srv-a', action: 'restart' } },
    ] })
    const history = [
      { role: 'system', content: '第一段系统提示' },
      { role: 'assistant', content: '之前回答' },
      { role: 'system', content: '第二段系统提示' },
    ]
    const result = await chat(anthropicConfig, history, '停止 srv-a', tools)
    expect(result).toEqual({ ok: true, content: '目标已核对。', actions: [{ serverId: 'srv-a', action: 'stop' }] })
    expect(fetchMock.mock.calls[0][0]).toBe('https://ai.example.com/v1/messages')
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('x-api-key')).toBe('secret')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.get('Authorization')).toBeNull()
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(payload.system).toBe('第一段系统提示\n\n第二段系统提示')
    expect(payload.messages).toEqual([{ role: 'assistant', content: '之前回答' }, { role: 'user', content: '停止 srv-a' }])
    expect(payload.max_tokens).toBe(4096)
    expect(payload.tools).toEqual([{ name: 'mcp_server_operation', description: 'test', input_schema: { type: 'object' } }])
    expect(payload.tool_choice).toEqual({ type: 'auto' })
    expect(payload.input).toBeUndefined()
  })

  it('无文本的工具响应仍生成待确认建议', async () => {
    mockResponse({ content: [{ type: 'tool_use', name: 'mcp_server_operation', input: { serverId: 'srv-a', action: 'start' } }] })
    await expect(chat(anthropicConfig, [], '启动 srv-a', tools)).resolves.toEqual({
      ok: true, content: '（空回复）', actions: [{ serverId: 'srv-a', action: 'start' }],
    })
  })
})

describe('采样参数兼容', () => {
  it.each(['openai-completions', 'openai-responses', 'anthropic-messages'] as AIProtocol[])('%s 仅按服务端要求重试 temperature', async (protocol) => {
    const success = protocol === 'anthropic-messages' ? { content: [{ type: 'text', text: 'ok' }] }
      : protocol === 'openai-responses' ? { output_text: 'ok', output: [] }
        : { choices: [{ message: { content: 'ok' } }] }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'temperature only 1 allowed' } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(success), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(chat({ ...config, protocol }, [], '你好')).resolves.toMatchObject({ ok: true, content: 'ok', retried: true })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).not.toHaveProperty('temperature')
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).temperature).toBe(1)
  })
})
