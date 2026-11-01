import type { AIProtocol } from '../types'

export interface AIProviderPreset {
  id: string
  name: string
  baseUrl: string
  protocol: AIProtocol
  model: string
}

/** 模型 ID 仅是可修改的初始值；保存时优先使用服务商实际返回的模型目录。 */
export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  { id: 'openai', name: 'ChatGPT（OpenAI）', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-responses', model: 'gpt-5.2' },
  { id: 'anthropic', name: 'Claude（Anthropic）', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic-messages', model: 'claude-sonnet-4-5' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-completions', model: 'deepseek-flash' },
  { id: 'kimi', name: 'Kimi（Moonshot AI）', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai-completions', model: 'kimi-k2.6' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai-completions', model: 'qwen-plus' },
]

export const AI_PROTOCOL_LABELS: Record<AIProtocol, string> = {
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}
