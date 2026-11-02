import { describe, expect, it } from 'vitest'
import packageInfo from '../../package.json'
import { checkForUpdates, compareVersions } from './updateCheck'

const response = (status: number, body: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response
const validArtifact = { url: 'https://software.terrafin.top/downloads/MCPWindow-Setup-99.0.0.exe', size: 123456, sha256: 'a'.repeat(64) }

describe('软件版本检查', () => {
  it('按数字语义化版本比较而非字符串比较', () => {
    expect(compareVersions('0.8.9', '0.8.10')).toBeGreaterThan(0)
    expect(compareVersions('0.8.5', 'v0.8.5')).toBe(0)
    expect(compareVersions('0.9.0', '0.8.9')).toBeLessThan(0)
  })

  it('发现下载站新版本时返回经过校验的 Windows 安装包', async () => {
    const result = await checkForUpdates(async () => response(200, {
      version: '99.0.0', publishedAt: '2026-11-02T00:00:00Z', artifacts: { 'win32-x64': validArtifact },
    }))
    expect(result.updateAvailable).toBe(true)
    expect(result.latestVersion).toBe('99.0.0')
    expect(result.currentVersion).toBe(packageInfo.version)
    expect(result.artifacts['win32-x64']).toEqual(validArtifact)
  })

  it('拒绝跨域、HTTP、无效摘要和异常大小的下载信息', async () => {
    const invalid = [
      { ...validArtifact, url: 'http://software.terrafin.top/update.exe' },
      { ...validArtifact, url: 'https://example.com/update.exe' },
      { ...validArtifact, sha256: 'invalid' },
      { ...validArtifact, size: -1 },
      { ...validArtifact, size: 601 * 1024 * 1024 },
    ]
    for (const item of invalid) {
      const result = await checkForUpdates(async () => response(200, { version: '99.0.0', artifacts: { 'win32-x64': item } }))
      expect(result.artifacts['win32-x64']).toBeUndefined()
    }
  })

  it('同版本、无清单和无效响应均可识别', async () => {
    const current = await checkForUpdates(async () => response(200, { version: `v${packageInfo.version}` }))
    expect(current.updateAvailable).toBe(false)
    await expect(checkForUpdates(async () => response(404))).rejects.toThrow('NO_RELEASE')
    await expect(checkForUpdates(async () => response(200, { name: 'invalid' }))).rejects.toThrow('INVALID_RELEASE')
    await expect(checkForUpdates(async () => response(503))).rejects.toThrow('UPDATE_HTTP_503')
  })
})
