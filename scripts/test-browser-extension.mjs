import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const extensionPath = path.join(root, 'browser-extension')
const profile = path.join(root, 'test-results', 'extension-profile')
const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
if (!existsSync(edge)) throw new Error('未找到 Edge，可通过 EDGE_PATH 指定 Chromium 浏览器')
await fs.rm(profile, { recursive: true, force: true })
let fixtureLogs = [
  { request_id: 'request-1', timestamp: new Date(Date.now() - 60000).toISOString(), path: '/mcp', status: 200 },
  { request_id: 'request-2', timestamp: new Date().toISOString(), path: '/mcp', status: 200 },
]
const server = createServer((request, response) => {
  if (new URL(request.url, 'http://fixture').pathname === '/manage/access-logs') {
    if (request.headers.authorization !== 'Bearer dummy-admin') {
      response.writeHead(403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'forbidden' }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ logs: fixtureLogs }))
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>Extension fixture</title><body><h1>MCPWindow 钉住测试页</h1></body>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
const url = `http://127.0.0.1:${address.port}/`
let context
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: edge, headless: false, viewport: { width: 1100, height: 760 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  let worker = context.serviceWorkers()[0]
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  const alarm = await worker.evaluate(async () => chrome.alarms.get('mcpwindow-access-log-sync'))
  expect(alarm?.periodInMinutes).toBe(30)
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`)
  await expect(popup.locator('#summary')).toHaveText('尚未添加远程 MCP 服务器')
  await expect(popup.locator('.empty')).toHaveCount(0)
  await expect(popup.locator('body')).toHaveCSS('width', '480px')
  await expect(popup.locator('#pin')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(popup.locator('#pin svg')).toBeVisible()
  await popup.evaluate(async managementUrl => {
    await chrome.storage.local.set({ servers: [
      { id: 'first', name: 'Alpha', url: 'http://127.0.0.1:9/mcp', authType: 'bearer', credential: 'dummy-secret', managementUrl, managementKey: 'dummy-admin', status: 'unknown' },
      { id: 'second', name: 'Beta', url: 'http://127.0.0.1:9/mcp', authType: 'none', credential: '', status: 'unknown' },
    ] })
  }, `http://127.0.0.1:${address.port}/manage`)
  await popup.reload()
  await expect(popup.locator('.server')).toHaveCount(2)
  await popup.locator('#server-search').fill('Alpha')
  await expect(popup.locator('.server')).toHaveCount(1)
  await expect(popup.locator('.server-name')).toHaveText('Alpha')
  await popup.locator('#server-search').fill('')
  await popup.locator('#server-status-filter').selectOption('offline')
  await expect(popup.locator('.server')).toHaveCount(2)
  await popup.locator('#server-sort').selectOption('name')
  await expect(popup.locator('.server-name').first()).toHaveText('Alpha')
  await popup.locator('#server-search').fill('not-found')
  await expect(popup.locator('.empty-result')).toHaveText('没有符合条件的服务器')
  await popup.locator('#server-search').fill('')
  await popup.locator('#server-status-filter').selectOption('all')
  await popup.locator('#server-sort').selectOption('custom')
  console.log('✓ 服务器搜索、状态筛选、排序和空结果')

  await popup.locator('#json-panel summary').click()
  await popup.locator('#config-json').fill(JSON.stringify({ mcpServers: {
    parsed: { url: 'https://example.com/mcp', headers: { 'X-Custom-Key': 'dummy-key' } },
    local: { command: 'node', args: ['server.js'] },
  } }))
  await popup.locator('#parse-json').click()
  await expect(popup.locator('#name')).toHaveValue('parsed')
  await expect(popup.locator('#url')).toHaveValue('https://example.com/mcp')
  await expect(popup.locator('#auth-type')).toHaveValue('api-key')
  await expect(popup.locator('#header-name')).toHaveValue('X-Custom-Key')
  await expect(popup.locator('#credential')).toHaveValue('dummy-key')
  await expect(popup.locator('#parse-message')).toContainText('识别到 1 台远程服务器')
  await expect(popup.locator('#parse-message')).toContainText('跳过 1 项')
  console.log('✓ 智能识别、认证字段填写和 stdio 跳过提示')

  await popup.locator('[data-server-id="first"]').click()
  await expect(popup.locator('#detail-view')).toBeVisible()
  await expect(popup.locator('#detail-name')).toHaveText('Alpha')
  await expect(popup.locator('#detail-url')).toHaveText('http://127.0.0.1:9/mcp')
  await expect(popup.locator('#detail-auth')).toHaveText('Bearer Token')
  await expect(popup.locator('#detail-view')).not.toContainText('dummy-secret')
  await expect(popup.locator('#detail-view')).not.toContainText('dummy-admin')
  await expect(popup.locator('#trend-chart svg')).toBeVisible()
  await expect(popup.locator('#hourly-chart svg')).toBeVisible()
  await expect(popup.locator('#log-total-24h')).toHaveText('2')
  await expect(popup.locator('#endpoint-chart')).toContainText('/mcp')
  await popup.locator('#log-settings summary').click()
  await popup.locator('#save-log-settings').click()
  await expect(popup.locator('#log-settings-message')).toContainText('日志接口已保存')
  fixtureLogs = [...fixtureLogs, { request_id: 'request-3', timestamp: new Date().toISOString(), path: '/mcp', status: 200 }]
  await popup.locator('#refresh-detail').click()
  await expect(popup.locator('#log-total-24h')).toHaveText('3')
  await popup.reload()
  await popup.locator('[data-server-id="first"]').click()
  await expect(popup.locator('#log-total-24h')).toHaveText('3')
  await popup.locator('#back').click()
  console.log('✓ 30 分钟日志 alarm、管理凭证鉴权、SVG 图表、增量去重及刷新持久化')
  console.log('✓ 卡片点击进入可视化详情且不显示凭证')

  const first = await popup.locator('[data-server-id="first"]').boundingBox()
  const second = await popup.locator('[data-server-id="second"]').boundingBox()
  await popup.mouse.move(first.x + 70, first.y + 30)
  await popup.mouse.down()
  await popup.waitForTimeout(650)
  await popup.mouse.move(second.x + 70, second.y + second.height * 0.8, { steps: 8 })
  await popup.mouse.up()
  await expect(popup.locator('.server-name').first()).toHaveText('Beta')
  await popup.reload()
  await expect(popup.locator('.server-name').first()).toHaveText('Beta')
  console.log('✓ 插件长按排序并在刷新后保持')

  const web = await context.newPage()
  await web.goto(url)
  await web.bringToFront()
  // 模拟部分浏览器/权限状态不返回 tab.url，钉住仍须正常工作。
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    await chrome.tabs.sendMessage(tab.id, { type: 'mcpwindow-panel-toggle' })
  })
  const host = web.locator('#mcpwindow-companion-panel')
  await expect(host).toBeVisible()
  await expect.poll(() => web.frames().some(frame => frame.url().includes('popup.html?embedded=1'))).toBe(true)
  const panel = web.frames().find(frame => frame.url().includes('popup.html?embedded=1'))
  await expect(panel.locator('.brand strong')).toHaveText('MCPWindow')
  await web.screenshot({ path: path.join(root, 'test-results', 'extension-panel.png') })
  await web.locator('h1').click()
  await expect(host).toBeVisible()
  const before = await host.boundingBox()
  expect(before.width).toBeGreaterThanOrEqual(500)
  const header = await panel.locator('#window-header').boundingBox()
  await web.mouse.move(header.x + 150, header.y + 25)
  await web.mouse.down()
  await web.mouse.move(header.x + 50, header.y + 99, { steps: 8 })
  await web.mouse.up()
  await expect.poll(async () => (await host.boundingBox()).x).not.toBe(before.x)
  const after = await host.boundingBox()
  expect(after.x).not.toBe(before.x)
  expect(after.y).not.toBe(before.y)
  expect(after.x).toBeGreaterThanOrEqual(0)
  expect(after.y).toBeGreaterThanOrEqual(0)
  expect(after.x + after.width).toBeLessThanOrEqual(1100)
  expect(after.y + after.height).toBeLessThanOrEqual(760)
  await expect.poll(async () => popup.evaluate(async () => (await chrome.storage.local.get('panelPosition')).panelPosition?.left)).toBe(Math.round(after.x))
  await panel.locator('#pin').click()
  await expect(host).toHaveCount(0)
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'mcpwindow-panel-toggle' }))
  await expect(host).toBeVisible()
  await expect.poll(async () => (await host.boundingBox()).x).toBe(Math.round(after.x))
  await expect.poll(async () => (await host.boundingBox()).y).toBe(Math.round(after.y))
  console.log('✓ 网页内钉住、标题区拖动、位置持久化、视口边界和取消钉住')

  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'mcpwindow-panel-toggle' }))
  await expect(host).toHaveCount(0)
  await popup.bringToFront()
  await popup.evaluate(async () => {
    const servers = Array.from({ length: 18 }, (_, index) => ({
      id: `scroll-${index}`, name: `Scroll ${index}`, url: 'http://127.0.0.1:9/mcp',
      authType: 'none', credential: '', status: 'unknown',
    }))
    await chrome.storage.local.set({ servers })
  })
  await popup.reload()
  await expect(popup.locator('.server')).toHaveCount(18)
  await expect(popup.locator('#list-view')).toBeVisible()
  await expect(popup.locator('.server').first()).toBeVisible()
  await popup.locator('.server').first().scrollIntoViewIfNeeded()
  const scrollCard = await popup.locator('.server').first().boundingBox()
  await popup.mouse.move(scrollCard.x + 80, scrollCard.y + 25)
  await popup.mouse.down()
  await popup.waitForTimeout(650)
  await popup.mouse.move(scrollCard.x + 80, 744)
  await expect.poll(() => popup.evaluate(() => document.scrollingElement?.scrollTop || 0)).toBeGreaterThan(0)
  await popup.locator('#servers').evaluate(element => element.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })))
  await popup.mouse.up()
  const stoppedScroll = await popup.evaluate(() => document.scrollingElement?.scrollTop || 0)
  await popup.waitForTimeout(250)
  expect(Math.abs((await popup.evaluate(() => document.scrollingElement?.scrollTop || 0)) - stoppedScroll)).toBeLessThanOrEqual(1)
  console.log('✓ 卡片拖到窗口边缘自动滚动，取消后立即停止')
  console.log('浏览器扩展真实交互测试全部通过')
} finally {
  await context?.close()
  await new Promise(resolve => server.close(resolve))
}
