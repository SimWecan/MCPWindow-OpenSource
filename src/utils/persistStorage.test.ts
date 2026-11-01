import { afterEach, describe, expect, it, vi } from 'vitest'
import { persistStorage } from './persistStorage'

afterEach(() => vi.unstubAllGlobals())

describe('系统加密持久化', () => {
  it('桌面端只把密文写入 localStorage，并可解密恢复', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('window', { mcpwindow: { secureStorage: {
      isAvailable: vi.fn().mockResolvedValue(true),
      encrypt: vi.fn().mockImplementation(async (value: string) => Buffer.from(value).toString('base64')),
      decrypt: vi.fn().mockImplementation(async (value: string) => Buffer.from(value, 'base64').toString('utf8')),
    } } })

    await persistStorage.setItem('store', '{"apiKey":"plain-secret"}')
    const stored = values.get('store')!
    expect(stored).toMatch(/^mcpwindow-encrypted:v1:/)
    expect(stored).not.toContain('plain-secret')
    await expect(persistStorage.getItem('store')).resolves.toBe('{"apiKey":"plain-secret"}')
  })

  it('加密较慢的旧快照不会覆盖较新的配置', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    vi.stubGlobal('window', { mcpwindow: { secureStorage: {
      isAvailable: vi.fn().mockResolvedValue(true),
      encrypt: vi.fn().mockImplementation(async (value: string) => {
        if (value === 'old') await new Promise((resolve) => setTimeout(resolve, 20))
        return Buffer.from(value).toString('base64')
      }),
      decrypt: vi.fn().mockImplementation(async (value: string) => Buffer.from(value, 'base64').toString('utf8')),
    } } })
    await Promise.all([persistStorage.setItem('store', 'old'), persistStorage.setItem('store', 'new')])
    await expect(persistStorage.getItem('store')).resolves.toBe('new')
  })
})
