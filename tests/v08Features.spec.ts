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
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-v08-'))
  const env = { ...process.env, MCPWINDOW_DEV: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: process.env.MCPWINDOW_EXECUTABLE, args: ['.', `--user-data-dir=${profile}`], cwd: root, env })
  page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible()
})

test.afterEach(async () => {
  await app?.close()
  await new Promise((resolve) => setTimeout(resolve, 300))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

test('服务器查重、克隆、Tags、收藏、自定义视图和批量移动均真实生效', async () => {
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
  await page.getByLabel('服务器名称', { exact: true }).fill('v08-source')
  await page.getByLabel(/启动命令 \/ 服务地址/).fill('node source.js')
  await page.getByLabel('服务器 Tags（逗号分隔）', { exact: true }).fill('核心，自动化, 核心')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const source = page.locator('.server-card').filter({ has: page.locator('.server-name').getByText('v08-source', { exact: true }) })
  await expect(source.getByText('#核心', { exact: true })).toBeVisible()
  await expect(source.getByText('#自动化', { exact: true })).toBeVisible()
  await source.getByRole('button', { name: '克隆', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.server-card', { hasText: 'v08-source 副本' })).toBeVisible()

  await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
  await page.getByLabel('服务器名称', { exact: true }).fill('v08-source')
  await page.getByLabel(/启动命令 \/ 服务地址/).fill('node duplicate.js')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('该分区已存在同名服务器')
  await page.getByRole('button', { name: '取消', exact: true }).click()

  await source.getByRole('button', { name: '收藏 v08-source', exact: true }).click()
  await page.getByLabel('按 Tags 筛选', { exact: true }).selectOption('自动化')
  await expect(page.locator('.server-card')).toHaveCount(2)
  await page.getByRole('checkbox', { name: '仅看收藏', exact: true }).check()
  await expect(page.locator('.server-card')).toHaveCount(1)
  await page.getByLabel('视图名称', { exact: true }).fill('核心收藏')
  await page.getByRole('button', { name: '保存视图', exact: true }).click()
  await page.getByRole('checkbox', { name: '仅看收藏', exact: true }).uncheck()
  await page.getByLabel('按 Tags 筛选', { exact: true }).selectOption('')
  await page.getByLabel('自定义视图', { exact: true }).selectOption('核心收藏')
  await expect(page.locator('.server-card')).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem('mcpwindow-server-views-v1'))).toContain('核心收藏')
  await page.getByRole('checkbox', { name: '仅看收藏', exact: true }).uncheck()
  await page.getByLabel('按 Tags 筛选', { exact: true }).selectOption('')

  await page.getByRole('checkbox', { name: '选择服务器 v08-source', exact: true }).check()
  await page.getByRole('checkbox', { name: '选择服务器 v08-source 副本', exact: true }).check()
  await page.getByLabel('批量移动目标分区', { exact: true }).selectOption({ label: '数据服务' })
  await page.getByRole('button', { name: '确认移动', exact: true }).click()
  await expect(page.getByText(/已将 2 台服务器移动到 数据服务/)).toBeVisible()
  for (const name of ['v08-source', 'v08-source 副本']) {
    const card = page.locator('.server-card').filter({ has: page.locator('.server-name').getByText(name, { exact: true }) })
    await expect(card.locator('.server-meta')).toContainText('数据服务')
    await card.getByRole('checkbox', { name: `选择服务器 ${name}`, exact: true }).check()
  }
  await page.getByRole('button', { name: '批量停止', exact: true }).click()
  await expect(page.getByText(/批量操作完成：成功 2 台，跳过 0 台，失败 0 台/)).toBeVisible({ timeout: 40_000 })
})

test('七天内到期且仍启用的凭证在总览提醒', async () => {
  await page.getByRole('link', { name: /凭证发放$/ }).click()
  await page.getByRole('button', { name: '+ 发放凭证', exact: true }).click()
  await page.getByLabel('凭证名称', { exact: true }).fill('v08-expiring')
  await page.getByRole('checkbox', { name: /开发工具/ }).check()
  await page.getByLabel('有效期（天，0 = 永不过期）', { exact: true }).fill('1')
  await page.getByRole('button', { name: '发放', exact: true }).click()
  await page.getByRole('button', { name: '复制并关闭', exact: true }).click()
  await page.getByRole('link', { name: /总览$/ }).click()
  const reminder = page.locator('.credential-reminders')
  await expect(reminder).toContainText('凭证到期提醒')
  await expect(reminder).toContainText('v08-expiring')
  await expect(reminder).toContainText('即将到期')
  await reminder.locator('a', { hasText: 'v08-expiring' }).click()
  await expect(page.getByRole('heading', { name: '凭证发放', exact: true })).toBeVisible()
})
