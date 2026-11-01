import { describe, expect, it } from 'vitest'
import { migrateLegacyManagementUrl, validateServerConfig, type ServerConfigInput } from './serverConfig'

const base: ServerConfigInput = {
  name: 'demo', partitionId: 'p1', command: 'node server.js', transport: 'stdio',
}

describe('服务器配置校验', () => {
  it('接受有效的本地命令与本机管理配置', () => {
    expect(validateServerConfig({ ...base, managementUrl: 'http://127.0.0.1:8091', managementKey: 'secret' })).toBeNull()
  })

  it('要求命令以及传输方式与地址匹配', () => {
    expect(validateServerConfig({ ...base, command: ' ' })).toContain('启动命令')
    expect(validateServerConfig({ ...base, command: 'https://example.com/mcp' })).toContain('stdio')
    expect(validateServerConfig({ ...base, command: 'node server.js', transport: 'streamable-http' })).toContain('http(s)')
  })

  it('拒绝非本机明文 HTTP', () => {
    expect(validateServerConfig({ ...base, command: 'http://example.com/mcp', transport: 'streamable-http' })).toContain('HTTPS')
  })

  it('要求管理地址和凭证成对配置', () => {
    expect(validateServerConfig({ ...base, managementUrl: 'http://127.0.0.1:8091' })).toContain('同时填写')
    expect(validateServerConfig({ ...base, managementKey: 'secret' })).toContain('同时填写')
  })

  it('拒绝无效或非本机明文管理地址', () => {
    expect(validateServerConfig({ ...base, managementUrl: 'not-a-url', managementKey: 'secret' })).toContain('格式无效')
    expect(validateServerConfig({ ...base, managementUrl: 'http://example.com', managementKey: 'secret' })).toContain('HTTPS')
  })

  it('拒绝把 MCP 连接端点当作管理接口', () => {
    expect(validateServerConfig({ ...base, managementUrl: 'http://127.0.0.1:8090/mcp', managementKey: 'secret' })).toContain('8091')
  })

  it('自动迁移 TerraFin 旧管理地址且不影响其他服务器', () => {
    const legacy = { name: 'TerraFin-MCP', command: 'https://mcp.terrafin.top/mcp', managementUrl: 'http://127.0.0.1:8090/mcp' }
    expect(migrateLegacyManagementUrl(legacy)).toEqual({ ...legacy, managementUrl: 'http://127.0.0.1:8091' })
    const unrelated = { ...legacy, name: 'other', command: 'https://example.com/mcp' }
    expect(migrateLegacyManagementUrl(unrelated)).toBe(unrelated)
  })
})
