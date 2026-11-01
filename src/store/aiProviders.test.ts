import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from './useStore'

const original = {
  aiProviders: useStore.getState().aiProviders,
  activeAIProviderId: useStore.getState().activeAIProviderId,
}
afterEach(() => useStore.setState(original))

describe('多 AI 提供方', () => {
  it('隔离 API Key、模型目录和当前模型，删除后切换有效提供方', () => {
    const first = useStore.getState().addAIProvider({ name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'key-a', model: 'deepseek-chat', models: ['deepseek-chat'], protocol: 'openai-completions' })
    const second = useStore.getState().addAIProvider({ name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'key-b', model: 'kimi-k2.6', models: ['kimi-k2.6'], protocol: 'openai-completions' })
    expect(second).not.toBe(first)
    expect(useStore.getState().activeAIProviderId).toBe(second)

    useStore.getState().updateAIProvider(first, { models: ['deepseek-chat', 'deepseek-reasoner'], model: 'deepseek-reasoner' })
    useStore.getState().setActiveAIProvider(first)
    expect(useStore.getState().aiProviders.find((item) => item.id === second)?.apiKey).toBe('key-b')
    expect(useStore.getState().aiProviders.find((item) => item.id === first)?.model).toBe('deepseek-reasoner')

    useStore.getState().removeAIProvider(first)
    expect(useStore.getState().activeAIProviderId).toBe(useStore.getState().aiProviders[0].id)
    expect(useStore.getState().activeAIProviderId).not.toBe(first)
  })

  it('旧版提供方迁移后保持 Chat Completions 协议', () => {
    const options = useStore.persist.getOptions()
    expect(options.version).toBe(7)
    const migrated = options.migrate?.({
      aiProviders: [{ id: 'legacy', name: 'Legacy', baseUrl: 'https://legacy.example/v1', apiKey: 'key', model: 'old-model', models: ['old-model'] }],
      activeAIProviderId: 'legacy',
    }, 4) as { aiProviders: Array<{ id: string; protocol: string }> }
    expect(migrated.aiProviders).toEqual([expect.objectContaining({ id: 'legacy', protocol: 'openai-completions' })])
  })
})
