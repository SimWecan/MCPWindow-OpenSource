import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let app: ElectronApplication
let page: Page
let profile: string

test.beforeEach(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-bilingual-'))
  const env = { ...process.env, MCPWINDOW_DEV: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: process.env.MCPWINDOW_EXECUTABLE, args: ['.', `--user-data-dir=${profile}`], cwd: root, env })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible()
})

test.afterEach(async () => {
  await app?.close()
  fs.rmSync(profile, { recursive: true, force: true })
})

test('添加服务器智能识别和版本更新检查均支持英文', async () => {
  await page.route('https://software.terrafin.top/downloads/version.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      version: '99.0.0', artifacts: { 'darwin-arm64': { url: 'https://software.terrafin.top/downloads/MCPWindow-99.0.0-arm64.dmg', size: 123456, sha256: 'a'.repeat(64) } },
    }),
  }))
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('mcpwindow:update-download')
    ipcMain.handle('mcpwindow:update-download', (_event, artifact) => {
      ;(globalThis as unknown as { requestedUpdate: unknown }).requestedUpdate = artifact
      return true
    })
  })
  await page.getByRole('button', { name: '界面设置', exact: true }).click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Check version updates', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'New version available', exact: true })
  await expect(confirmation).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { requestedUpdate?: unknown }).requestedUpdate)).toBeUndefined()
  await confirmation.getByRole('button', { name: 'Update now', exact: true }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { requestedUpdate?: { url: string } }).requestedUpdate?.url)).toContain('MCPWindow-99.0.0-arm64.dmg')
  await page.reload()

  await page.getByRole('link', { name: /Servers$/ }).click()
  await page.getByRole('button', { name: '+ Add server', exact: true }).click()
  await page.locator('.smart-config-import summary').click()
  await page.locator('#server-config-json').fill(JSON.stringify({ mcpServers: {
    demo: { url: 'https://example.com/mcp', headers: { 'X-Custom-Key': 'dummy-secret' } },
  } }))
  await page.getByRole('button', { name: 'Parse and fill', exact: true }).click()
  await expect(page.locator('#server-name')).toHaveValue('demo')
  await expect(page.locator('#server-command')).toHaveValue('https://example.com/mcp')
  await expect(page.locator('#server-transport')).toHaveValue('streamable-http')
  await expect(page.locator('#server-access-type')).toHaveValue('api-key')
  await expect(page.locator('#server-api-header')).toHaveValue('X-Custom-Key')
  await expect(page.locator('#server-access-key')).toHaveValue('dummy-secret')
  await expect(page.getByRole('status')).toContainText('Filled “demo”')

  await page.locator('#server-config-json').fill(JSON.stringify({ mcpServers: {
    local: { command: 'node', args: ['server.js', '--root=./data'], env: { MODE: 'test' } },
  } }))
  await page.getByRole('button', { name: 'Parse and fill', exact: true }).click()
  await expect(page.locator('#server-name')).toHaveValue('local')
  await expect(page.locator('#server-command')).toHaveValue('node')
  await expect(page.locator('#server-args')).toHaveValue('server.js --root=./data')
  await expect(page.locator('#server-transport')).toHaveValue('stdio')
})
