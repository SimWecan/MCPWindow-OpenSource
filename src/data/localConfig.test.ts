import { describe, expect, it } from 'vitest'
import { parseMCPConfig } from './localConfig'

describe('mcp.json 导入', () => {
  it('同时识别 stdio 与 streamable-http 配置', () => {
    const result = parseMCPConfig({ mcpServers: {
      local: { command: 'npx', args: ['-y', 'server local', '--root=C:\\a b'], env: { TOKEN: 'secret', PORT: 8090 }, note: '本地工具' },
      remote: { url: 'https://example.com/mcp', name: '远程服务', headers: { Authorization: 'Bearer key' } },
    } })
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      name: 'local', command: 'npx', args: '-y "server local" "--root=C:\\\\a b"', transport: 'stdio',
      argList: ['-y', 'server local', '--root=C:\\a b'], env: { TOKEN: 'secret' },
    })
    expect(result[1]).toMatchObject({
      name: 'remote', command: 'https://example.com/mcp', transport: 'streamable-http',
      headers: { Authorization: 'Bearer key' },
    })
  })

  it('忽略无效项和缺少命令的配置', () => {
    expect(parseMCPConfig({ mcpServers: {
      empty: {}, invalid: 'text', valid: { command: 'node', args: 'server.js' },
    } })).toEqual([{ name: 'valid', description: 'valid', command: 'node', args: 'server.js', transport: 'stdio' }])
  })

  it('空输入和不支持的结构返回空数组', () => {
    expect(parseMCPConfig(null)).toEqual([])
    expect(parseMCPConfig({ mcpServers: {} })).toEqual([])
    expect(parseMCPConfig({ mcpServers: 'invalid' })).toEqual([])
  })
})
