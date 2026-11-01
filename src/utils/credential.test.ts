import { describe, expect, it } from 'vitest'
import { buildManagedCredentialPayload, generateLocalKey } from './credential'

const form = {
  name: 'client', scopes: ['p1'], rateLimitPerMin: 60, expiresDays: 3, enabled: true, role: 'admin' as const,
}
const partitionName = () => 'project-a'

describe('凭证安全编辑', () => {
  it('未触碰有效期时不发送 expires_at，后端保留原值', () => {
    const payload = buildManagedCredentialPayload(form, partitionName, { editing: true, expiryTouched: false, preserveGlobalRole: false })
    expect(payload).not.toHaveProperty('expires_at')
    expect(payload.grants).toEqual({ 'project-a': 'admin' })
  })

  it('全局角色编辑不发送 grants，避免降级为分区凭证', () => {
    const payload = buildManagedCredentialPayload(form, partitionName, { editing: true, expiryTouched: false, preserveGlobalRole: true })
    expect(payload).not.toHaveProperty('grants')
    expect(payload).not.toHaveProperty('expires_at')
  })

  it('显式修改有效期时才更新，本地 Key 使用安全随机数', () => {
    const payload = buildManagedCredentialPayload(form, partitionName, { editing: true, expiryTouched: true, preserveGlobalRole: true })
    expect(typeof payload.expires_at).toBe('string')
    const first = generateLocalKey()
    expect(first).toMatch(/^mcpsk_live_[0-9a-f]{48}$/)
    expect(generateLocalKey()).not.toBe(first)
  })
})
