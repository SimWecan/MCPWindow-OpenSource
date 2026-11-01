import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

async function launch(profile: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env = { ...process.env, MCPWINDOW_DEV: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ executablePath: process.env.MCPWINDOW_EXECUTABLE, args: ['.', `--user-data-dir=${profile}`], cwd: root, env })
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible()
  return { app, page }
}

test('关闭消息盒随主窗口移动并自动避让屏幕边缘', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-prompt-position-'))
  const { app } = await launch(profile)
  try {
    await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const area = screen.getDisplayMatching(win.getBounds()).workArea
      win.setBounds({ x: area.x + area.width - 220, y: area.y, width: 400, height: 600 })
      win.close()
    })
    await expect.poll(() => app.windows().length).toBe(2)
    const promptPage = app.windows().find((candidate) => candidate.url().includes('close-dialog.html'))!
    await expect(promptPage.getByRole('heading', { name: '关闭 MCPWindow' })).toBeVisible()
    const before = await app.evaluate(({ BrowserWindow, screen }) => {
      const prompt = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('close-dialog.html'))!
      const area = screen.getDisplayMatching(prompt.getBounds()).workArea
      const bounds = prompt.getBounds()
      return { bounds, right: area.x + area.width, bottom: area.y + area.height }
    })
    expect(before.bounds.x + before.bounds.width).toBeLessThanOrEqual(before.right)
    expect(before.bounds.y + before.bounds.height).toBeLessThanOrEqual(before.bottom)

    await app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'))!
      const area = screen.getDisplayMatching(win.getBounds()).workArea
      win.setPosition(area.x, area.y)
    })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('close-dialog.html'))!.getBounds().x)).not.toBe(before.bounds.x)
  } finally {
    await app.close()
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('关闭选择不改变 MCP 状态，退出后守护进程存活且重启可恢复', async () => {
  test.setTimeout(150_000)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-lifecycle-'))
  let { app, page } = await launch(profile)
  let mcpPid = 0
  try {
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await expect(page.locator('.server-card')).toHaveCount(9)
    const fixture = path.resolve(root, 'tests/fixtures/stdio-mcp.cjs')
    await page.locator('input[type=file]').setInputFiles({
      name: 'mcp.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ mcpServers: { 'lifecycle-mcp': { command: process.execPath, args: [fixture], env: { ELECTRON_RUN_AS_NODE: '1' } } } })),
    })
    const card = page.locator('.server-card', { hasText: 'lifecycle-mcp' })
    await expect(card.getByRole('button', { name: '启动', exact: true })).toBeVisible()
    await card.getByRole('button', { name: '启动', exact: true }).click()
    await expect(card.getByText('在线', { exact: true })).toBeVisible()
    console.log('lifecycle: started')
    mcpPid = Number(await page.evaluate(async () => {
      const bridge = (window as unknown as { mcpwindow: { procList: () => Promise<string[]>; procMetrics: (ids: string[]) => Promise<{ pid: number }[]> } }).mcpwindow
      return (await bridge.procMetrics(await bridge.procList()))[0]?.pid
    }))
    expect(mcpPid).toBeGreaterThan(0)

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect.poll(() => app.windows().length).toBe(2)
    const minimizePrompt = app.windows().find((candidate) => candidate.url().includes('close-dialog.html'))!
    await expect(minimizePrompt.getByRole('heading', { name: '关闭 MCPWindow' })).toBeVisible()
    await minimizePrompt.getByLabel('最小化到系统托盘').check()
    await minimizePrompt.getByRole('button', { name: '确定', exact: true }).click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'))!
      return !win.isVisible()
    })).toBe(true)
    console.log('lifecycle: hidden in tray')
    expect(() => process.kill(mcpPid, 0)).not.toThrow()
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL().includes('index.html'))!
      win.setSkipTaskbar(false)
      win.show()
    })

    const closed = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('index.html'))!.close())
    await expect.poll(() => app.windows().length).toBe(2)
    const quitPrompt = app.windows().find((candidate) => candidate.url().includes('close-dialog.html'))!
    await quitPrompt.getByText('退出应用', { exact: true }).click()
    await quitPrompt.getByRole('button', { name: '确定', exact: true }).click()
    console.log('lifecycle: exit requested')
    await closed
    console.log('lifecycle: app closed')
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect(() => process.kill(mcpPid, 0)).not.toThrow()

    ;({ app, page } = await launch(profile))
    console.log('lifecycle: relaunched')
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    const restored = page.locator('.server-card', { hasText: 'lifecycle-mcp' })
    await expect(restored.getByText('在线', { exact: true })).toBeVisible({ timeout: 20_000 })
    console.log('lifecycle: restored online')
    await restored.getByRole('button', { name: '停止', exact: true }).click()
    await expect(restored.getByText('离线', { exact: true })).toBeVisible({ timeout: 20_000 })
    console.log('lifecycle: stopped')
  } finally {
    await app?.close()
    if (mcpPid) { try { process.kill(mcpPid) } catch { /* already stopped */ } }
    await new Promise((resolve) => setTimeout(resolve, 300))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})

test('远程进程运行但 MCP 需凭证时不误停止，退出应用不发送远程 stop', async () => {
  test.setTimeout(90_000)
  const requests: string[] = []
  const fixture = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'GET' && request.url === '/manage/status') {
      response.end(JSON.stringify({ ok: true, service: 'remote-fixture', status: 'running', pid: 321, started_at: 1, partitions: [], credentials: [] }))
    } else if (request.method === 'POST' && request.url === '/mcp') {
      response.statusCode = 401
      response.end(JSON.stringify({ error: 'credential required' }))
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('远程测试服务地址无效')
  const base = `http://127.0.0.1:${address.port}`
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-remote-lifecycle-'))
  let { app, page } = await launch(profile)
  try {
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await page.getByRole('button', { name: '+ 接入服务器' }).click()
    await page.getByLabel('服务器名称').fill('remote-lifecycle')
    await page.getByLabel('启动命令 / 服务地址').fill(`${base}/mcp`)
    await page.getByLabel('传输方式').selectOption('streamable-http')
    await page.getByText('远程管理（可选）', { exact: true }).click()
    await page.getByLabel('管理接口', { exact: true }).fill(base)
    await page.getByLabel('全局 admin 凭证（仅保存在本机）').fill('admin-secret')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const card = page.locator('.server-card', { hasText: 'remote-lifecycle' })
    await expect(card.getByText('需凭证', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(card.getByRole('button', { name: '停止', exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: '启动', exact: true })).toHaveCount(0)

    const closed = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('index.html'))!.close())
    await expect.poll(() => app.windows().length).toBe(2)
    const quitPrompt = app.windows().find((candidate) => candidate.url().includes('close-dialog.html'))!
    await quitPrompt.getByText('退出应用', { exact: true }).click()
    await quitPrompt.getByRole('button', { name: '确定', exact: true }).click()
    await closed
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(requests.filter((entry) => entry.includes('/manage/process/stop') || entry.startsWith('DELETE '))).toEqual([])

    ;({ app, page } = await launch(profile))
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    const restored = page.locator('.server-card', { hasText: 'remote-lifecycle' })
    // 不点击“重新探测”，配置恢复后必须自动完成真实状态刷新。
    await expect(restored.getByText('需凭证', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(restored.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  } finally {
    await app.close()
    await new Promise<void>((resolve) => fixture.close(() => resolve()))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
})
