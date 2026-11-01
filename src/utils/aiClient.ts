import type { AIConfig, AIProtocol, AIServerAction } from '../types'

type Msg = { role: string; content: string }

export interface AIChatTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AIResult {
  ok: boolean
  content?: string
  error?: string
  /** 模型提出的操作，仅用于展示确认，绝不在客户端自动执行。 */
  actions?: AIServerAction[]
  /** 是否需要更新配置（如自动纠正 temperature 行为时） */
  retried?: boolean
}

interface ChatOptions {
  temperature?: number
  tools?: AIChatTool[]
}

interface ParsedResponse {
  content: string
  actions: AIServerAction[]
}

const norm = (url: string) => url.trim().replace(/\/+$/, '')
const protocolOf = (config: AIConfig): AIProtocol => config.protocol ?? 'openai-completions'

function validateEndpoint(config: AIConfig): string | null {
  if (!config.baseUrl.trim() || !config.apiKey.trim()) return 'Base URL 与 API Key 均不能为空'
  try {
    const url = new URL(config.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return 'AI API 地址必须使用 http(s)'
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
    if (url.protocol === 'http:' && !loopback) return '非本机 AI API 地址必须使用 HTTPS，避免 API Key 泄露'
    return null
  } catch {
    return 'AI API 地址格式无效'
  }
}

function authHeaders(config: AIConfig): Record<string, string> {
  if (protocolOf(config) === 'anthropic-messages') {
    return {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }
  return { Authorization: `Bearer ${config.apiKey}` }
}

function requestSpec(
  config: AIConfig,
  messages: Msg[],
  options: ChatOptions,
): { path: string; payload: Record<string, unknown> } {
  const protocol = protocolOf(config)
  const payload: Record<string, unknown> = { model: config.model }
  if (options.temperature != null) payload.temperature = options.temperature

  if (protocol === 'openai-responses') {
    payload.input = messages
    if (options.tools?.length) {
      payload.tools = options.tools.map((tool) => ({
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      }))
      payload.tool_choice = 'auto'
    }
    return { path: '/responses', payload }
  }

  if (protocol === 'anthropic-messages') {
    const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
    payload.messages = messages.filter((message) => message.role === 'user' || message.role === 'assistant')
    payload.max_tokens = 4096
    if (system) payload.system = system
    if (options.tools?.length) {
      payload.tools = options.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }))
      payload.tool_choice = { type: 'auto' }
    }
    return { path: '/messages', payload }
  }

  payload.messages = messages
  if (options.tools?.length) {
    payload.tools = options.tools
    payload.tool_choice = 'auto'
  }
  return { path: '/chat/completions', payload }
}

async function postChat(
  config: AIConfig,
  messages: Msg[],
  options: ChatOptions = {},
): Promise<{ status: number; body: string }> {
  const endpointError = validateEndpoint(config)
  if (endpointError) return { status: 0, body: endpointError }
  const { path, payload } = requestSpec(config, messages, options)

  let res: Response
  try {
    res = await fetch(`${norm(config.baseUrl)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) }
  }
  return { status: res.status, body: await res.text() }
}

/** 只接受白名单函数与参数；返回的是待确认建议，不具有执行权限。 */
function parseAction(name: unknown, rawArguments: unknown): AIServerAction | null {
  if (name !== 'mcp_server_operation') return null
  try {
    const args = typeof rawArguments === 'string' ? JSON.parse(rawArguments) : rawArguments
    if (args && typeof args.serverId === 'string' && ['start', 'stop', 'restart'].includes(args.action)) {
      return { serverId: args.serverId, action: args.action }
    }
  } catch {
    // 忽略模型生成的无效参数，不把它交给执行链路。
  }
  return null
}

function parseResponse(config: AIConfig, body: string): ParsedResponse {
  const data = JSON.parse(body)
  const protocol = protocolOf(config)
  const texts: string[] = []
  const actions: AIServerAction[] = []
  const addAction = (name: unknown, args: unknown) => {
    const action = parseAction(name, args)
    if (action) actions.push(action)
  }

  if (protocol === 'openai-responses') {
    for (const item of Array.isArray(data?.output) ? data.output : []) {
      if (item?.type === 'function_call') addAction(item.name, item.arguments)
      if (item?.type === 'message') {
        for (const part of Array.isArray(item.content) ? item.content : []) {
          if (part?.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
        }
      }
    }
    if (!texts.length && typeof data?.output_text === 'string') texts.push(data.output_text)
  } else if (protocol === 'anthropic-messages') {
    for (const part of Array.isArray(data?.content) ? data.content : []) {
      if (part?.type === 'text' && typeof part.text === 'string') texts.push(part.text)
      if (part?.type === 'tool_use') addAction(part.name, part.input)
    }
  } else {
    const message = data?.choices?.[0]?.message
    if (typeof message?.content === 'string') texts.push(message.content)
    for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
      addAction(call?.function?.name, call?.function?.arguments)
    }
  }
  return { content: texts.join('\n').trim() || '（空回复）', actions }
}

/**
 * 发起对话。自适应策略：
 * 1. 不带采样参数请求（兼容性最广）；
 * 2. 若服务端 400 明确要求 temperature（如 "only 1 is allowed"），自动带 temperature=1 重试一次。
 */
export async function chat(config: AIConfig, history: Msg[], userText: string, tools: AIChatTool[] = []): Promise<AIResult> {
  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userText },
  ]

  const first = await postChat(config, messages, { tools })
  if (first.status === 200) {
    try {
      return { ok: true, ...parseResponse(config, first.body) }
    } catch {
      return { ok: false, error: `响应解析失败：${first.body.slice(0, 200)}` }
    }
  }
  // 400 且提示 temperature 限制 → 按服务端要求重试
  if (first.status === 400 && /temperature/i.test(first.body)) {
    const retry = await postChat(config, messages, { temperature: 1, tools })
    if (retry.status === 200) {
      try {
        return { ok: true, ...parseResponse(config, retry.body), retried: true }
      } catch {
        return { ok: false, error: `响应解析失败：${retry.body.slice(0, 200)}` }
      }
    }
    return { ok: false, error: summarizeError(retry.status, retry.body) }
  }
  return { ok: false, error: summarizeError(first.status, first.body) }
}

/** 验证 API Key：请求 /models（零 token 消耗），返回可用模型列表 */
export async function validateKey(config: AIConfig): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const endpointError = validateEndpoint(config)
  if (endpointError) return { ok: false, error: endpointError }
  let res: Response
  try {
    res = await fetch(`${norm(config.baseUrl)}/models`, {
      headers: authHeaders(config),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    return { ok: false, error: `网络请求失败：${e instanceof Error ? e.message : String(e)}` }
  }
  if (res.status === 200) {
    try {
      const data = await res.json()
      const models: string[] = (data?.data ?? []).map((m: { id?: string }) => m.id).filter(Boolean)
      return { ok: true, models }
    } catch {
      return { ok: true }
    }
  }
  return { ok: false, error: summarizeError(res.status, await res.text()) }
}

/** 把错误体提炼成一行可读信息（保留服务端 message） */
function summarizeError(status: number, body: string): string {
  if (status === 0) return `网络请求失败：${body.slice(0, 150)}`
  try {
    const data = JSON.parse(body)
    const msg = data?.error?.message ?? data?.message
    if (msg) return `HTTP ${status}：${String(msg).slice(0, 200)}`
  } catch {
    /* body 非 JSON */
  }
  return `HTTP ${status}：${body.slice(0, 200)}`
}
