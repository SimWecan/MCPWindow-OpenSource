import { describe, expect, it } from 'vitest'
import { compareVersions, pluginDigest, stableSerialize, verifyPluginSignature } from '../../electron/pluginTrust.cjs'

describe('插件完整性摘要', () => {
  it('稳定序列化忽略对象键顺序但保留数组顺序', () => {
    expect(stableSerialize({ b: [2, 1], a: true })).toBe('{"a":true,"b":[2,1]}')
  })

  it('验证合法摘要并发现清单或入口篡改', () => {
    const manifest = { id: 'example', version: '1.0.0', entry: 'index.js' }
    const entry = Buffer.from('function run() { return true }')
    const signed = { ...manifest, signature: pluginDigest(manifest, entry) }
    expect(verifyPluginSignature(signed, entry)).toBe('valid')
    expect(verifyPluginSignature({ ...signed, version: '1.0.1' }, entry)).toBe('invalid')
    expect(verifyPluginSignature(signed, Buffer.from('tampered'))).toBe('invalid')
    expect(verifyPluginSignature(manifest, entry)).toBe('unsigned')
    expect(verifyPluginSignature({ ...manifest, signature: 'not-a-digest' }, entry)).toBe('invalid')
  })
})

describe('插件 SemVer 比较', () => {
  it('比较正式版和预发布版本', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.0-beta.2', '1.2.0-beta.11')).toBe(-1)
    expect(compareVersions('1.2.0', '1.2.0-rc.1')).toBe(1)
  })
  it('拒绝非 SemVer 版本', () => {
    expect(() => compareVersions('2026.10', '1.0.0')).toThrow('SemVer')
  })
})
