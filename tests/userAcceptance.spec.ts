import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
let app: ElectronApplication
let page: Page
let profile: string

test.beforeEach(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-uat-'))
  const env = { ...process.env, MCPWINDOW_DEV: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: process.env.MCPWINDOW_EXECUTABLE, args: ['.', `--user-data-dir=${profile}`], cwd: root, env })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible()
})

test.afterEach(async () => {
  await app?.close()
  await new Promise((resolve) => setTimeout(resolve, 300))
  if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

test('首次使用到本地分区、凭证发放和吊销的完整流程', async () => {
  await page.screenshot({ path: 'test-results/uat-first-run.png', animations: 'disabled' })
  await page.getByRole('button', { name: '清空演示数据，开始接入', exact: true }).click()
  await page.getByRole('button', { name: '确认清空', exact: true }).click()
  await page.getByRole('link', { name: /分区管理$/ }).click()
  await expect(page.locator('.partition-card')).toHaveCount(0)
  await page.getByRole('button', { name: '+ 新建分区', exact: true }).click()
  await page.getByLabel('分区名称', { exact: true }).fill('用户验收分区')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.partition-name')).toHaveText('用户验收分区')

  await page.getByRole('link', { name: /凭证发放$/ }).click()
  await page.getByRole('button', { name: '+ 发放凭证', exact: true }).click()
  await expect(page.getByRole('button', { name: '发放', exact: true })).toBeDisabled()
  await page.getByLabel('凭证名称', { exact: true }).fill('用户验收客户端')
  await page.getByRole('checkbox', { name: /用户验收分区/ }).check()
  await page.getByRole('button', { name: '发放', exact: true }).click()
  await expect(page.getByRole('heading', { name: '凭证已发放', exact: true })).toBeVisible()
  await expect(page.locator('.server-cmd')).toContainText(/mcpsk_/)
  await page.screenshot({ path: 'test-results/uat-credential.png', animations: 'disabled' })
  await page.getByRole('button', { name: '复制并关闭', exact: true }).click()
  await page.getByRole('button', { name: '停用', exact: true }).click()
  await expect(page.locator('.card').filter({ hasText: '已停用凭证 用户验收客户端' })).toBeVisible()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByText('暂无凭证', { exact: true })).toBeVisible()
})

test('可分别发放 Bearer、Basic Auth 和 API Key 第三方凭证', async () => {
  await page.getByRole('link', { name: /凭证发放$/ }).click()
  for (const item of [
    { type: 'bearer', name: 'Bearer Client', secret: 'bearer-secret', usage: 'Authorization: Bearer' },
    { type: 'basic', name: 'Basic Client', secret: 'basic-secret', usage: '用户名 third-party' },
    { type: 'api-key', name: 'API Client', secret: 'api-secret', usage: 'X-Custom-Key' },
  ]) {
    await page.getByRole('button', { name: '+ 发放凭证', exact: true }).click()
    await page.getByLabel('凭证名称', { exact: true }).fill(item.name)
    await page.getByLabel('第三方认证方式', { exact: true }).selectOption(item.type)
    if (item.type === 'basic') await page.getByLabel('Basic Auth 用户名', { exact: true }).fill('third-party')
    if (item.type === 'api-key') await page.getByLabel('API Key 请求头', { exact: true }).fill('X-Custom-Key')
    await page.getByLabel(/（留空自动生成）/).fill(item.secret)
    await page.getByRole('checkbox', { name: /开发工具/ }).check()
    await page.getByRole('button', { name: '发放', exact: true }).click()
    await expect(page.locator('.server-cmd')).toHaveText(item.secret)
    await expect(page.getByText(/第三方使用方式/)).toContainText(item.usage)
    await page.getByRole('button', { name: '复制并关闭', exact: true }).click()
  }
  await expect(page.locator('tbody tr')).toHaveCount(8)
  await expect(page.getByText('Basic Auth', { exact: true })).toBeVisible()
  await expect(page.getByText('API Key', { exact: true })).toBeVisible()
  await expect(page.getByText('Bearer Token', { exact: true }).first()).toBeVisible()
})

test('英文窄窗口导航和服务器空搜索反馈', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '界面设置', exact: true }).click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: /Servers$/ }).click()
  await expect(page.getByRole('heading', { name: 'Server console', exact: true })).toBeVisible()
  await page.getByLabel('Search servers', { exact: true }).fill('not-a-real-server')
  await expect(page.locator('.server-card')).toHaveCount(0)
  await expect(page.locator('.empty')).toContainText('No servers match your search or filters')
  await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click()
  await expect(page.getByLabel('Search servers', { exact: true })).toHaveValue('')
  await page.screenshot({ path: 'test-results/uat-mobile-search.png', animations: 'disabled' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('远程分区编辑行为与服务器管理目标一致性', async () => {
  const patchRequests: string[] = []
  const fixture = createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer uat-admin') { res.writeHead(401).end('{}'); return }
    if (req.method === 'PATCH') patchRequests.push(req.url ?? '')
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      ok: true, service: 'uat', status: 'running', pid: 123, started_at: null,
      partitions: [{ name: 'remote-project', path: 'E:/remote-project' }], credentials: [],
    }))
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill('uat-remote')
    await page.getByLabel(/启动命令 \/ 服务地址/).fill('node remote.js')
    await page.locator('summary', { hasText: '远程管理（可选）' }).click()
    await page.getByLabel('管理接口', { exact: true }).fill(url)
    await page.getByLabel(/全局 admin 凭证/).fill('uat-admin')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.server-card', { hasText: 'uat-remote' }).getByText('在线', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: /分区管理$/ }).click()
    await page.getByLabel('分区管理目标', { exact: true }).selectOption({ label: '远程服务器 · uat-remote' })
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.getByRole('heading', { name: '编辑分区本地展示', exact: true })).toBeVisible()
    await expect(page.getByText('此处仅修改 MCPWindow 中的描述、颜色和分类，不会变更远程服务器配置。', { exact: true })).toBeVisible()
    await page.getByLabel('描述', { exact: true }).fill('仅修改显示描述')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.partition-desc')).toHaveText('仅修改显示描述')
    expect(patchRequests).toEqual([])
  } finally {
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()))
  }
})
