import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let app: ElectronApplication
let page: Page
let profile: string
const pageErrors: string[] = []

test.beforeAll(async () => {
  // 使用系统临时目录，避免项目目录 ACL / 同步软件干扰 Chromium 配置清理。
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-e2e-'))
  const env = { ...process.env, MCPWINDOW_DEV: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    executablePath: process.env.MCPWINDOW_EXECUTABLE,
    args: ['.', `--user-data-dir=${profile}`],
    cwd: root,
    env,
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
  // Windows 安全软件可能短暂占用用户目录句柄；退出后稍等并有限重试。
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

test('桌面窗口可导航、创建分区、导入完整配置并隔离演示日志', async () => {
  const secureStorage = await page.evaluate(async () => {
    const bridge = (window as unknown as { mcpwindow?: { secureStorage: { isAvailable: () => Promise<boolean> } } }).mcpwindow
    return bridge ? bridge.secureStorage.isAvailable() : false
  })
  expect(secureStorage).toBe(true)
  const navTo = (name: string) => page.getByRole('link', { name: new RegExp(`${name}$`) })
  for (const [nav, heading] of [
    ['分区管理', '分区管理'],
    ['服务器管理', '服务器管理 · 主控台'],
    ['凭证发放', '凭证发放'],
    ['日志统计', '日志统计'],
    ['AI 辅助管理', 'AI 辅助管理'],
    ['总览', '总览'],
  ]) {
    await navTo(nav).click()
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
  }

  await navTo('分区管理').click()
  await page.getByRole('button', { name: '+ 新建分区' }).click()
  await page.getByPlaceholder('例如：开发工具').fill('P2 自动化分区')
  await page.getByPlaceholder('分区的用途说明').fill('桌面端真实交互验证')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.partition-name', { hasText: 'P2 自动化分区' })).toBeVisible()

  await navTo('服务器管理').click()
  const config = {
    mcpServers: {
      'p2-e2e': {
        command: 'node',
        args: ['server.js', '--stdio'],
        env: { P2_ENV: 'preserved' },
        headers: { Authorization: 'Bearer e2e-secret' },
      },
    },
  }
  await page.locator('input[type=file]').setInputFiles({
    name: 'mcp.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config)),
  })
  await expect(page.getByText('已导入 1 个服务器', { exact: true })).toBeVisible()
  const persisted = await page.evaluate(async () => {
    const stored = localStorage.getItem('mcpwindow-store-v1')
    if (!stored) return null
    const prefix = 'mcpwindow-encrypted:v1:'
    const bridge = (window as unknown as { mcpwindow?: { secureStorage: { decrypt: (value: string) => Promise<string> } } }).mcpwindow
    const json = stored.startsWith(prefix) ? await bridge?.secureStorage.decrypt(stored.slice(prefix.length)) : stored
    const state = JSON.parse(json ?? '{}').state
    const server = state.servers?.find((item: { name: string }) => item.name === 'p2-e2e')
    return server ? { env: server.env, headers: server.headers } : null
  })
  expect(persisted).toEqual({ env: { P2_ENV: 'preserved' }, headers: { Authorization: 'Bearer e2e-secret' } })
  await expect(page.locator('.server-name', { hasText: 'p2-e2e' })).toBeVisible()
  await page.locator('.server-name', { hasText: 'p2-e2e' }).click()
  await expect(page.getByText('node server.js --stdio', { exact: true })).toBeVisible()

  await navTo('日志统计').click()
  await expect(page.getByText('近期无崩溃 🎉', { exact: true })).toBeVisible()
  const demoSwitch = page.getByRole('checkbox', { name: '合并显示演示数据' })
  await expect(demoSwitch).not.toBeChecked()
  await demoSwitch.check()
  await expect(page.getByText(/含演示数据 · 近 14 天总访问 [1-9]/)).toBeVisible()
  await demoSwitch.uncheck()
  await expect(page.getByText('近期无崩溃 🎉', { exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('接入窗口可新建分区并连续管理多个独立 MCP 服务器', async () => {
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
  await page.getByRole('button', { name: '新建所属分区', exact: true }).click()
  await page.getByLabel('新分区名称', { exact: true }).fill('独立服务器分组')
  await page.getByRole('button', { name: '创建并选择', exact: true }).click()
  await expect(page.getByLabel('所属分区', { exact: true })).toHaveValue(await page.getByLabel('所属分区', { exact: true }).locator('option', { hasText: '独立服务器分组' }).getAttribute('value') ?? '')

  for (const name of ['独立 MCP Alpha', '独立 MCP Beta']) {
    if (name.endsWith('Beta')) await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill(name)
    await page.getByLabel('描述', { exact: true }).fill(`${name} 的独立连接配置`)
    await page.getByLabel('所属分区', { exact: true }).selectOption({ label: '独立服务器分组' })
    await page.getByLabel('传输方式', { exact: true }).selectOption('streamable-http')
    await page.getByLabel(/启动命令 \/ 服务地址/).fill(`http://127.0.0.1:65530/${name.endsWith('Alpha') ? 'alpha' : 'beta'}`)
    await expect(page.getByLabel('连接认证方式', { exact: true }).locator('option')).toHaveText(['Bearer Token', 'Basic Auth', 'API Key'])
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.server-card', { hasText: name })).toBeVisible()
  }

  const independent = await page.evaluate(async () => {
    const stored = localStorage.getItem('mcpwindow-store-v1')
    const bridge = (window as unknown as { mcpwindow?: { secureStorage: { decrypt: (value: string) => Promise<string> } } }).mcpwindow
    const json = stored?.startsWith('mcpwindow-encrypted:v1:') ? await bridge?.secureStorage.decrypt(stored.slice('mcpwindow-encrypted:v1:'.length)) : stored
    const state = JSON.parse(json ?? '{}').state
    return state.servers?.filter((server: { name: string }) => server.name.startsWith('独立 MCP '))
      .map((server: { id: string; name: string; command: string; partitionId: string }) => ({ id: server.id, name: server.name, command: server.command, partitionId: server.partitionId }))
  })
  expect(independent).toHaveLength(2)
  expect(independent[0].id).not.toBe(independent[1].id)
  expect(independent[0].command).not.toBe(independent[1].command)
  expect(independent[0].partitionId).toBe(independent[1].partitionId)
  for (const name of ['独立 MCP Alpha', '独立 MCP Beta']) {
    await page.locator('.server-card', { hasText: name }).getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '确认删除', exact: true }).click()
    await expect(page.locator('.server-card', { hasText: name })).toHaveCount(0)
  }
  await page.getByRole('link', { name: /分区管理$/ }).click()
  const createdPartition = page.locator('.partition-card', { hasText: '独立服务器分组' })
  await createdPartition.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(createdPartition).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('本地进程立即退出时拒绝假成功并同步离线', async () => {
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'mcp.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ mcpServers: { 'immediate-exit': { command: process.execPath, args: ['-e', 'process.exit(7)'], env: { ELECTRON_RUN_AS_NODE: '1' } } } })),
  })
  await expect(page.getByText('已导入 1 个服务器', { exact: true })).toBeVisible()
  const card = page.locator('.server-card', { hasText: 'immediate-exit' })
  await expect(card.getByRole('button', { name: '启动', exact: true })).toBeVisible()
  await card.getByRole('button', { name: '启动', exact: true }).click()
  await expect(page.getByText(/操作失败：进程操作失败/)).toBeVisible()
  await expect(card.getByText('离线', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: '启动', exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('本地 MCP 完成握手后支持重启和停止', async () => {
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  await expect.poll(() => page.locator('.server-card').count()).toBeGreaterThanOrEqual(9)
  const fixture = path.resolve(root, 'tests/fixtures/stdio-mcp.cjs')
  await page.locator('input[type=file]').setInputFiles({
    name: 'mcp.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ mcpServers: { 'stdio-ready': { command: process.execPath, args: [fixture], env: { ELECTRON_RUN_AS_NODE: '1' } } } })),
  })
  const card = page.locator('.server-card', { hasText: 'stdio-ready' })
  await card.getByRole('button', { name: '启动', exact: true }).click()
  await expect(page.getByText('进程操作已完成', { exact: true })).toBeVisible()
  await expect(card.getByText('在线', { exact: true })).toBeVisible()
  await card.getByRole('button', { name: '重启', exact: true }).click()
  await expect(page.getByText('进程操作已完成', { exact: true })).toBeVisible()
  await expect(card.getByText('在线', { exact: true })).toBeVisible()
  const metrics = page.getByLabel('资源监控 stdio-ready', { exact: true })
  await expect(metrics).toBeVisible()
  await expect(metrics).toContainText(/内存\s+[\d.]+ MB/)
  await expect(metrics).toContainText(/运行\s+\d+ 分钟/)
  await card.getByRole('button', { name: '停止', exact: true }).click()
  await expect(card.getByText('离线', { exact: true })).toBeVisible()
  await expect(metrics).toHaveCount(0)
  await expect(card.getByRole('button', { name: '启动', exact: true })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('普通 Bearer 访问凭证可用于远程 MCP 真实握手', async () => {
  const fixture = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer e2e-ordinary-access') {
      res.writeHead(401).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      jsonrpc: '2.0', id: 1,
      result: {
        protocolVersion: '2024-11-05', capabilities: { tools: {} },
        serverInfo: { name: 'remote-auth-e2e', version: '1.0.0' },
      },
    }))
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/mcp`
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    const addButton = page.getByRole('button', { name: '+ 接入服务器' })
    await addButton.click()
    const nameInput = page.getByLabel('服务器名称', { exact: true })
    await expect(nameInput).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(nameInput).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(addButton).toBeFocused()
    await addButton.click()
    await nameInput.fill('remote-auth-e2e')
    await page.getByLabel('传输方式', { exact: true }).selectOption('streamable-http')
    await page.getByLabel(/启动命令 \/ 服务地址/).fill(url)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const card = page.locator('.server-card', { hasText: 'remote-auth-e2e' })
    await page.getByRole('button', { name: '↻ 重新探测' }).click()
    await expect(card.getByText('需凭证', { exact: true })).toBeVisible()

    await card.getByRole('button', { name: '配置访问凭证', exact: true }).click()
    await page.getByLabel('MCP 访问凭证（Bearer，可选）', { exact: true }).fill('e2e-ordinary-access')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(card.getByText('在线', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()))
  }
})

test('Basic Auth 与 API Key 均按所选请求头完成真实 MCP 握手', async () => {
  const expected = { type: '', authorization: '', apiKey: '' }
  const fixture = createServer((req, res) => {
    if ((req.headers.authorization ?? '') !== expected.authorization || (req.headers['x-custom-key'] ?? '') !== expected.apiKey) { res.writeHead(401).end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'auth-e2e', version: '1' } } }))
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}/mcp`
    for (const item of [
      { name: 'basic-auth-e2e', type: 'basic', username: 'e2e-user', secret: 'basic-pass', authorization: `Basic ${Buffer.from('e2e-user:basic-pass').toString('base64')}`, apiKey: '' },
      { name: 'api-key-e2e', type: 'api-key', username: '', secret: 'api-secret', authorization: '', apiKey: 'api-secret' },
    ]) {
      Object.assign(expected, item)
      await page.getByRole('link', { name: /服务器管理$/ }).click()
      await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
      await page.getByLabel('服务器名称', { exact: true }).fill(item.name)
      await page.getByLabel('传输方式', { exact: true }).selectOption('streamable-http')
      await page.getByLabel(/启动命令 \/ 服务地址/).fill(url)
      await page.getByLabel('连接认证方式', { exact: true }).selectOption(item.type)
      if (item.type === 'basic') {
        await page.getByLabel('Basic Auth 用户名', { exact: true }).fill(item.username)
        await page.getByLabel('Basic Auth 密码', { exact: true }).fill(item.secret)
      } else {
        await page.getByLabel('API Key 请求头', { exact: true }).fill('X-Custom-Key')
        await page.getByLabel('API Key', { exact: true }).fill(item.secret)
      }
      await page.getByRole('button', { name: '测试 MCP 连接', exact: true }).click()
      await expect(page.getByText('MCP 连接与 initialize 握手成功', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.locator('.server-card', { hasText: item.name }).getByText('在线', { exact: true })).toBeVisible()
    }
    expect(pageErrors).toEqual([])
  } finally {
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()))
  }
})

test('窄窗口保留完整主内容且没有页面级横向溢出', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  try {
    for (const name of ['总览', '分区管理', '服务器管理', '凭证发放', '日志统计', 'AI 辅助管理']) {
      const link = page.getByRole('link', { name: new RegExp(`${name}$`) })
      await expect(link).toBeVisible()
      expect(await link.evaluate((element) => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth })).toBe(true)
    }
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await expect(page.getByRole('heading', { name: '服务器管理 · 主控台' })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainWidth: document.querySelector('main')?.scrollWidth ?? 0,
      mainClientWidth: document.querySelector('main')?.clientWidth ?? 0,
    }))
    expect(dimensions.documentWidth).toBe(dimensions.viewport)
    expect(dimensions.mainWidth).toBe(dimensions.mainClientWidth)
    await expect(page.getByRole('button', { name: '+ 接入服务器' })).toBeVisible()
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 })
  }
})

test('Logo 默认主题与三套主题即时切换、持久化', async () => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'aurora')
  const logo = page.getByRole('img', { name: 'MCPWindow Logo' })
  await expect(logo).toBeVisible()
  await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: '界面设置' }).click()
  await page.getByRole('button', { name: /日光白/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight')
  const light = await page.evaluate(() => ({
    saved: localStorage.getItem('mcpwindow-theme'),
    background: getComputedStyle(document.querySelector('.card')!).backgroundColor,
  }))
  expect(light).toEqual({ saved: 'daylight', background: 'rgb(255, 255, 255)' })
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight')
  expect(await page.evaluate(() => localStorage.getItem('mcpwindow-theme'))).toBe('daylight')
  await page.screenshot({ path: 'test-results/theme-daylight.png' })

  await page.getByRole('button', { name: '界面设置' }).click()
  await page.getByRole('button', { name: /暗夜蓝/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight')
  await page.getByRole('button', { name: /极光紫/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'aurora')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-results/theme-aurora.png' })
  expect(pageErrors).toEqual([])
})

test('TerraFin 配置 admin 后立即启动不会被旧状态回读覆盖', async () => {
  let running = false
  let firstStatus = true
  let releaseFirstStatus!: () => void
  const firstStatusGate = new Promise<void>((resolve) => { releaseFirstStatus = resolve })
  const events: string[] = []
  const fixture = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer e2e-terrafin-admin') {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }))
      return
    }
    const status = () => ({
      ok: true, service: 'TerraFin-MCP', status: running ? 'running' : 'stopped',
      pid: running ? 456 : null, started_at: running ? 1 : null, partitions: [], credentials: [],
    })
    if (req.url === '/manage/status') {
      events.push(`status-request:${running ? 'running' : 'stopped'}`)
      if (firstStatus) {
        firstStatus = false
        await firstStatusGate
      }
      events.push(`status-response:${running ? 'running' : 'stopped'}`)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(status()))
    } else if (req.url === '/manage/process/start' && req.method === 'POST') {
      events.push('start')
      running = true
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ operation: {
        id: 'terrafin-start', action: 'start', status: 'succeeded', created_at: '2026-10-27T12:00:00+08:00',
        finished_at: '2026-10-27T12:00:01+08:00', error: null, result: { status: 'running', pid: 456 },
      } }))
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end('{}')
    }
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  try {
    const baseUrl = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await page.getByRole('button', { name: '+ 接入服务器' }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill('TerraFin-MCP')
    await page.getByLabel('传输方式', { exact: true }).selectOption('streamable-http')
    await page.getByLabel(/启动命令 \/ 服务地址/).fill(`${baseUrl}/mcp`)
    await page.locator('summary', { hasText: '远程管理（可选）' }).click()
    await page.getByLabel('管理接口', { exact: true }).fill(baseUrl)
    await page.getByLabel('全局 admin 凭证（仅保存在本机）', { exact: true }).fill('e2e-terrafin-admin')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    const card = page.locator('.server-card', { hasText: 'TerraFin-MCP' })
    await expect(card).toBeVisible()
    // 在 TerraFin 实际工作区运行测试时可能发现真实历史日志；拒绝导入以继续隔离启动竞态。
    await page.waitForTimeout(250)
    const historyPrompt = page.getByRole('dialog', { name: '检测到历史访问记录', exact: true })
    if (await historyPrompt.count()) await historyPrompt.getByRole('button', { name: '不导入历史记录', exact: true }).click()
    await card.getByRole('button', { name: '启动', exact: true }).click()
    await expect.poll(() => events).toContain('status-request:stopped')
    await page.waitForTimeout(100)
    expect(events).not.toContain('start')
    releaseFirstStatus()
    await expect(page.getByText('TerraFin-MCP启动成功，已核实真实运行状态', { exact: true })).toBeVisible()
    await expect(card.getByText('需凭证', { exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: '停止', exact: true })).toBeVisible()
    expect(events).toEqual([
      'status-request:stopped', 'status-response:stopped', 'start',
      'status-request:running', 'status-response:running',
    ])
    expect(pageErrors).toEqual([])
  } finally {
    releaseFirstStatus()
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()))
  }
})

test('AI 多提供方、模型切换与授权确认后真实重启', async () => {
  const targetId = await page.evaluate(async () => {
    const stored = localStorage.getItem('mcpwindow-store-v1')
    const prefix = 'mcpwindow-encrypted:v1:'
    const bridge = (window as unknown as { mcpwindow?: { secureStorage: { decrypt: (value: string) => Promise<string> } } }).mcpwindow
    const json = stored?.startsWith(prefix) ? await bridge?.secureStorage.decrypt(stored.slice(prefix.length)) : stored
    const state = JSON.parse(json ?? '{}').state
    return state.servers?.find((item: { name: string }) => item.name === 'stdio-ready')?.id as string
  })
  expect(targetId).toBeTruthy()
  const chatModels: string[] = []
  const fixture = createServer((req, res) => {
    const headers = {
      'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.url === '/v1/models') {
        res.writeHead(200, headers).end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] }))
      } else if (req.url === '/v1/chat/completions') {
        chatModels.push(JSON.parse(body).model)
        res.writeHead(200, headers).end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [
          { function: { name: 'mcp_server_operation', arguments: JSON.stringify({ serverId: targetId, action: 'restart' }) } },
        ] } }] }))
      } else {
        res.writeHead(404, headers).end('{}')
      }
    })
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  try {
    await page.getByRole('link', { name: /AI 辅助管理$/ }).click()
    await page.getByRole('button', { name: '+ 添加', exact: true }).click()
    await page.getByLabel('显示名称', { exact: true }).fill('E2E AI')
    await page.getByLabel('API 地址', { exact: true }).fill(`http://127.0.0.1:${(fixture.address() as AddressInfo).port}/v1`)
    await page.getByLabel('API Key', { exact: true }).fill('e2e-key')
    await page.getByRole('button', { name: '保存并获取模型', exact: true }).click()
    await expect(page.getByText(/连接正常，已获取 2 个模型/)).toBeVisible()
    await page.getByLabel('模型', { exact: true }).selectOption('model-b')
    await page.reload()
    await expect(page.getByLabel('当前提供方（2）', { exact: true }).locator('option:checked')).toHaveText('E2E AI')
    await expect(page.getByLabel('模型', { exact: true })).toHaveValue('model-b')

    const input = page.getByLabel('向 AI 管理助手提问')
    await input.fill('重启 stdio-ready')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('AI 请求服务器操作权限', { exact: true })).toBeVisible()
    expect(chatModels).toEqual([])
    await page.getByRole('button', { name: '查看并授权', exact: true }).click()
    await page.getByRole('button', { name: '仅本次会话开放', exact: true }).click()
    await input.fill('重启 stdio-ready')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByText('重启服务器：stdio-ready', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '确认重启', exact: true }).click()
    await expect(page.getByText(/stdio-ready 重启成功/).first()).toBeVisible()
    expect(chatModels).toEqual(['model-b'])

    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    await expect(page.getByText('AI 默认只读，不会执行服务器操作', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    const card = page.locator('.server-card', { hasText: 'stdio-ready' })
    await card.getByRole('button', { name: '停止', exact: true }).click()
    await expect(card.getByText('离线', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()))
  }
})

test('第三方 Tool 插件可导入启用、真实扩展宿主并通过隔离与权限检查', async () => {
  await page.getByRole('button', { name: '界面设置', exact: true }).click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('tab', { name: 'Tool plugins', exact: true }).click()
  await page.getByLabel('Third-party plugin directory', { exact: true }).fill(path.resolve(root, 'tests/fixtures/tool-plugin'))
  await page.getByRole('button', { name: 'Import plugin', exact: true }).click()
  await expect(page.getByLabel('Manage plugin：MCPWindow E2E Plugin', { exact: true })).toBeVisible()
  await expect(page.getByText('Unsigned', { exact: true })).toBeVisible()
  await expect(page.getByText('Untrusted source', { exact: true })).toBeVisible()
  await page.getByText('Trusted source management', { exact: false }).click()
  await page.getByRole('button', { name: 'Trust current directory', exact: true }).click()
  await expect(page.getByText('Trusted source', { exact: true })).toBeVisible()
  await expect(page.locator('.trusted-source code')).toHaveText(path.resolve(root, 'tests/fixtures/tool-plugin'))
  const tampered = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-tampered-plugin-'))
  fs.copyFileSync(path.resolve(root, 'tests/fixtures/tool-plugin/tool.js'), path.join(tampered, 'tool.js'))
  const manifest = JSON.parse(fs.readFileSync(path.resolve(root, 'tests/fixtures/tool-plugin/plugin.json'), 'utf8'))
  manifest.id = 'mcpwindow.tampered-plugin'
  manifest.signature = `sha256:${'0'.repeat(64)}`
  fs.writeFileSync(path.join(tampered, 'plugin.json'), JSON.stringify(manifest))
  await page.getByLabel('Third-party plugin directory', { exact: true }).fill(tampered)
  await page.getByRole('button', { name: 'Import plugin', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('完整性校验失败')
  fs.rmSync(tampered, { recursive: true, force: true })
  await expect(page.getByRole('button', { name: 'Run tool', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Enable plugin', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Disable plugin', exact: true })).toBeVisible()

  await page.getByLabel('Search plugin tools', { exact: true }).fill('no-such-tool')
  await expect(page.getByLabel('Plugin tool', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Run tool', exact: true })).toBeDisabled()
  await page.getByLabel('Search plugin tools', { exact: true }).fill('workspace_summary')
  await expect(page.getByLabel('Plugin tool', { exact: true })).toHaveValue('workspace_summary')
  await page.getByRole('button', { name: 'Run tool', exact: true }).click()
  await expect(page.locator('.tool-result')).toContainText('mcpwindow.e2e-plugin')
  await expect(page.locator('.tool-result')).toContainText('filesystem')

  await page.getByLabel('Search plugin tools', { exact: true }).fill('')
  await page.getByLabel('Plugin tool', { exact: true }).selectOption('create_partition')
  await page.getByLabel('Arguments (JSON object)', { exact: true }).fill('{}')
  await page.getByRole('button', { name: 'Run tool', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Missing required arguments: name')
  await page.getByLabel('name *', { exact: true }).fill('Plugin Created Partition')
  await page.getByLabel('description', { exact: true }).fill('Third-party extension')
  await expect(page.getByLabel('Arguments (JSON object)', { exact: true })).toHaveValue(/Plugin Created Partition/)
  await page.getByRole('button', { name: 'Run tool', exact: true }).click()
  await expect(page.locator('.tool-result')).toContainText('Plugin Created Partition')

  await page.getByLabel('Plugin tool', { exact: true }).selectOption('security_probe')
  await page.getByRole('button', { name: 'Run tool', exact: true }).click()
  await expect(page.locator('.tool-result')).toContainText('"denied": true')
  await expect(page.locator('.tool-result')).toContainText('"node": false')
  await expect(page.locator('.tool-result')).toContainText('"network": false')
  await page.screenshot({ path: 'test-results/tool-plugins.png', animations: 'disabled', timeout: 10_000 })

  await page.getByRole('tab', { name: 'Appearance & language', exact: true }).click()
  await page.getByRole('button', { name: '简体中文', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: /分区管理$/ }).click()
  await expect(page.locator('.partition-name', { hasText: 'Plugin Created Partition' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('多个测试插件可独立启停管理并分别调用工具', async () => {
  await page.getByRole('button', { name: '界面设置', exact: true }).click()
  await page.getByRole('tab', { name: 'Tool 插件', exact: true }).click()
  for (const directory of ['server-inspector', 'partition-organizer']) {
    await page.getByLabel('第三方插件目录', { exact: true }).fill(path.resolve(root, 'examples/plugins', directory))
    await page.getByRole('button', { name: '导入插件', exact: true }).click()
    await expect(page.locator('.plugin-manager .plugin-summary')).toHaveCount(directory === 'server-inspector' ? 2 : 3)
  }
  for (const name of ['服务器巡检示例', '分区整理示例']) {
    const item = page.locator('.plugin-manager .plugin-summary', { hasText: name })
    await item.getByRole('button', { name: '启用插件', exact: true }).click()
    await expect(item.getByRole('button', { name: '停用插件', exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: '管理插件：服务器巡检示例', exact: true }).click()
  await expect(page.getByLabel('插件工具', { exact: true })).toHaveValue('inspect_servers')
  await page.getByRole('button', { name: '调用工具', exact: true }).click()
  await expect(page.locator('.tool-result')).toContainText('"total"')
  await expect(page.locator('.tool-result')).toContainText('filesystem')

  await page.getByRole('button', { name: '管理插件：分区整理示例', exact: true }).click()
  await page.getByLabel('插件工具', { exact: true }).selectOption('create_project_partition')
  await page.getByLabel('name *', { exact: true }).fill('Multi Plugin Partition')
  await page.getByRole('button', { name: '调用工具', exact: true }).click()
  await expect(page.locator('.tool-result')).toContainText('Multi Plugin Partition')
  await expect(page.locator('.tool-result')).toContainText(/"color": "#[0-9a-f]{6}"/)
  await expect(page.locator('.plugin-manager .plugin-summary')).toHaveCount(3)

  const inspector = page.locator('.plugin-manager .plugin-summary', { hasText: '服务器巡检示例' })
  await inspector.getByRole('button', { name: '停用插件', exact: true }).click()
  await expect(inspector.getByRole('button', { name: '启用插件', exact: true })).toBeVisible()
  const organizer = page.locator('.plugin-manager .plugin-summary', { hasText: '分区整理示例' })
  await expect(organizer.getByRole('button', { name: '停用插件', exact: true })).toBeVisible()

  await page.getByLabel('搜索已安装插件', { exact: true }).fill('分区整理')
  await expect(page.locator('.plugin-manager .plugin-summary')).toHaveCount(1)
  await page.getByLabel('搜索已安装插件', { exact: true }).clear()
  await page.getByLabel('插件状态筛选', { exact: true }).selectOption('disabled')
  await expect(page.locator('.plugin-manager .plugin-summary')).toHaveCount(1)
  await page.getByLabel('插件状态筛选', { exact: true }).selectOption('all')
  await page.getByLabel('插件排序方式', { exact: true }).selectOption('version')
  await expect(page.locator('.plugin-manager .plugin-summary')).toHaveCount(3)
  await page.getByText(/插件操作记录（/).click()
  await expect(page.locator('.plugin-activity-list article')).toHaveCount(8)
  await expect(page.locator('.plugin-activity-list')).toContainText('操作成功')
  await page.screenshot({ path: 'test-results/multiple-tool-plugins.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: /分区管理$/ }).click()
  await page.getByLabel('搜索分区', { exact: true }).fill('Multi Plugin Partition')
  await expect(page.locator('.partition-name', { hasText: 'Multi Plugin Partition' })).toBeVisible()
  expect(pageErrors).toEqual([])
})

test('Responses 与 Anthropic 协议均完成授权、确认和真实 MCP 重启', async () => {
  const targetId = await page.evaluate(async () => {
    const stored = localStorage.getItem('mcpwindow-store-v1')
    const prefix = 'mcpwindow-encrypted:v1:'
    const bridge = (window as unknown as { mcpwindow?: { secureStorage: { decrypt: (value: string) => Promise<string> } } }).mcpwindow
    const json = stored?.startsWith(prefix) ? await bridge?.secureStorage.decrypt(stored.slice(prefix.length)) : stored
    const state = JSON.parse(json ?? '{}').state
    return state.servers?.find((item: { name: string }) => item.name === 'stdio-ready')?.id as string
  })
  expect(targetId).toBeTruthy()
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  const targetCard = page.locator('.server-card', { hasText: 'stdio-ready' })
  await targetCard.getByRole('button', { name: '启动', exact: true }).click()
  // 新增 HTTP 服务器后的首轮探测最多 15 秒；启动须等待该屏障，不能用默认 10 秒误判。
  await expect(page.getByText('进程操作已完成', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(targetCard.getByText('在线', { exact: true })).toBeVisible()

  const chatModels: string[] = []
  const authFailures: string[] = []
  const fixture = createServer((req, res) => {
    const headers = {
      'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers).end()
      return
    }
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (req.url === '/v1/models') {
        if (req.headers.authorization !== 'Bearer e2e-responses-key' && req.headers['x-api-key'] !== 'e2e-anthropic-key') authFailures.push('models')
        res.writeHead(200, headers).end(JSON.stringify({ data: [{ id: 'protocol-model' }] }))
      } else if (req.url === '/v1/responses') {
        if (req.headers.authorization !== 'Bearer e2e-responses-key') authFailures.push('responses')
        chatModels.push(JSON.parse(body).model)
        res.writeHead(200, headers).end(JSON.stringify({ output: [
          { type: 'message', content: [{ type: 'output_text', text: 'Responses 已生成重启建议。' }] },
          { type: 'function_call', name: 'mcp_server_operation', arguments: JSON.stringify({ serverId: targetId, action: 'restart' }) },
        ] }))
      } else if (req.url === '/v1/messages') {
        if (req.headers['x-api-key'] !== 'e2e-anthropic-key' || req.headers['anthropic-version'] !== '2023-06-01') authFailures.push('messages')
        chatModels.push(JSON.parse(body).model)
        res.writeHead(200, headers).end(JSON.stringify({ content: [
          { type: 'text', text: 'Anthropic 已生成重启建议。' },
          { type: 'tool_use', name: 'mcp_server_operation', input: { serverId: targetId, action: 'restart' } },
        ] }))
      } else {
        res.writeHead(404, headers).end('{}')
      }
    })
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  try {
    for (const item of [
      { protocol: 'openai-responses', name: 'E2E Responses', key: 'e2e-responses-key', note: 'Responses 已生成重启建议。' },
      { protocol: 'anthropic-messages', name: 'E2E Anthropic', key: 'e2e-anthropic-key', note: 'Anthropic 已生成重启建议。' },
    ]) {
      await page.getByRole('link', { name: /AI 辅助管理$/ }).click()
      await page.getByRole('button', { name: '+ 添加', exact: true }).click()
      await page.getByLabel('API Key', { exact: true }).fill(item.key)
      await page.getByLabel('快速配置／服务商', { exact: true }).selectOption(item.protocol === 'openai-responses' ? 'openai' : 'anthropic')
      await expect(page.getByLabel('API Key', { exact: true })).toHaveValue(item.key)
      await page.getByLabel('显示名称', { exact: true }).fill(item.name)
      await page.getByLabel('API 地址', { exact: true }).fill(`http://127.0.0.1:${(fixture.address() as AddressInfo).port}/v1`)
      await page.getByRole('button', { name: '保存并获取模型', exact: true }).click()
      await expect(page.getByText(/连接正常，已获取 1 个模型/)).toBeVisible()
      await expect(page.getByLabel('模型', { exact: true })).toHaveValue('protocol-model')
      await page.reload()
      await expect(page.getByLabel('API 协议', { exact: true })).toHaveValue(item.protocol)
      await expect(page.getByLabel('模型', { exact: true })).toHaveValue('protocol-model')

      const input = page.getByLabel('向 AI 管理助手提问')
      await input.fill('重启 stdio-ready')
      await page.getByRole('button', { name: '发送', exact: true }).click()
      await page.getByRole('button', { name: '开放权限', exact: true }).click()
      await page.getByRole('button', { name: '仅本次会话开放', exact: true }).click()
      await input.fill('重启 stdio-ready')
      await page.getByRole('button', { name: '发送', exact: true }).click()
      await expect(page.getByText(item.note, { exact: true })).toBeVisible()
      await expect(page.getByText('重启服务器：stdio-ready', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '确认重启', exact: true }).click()
      await expect(page.getByText(/stdio-ready 重启成功/).first()).toBeVisible()
      await page.getByRole('button', { name: '新建会话', exact: true }).click()
      await expect(page.getByText('AI 默认只读，不会执行服务器操作', { exact: true })).toBeVisible()
    }
    expect(chatModels).toEqual(['protocol-model', 'protocol-model'])
    expect(authFailures).toEqual([])
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await targetCard.getByRole('button', { name: '停止', exact: true }).click()
    await expect(targetCard.getByText('离线', { exact: true })).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()))
  }
})


test('脱敏备份可合并恢复，冲突项不会覆盖现有配置', async () => {
  await page.getByRole('link', { name: /总览$/ }).click()
  const backup = {
    format: 'mcpwindow-backup', version: 1, exportedAt: new Date().toISOString(),
    partitions: [{ id: 'backup-p', name: 'Backup Partition', description: 'Restored', color: '#fff', kind: 'project', archived: false, createdAt: 1 }],
    servers: [
      { id: 'backup-s', name: 'backup-restored', partitionId: 'backup-p', description: '', command: 'node backup.js', args: '', version: '1', transport: 'stdio', status: 'running', archived: false, createdAt: 1, headers: { Authorization: 'secret' }, env: { TOKEN: 'secret' }, managementKey: 'secret' },
      { id: 'backup-duplicate', name: 'stdio-ready', partitionId: 'backup-p', description: 'must not overwrite', command: 'bad', args: '', version: '1', transport: 'stdio', status: 'running', archived: false, createdAt: 1 },
    ],
  }
  await page.getByLabel('选择备份文件', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await expect(page.getByRole('status')).toContainText('备份合并完成：新增 1 个分区、1 台服务器，跳过 1 项冲突')
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  const restored = page.locator('.server-card', { hasText: 'backup-restored' })
  await expect(restored).toBeVisible()
  await expect(restored.getByText('离线', { exact: true })).toBeVisible()
})

test('P2 搜索排序、刷新诊断与清空演示数据保留真实配置', async () => {
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  await page.getByLabel('搜索服务器', { exact: true }).fill('stdio-ready')
  await expect(page.locator('.server-card')).toHaveCount(1)
  await expect(page.locator('.server-name', { hasText: 'stdio-ready' })).toBeVisible()
  await page.getByLabel('搜索服务器', { exact: true }).fill('')
  await page.getByLabel('服务器排序方式', { exact: true }).selectOption('status')
  await expect(page.getByText(/上次刷新 .* · 下次约 .* · 异常/)).toBeVisible()
  await page.getByText(/查看本轮 .* 项状态异常及原因/).click()
  await expect(page.locator('.refresh-issues li').first()).toBeVisible()

  await page.getByRole('link', { name: /总览$/ }).click()
  await expect(page.getByText('演示工作区', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '清空演示数据，开始接入', exact: true }).click()
  await expect(page.getByRole('heading', { name: '清空演示数据', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '确认清空', exact: true }).click()
  await expect(page.getByText('演示工作区', { exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  await expect(page.locator('.server-name', { hasText: 'stdio-ready' })).toBeVisible()
  await expect(page.locator('.server-name', { hasText: 'filesystem' })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
