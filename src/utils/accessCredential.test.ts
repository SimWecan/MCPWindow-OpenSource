import { describe, expect, it } from 'vitest'
import { decodeBasicCredential, getBearerCredential, validateHeaderName, withAccessCredential, withBearerCredential } from './accessCredential'

describe('远程 MCP 访问凭证', () => {
  it('读取 Bearer 凭证且不混淆 admin 凭证', () => {
    expect(getBearerCredential({ authorization: 'Bearer mcp-access' })).toBe('mcp-access')
    expect(getBearerCredential({ 'X-Admin': 'admin-secret' })).toBe('')
  })

  it('更新凭证时保留其他请求头，清空时移除 Authorization', () => {
    const headers = { authorization: 'Bearer old', 'X-Tenant': 'demo' }
    expect(withBearerCredential(headers, ' new-key ')).toEqual({ 'X-Tenant': 'demo', Authorization: 'Bearer new-key' })
    expect(withBearerCredential(headers, '')).toEqual({ 'X-Tenant': 'demo' })
    expect(withBearerCredential({ Authorization: 'Bearer old' }, '')).toBeUndefined()
  })

  it('生成可解码的 Basic Auth，支持 UTF-8 并移除旧 Bearer', () => {
    const headers = withAccessCredential({ Authorization: 'Bearer old', 'X-Tenant': 'demo' }, { type: 'basic', username: '用户', credential: 'p@ss:word' })
    expect(headers?.Authorization).toMatch(/^Basic /)
    expect(decodeBasicCredential(headers!.Authorization.replace(/^Basic /, ''))).toEqual({ username: '用户', credential: 'p@ss:word' })
    expect(headers?.['X-Tenant']).toBe('demo')
  })

  it('使用自定义 API Key 请求头且不生成 Authorization', () => {
    expect(withAccessCredential({ Authorization: 'Bearer old' }, { type: 'api-key', credential: ' api-secret ', headerName: 'X-Custom-Key' })).toEqual({ 'X-Custom-Key': 'api-secret' })
    expect(validateHeaderName('X-API-Key')).toBe(true)
    expect(validateHeaderName('Bad Header')).toBe(false)
  })
})
