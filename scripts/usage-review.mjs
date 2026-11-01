import { expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const executablePath = process.env.MCPWINDOW_EXECUTABLE || path.join(root, 'release/p12/win-unpacked/MCPWindow.exe')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-usage-'))
const output = path.join(root, 'test-results/usage-review')
fs.mkdirSync(output, { recursive: true })
const report = { executablePath, checks: [], observations: [], pageErrors: [] }
const env = { ...process.env, MCPWINDOW_DEV: '0' }
delete env.ELECTRON_RUN_AS_NODE
let app

async function check(name, action) {
  await action()
  report.checks.push(name)
  console.log(`PASS ${name}`)
}

try {
  app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${profile}`], cwd: root, env })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => report.pageErrors.push(error.message))
  await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })

  await check('首次启动、总览和全部主导航可用', async () => {
    await page.screenshot({ path: path.join(output, '01-overview.png') })
    for (const [nav, heading] of [
      ['分区管理', '分区管理'], ['服务器管理', '服务器管理 · 主控台'],
      ['凭证发放', '凭证发放'], ['日志统计', '日志统计'], ['AI 辅助管理', 'AI 辅助管理'],
    ]) {
      await page.getByRole('link', { name: new RegExp(`${nav}$`) }).click()
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    }
  })

  await check('分区创建、编辑入口和删除确认可到达', async () => {
    await page.getByRole('link', { name: /分区管理$/ }).click()
    await page.getByRole('button', { name: '+ 新建分区' }).click()
    await page.getByLabel('分区名称', { exact: true }).fill('重复分区')
    await page.getByLabel('描述', { exact: true }).fill('用户使用测试')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.partition-name').filter({ hasText: '重复分区' })).toHaveCount(1)
    const card = page.locator('.partition-card').filter({ hasText: '重复分区' })
    await card.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(page.getByRole('heading', { name: '编辑分区', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await card.getByRole('button', { name: '删除', exact: true }).click()
    await expect(page.getByRole('heading', { name: '删除分区', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  })

  await check('当前允许创建两个同名本地分区', async () => {
    await page.getByRole('button', { name: '+ 新建分区' }).click()
    await page.getByLabel('分区名称', { exact: true }).fill('重复分区')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.partition-name').filter({ hasText: '重复分区' })).toHaveCount(2)
    report.observations.push('本地分区没有重名提示或阻止机制')
  })

  await check('远程 HTTP 非加密地址在保存前给出明确错误', async () => {
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await page.getByRole('button', { name: '+ 接入服务器' }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill('invalid-remote')
    await page.getByLabel('传输方式', { exact: true }).selectOption('streamable-http')
    await page.getByLabel(/启动命令 \/ 服务地址/).fill('http://example.com/mcp')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('非本机 MCP 地址必须使用 HTTPS')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    const escapeClosed = await page.locator('.modal-mask').count() === 0
    if (!escapeClosed) {
      report.observations.push('服务器配置校验失败后，Escape 未能关闭弹窗，需要点击取消')
      await page.screenshot({ path: path.join(output, '01b-validation-escape.png') })
      await page.getByRole('button', { name: '取消', exact: true }).click()
    }
  })

  await check('当前允许创建两个同名服务器', async () => {
    for (let index = 0; index < 2; index++) {
      await page.getByRole('button', { name: '+ 接入服务器' }).click()
      await page.getByLabel('服务器名称', { exact: true }).fill('duplicate-server')
      await page.getByLabel(/启动命令 \/ 服务地址/).fill('node')
      await page.getByRole('button', { name: '保存', exact: true }).click()
    }
    await expect(page.locator('.server-name').filter({ hasText: 'duplicate-server' })).toHaveCount(2)
    report.observations.push('服务器没有重名提示，按名称进行 AI 操作时可能产生歧义')
  })

  await check('凭证发放、完整 Key 展示和停用操作可用', async () => {
    await page.getByRole('link', { name: /凭证发放$/ }).click()
    await page.getByRole('button', { name: '+ 发放凭证' }).click()
    await page.getByLabel('凭证名称', { exact: true }).fill('usage-key')
    await page.locator('.scope-check input[type=checkbox]').first().check()
    await page.getByLabel('限流（次/分钟）', { exact: true }).fill('60')
    await page.getByRole('button', { name: '发放', exact: true }).click()
    await expect(page.getByRole('heading', { name: '凭证已发放', exact: true })).toBeVisible()
    await expect(page.locator('.server-cmd.mono')).toContainText('mcpsk_')
    await page.keyboard.press('Escape')
    const row = page.locator('tbody tr').filter({ hasText: 'usage-key' })
    await row.getByRole('button', { name: '停用', exact: true }).click()
    await expect(row.getByText('停用', { exact: true })).toBeVisible()
  })

  await check('英文模式下离线 stdio Tools 错误仍为中文', async () => {
    await page.getByRole('button', { name: '界面设置', exact: true }).click()
    await page.getByRole('button', { name: 'English', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('link', { name: 'Servers', exact: true }).click()
    await page.getByRole('button', { name: 'Interface settings', exact: true }).click()
    await page.getByRole('tab', { name: 'Tools configuration', exact: true }).click()
    await page.getByLabel('MCP server', { exact: true }).selectOption({ label: 'duplicate-server · stdio' })
    await page.getByRole('button', { name: 'Load tools', exact: true }).click()
    await expect(page.locator('.settings-error')).toContainText('本地服务器未由 MCPWindow 托管运行')
    report.observations.push('英文模式仍显示中文主进程错误，且部分服务器页动态文案保持中文')
    await page.screenshot({ path: path.join(output, '02-english-offline-tools.png') })
  })

  await check('窄窗口无页面级横向溢出，设置窗口完整可见', async () => {
    await page.setViewportSize({ width: 800, height: 600 })
    const dimensions = await page.evaluate(() => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      dialogWidth: document.querySelector('.settings-modal')?.clientWidth ?? 0,
      dialogScrollHeight: document.querySelector('.settings-modal')?.scrollHeight ?? 0,
      dialogClientHeight: document.querySelector('.settings-modal')?.clientHeight ?? 0,
    }))
    expect(dimensions.documentWidth).toBe(dimensions.viewport)
    expect(dimensions.dialogWidth).toBeGreaterThan(500)
    expect(dimensions.dialogScrollHeight).toBeGreaterThan(0)
    expect(dimensions.dialogClientHeight).toBeLessThanOrEqual(540)
    await page.screenshot({ path: path.join(output, '03-small-window-tools.png') })
  })

  expect(report.pageErrors).toEqual([])
  report.result = 'completed'
} catch (error) {
  report.result = 'failed'
  report.error = error instanceof Error ? error.stack : String(error)
  console.error(error)
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  await app?.close()
  await new Promise((resolve) => setTimeout(resolve, 500))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}
