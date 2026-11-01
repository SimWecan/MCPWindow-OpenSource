import { describe, expect, it } from 'vitest'
import { AI_PROVIDER_PRESETS } from './aiProviderPresets'

describe('AI 服务商预设', () => {
  it('覆盖五类服务商并使用匹配的协议', () => {
    expect(Object.fromEntries(AI_PROVIDER_PRESETS.map((preset) => [preset.id, preset.protocol]))).toEqual({
      openai: 'openai-responses',
      anthropic: 'anthropic-messages',
      deepseek: 'openai-completions',
      kimi: 'openai-completions',
      qwen: 'openai-completions',
    })
    for (const preset of AI_PROVIDER_PRESETS) {
      expect(preset.baseUrl).toMatch(/^https:\/\//)
      expect(preset.model).toBeTruthy()
    }
  })
})
