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
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-reorder-'))
  const env = { ...process.env, MCPWINDOW_DEV: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: process.env.MCPWINDOW_EXECUTABLE, args: ['.', `--user-data-dir=${profile}`], cwd: root, env })
  page = await app.firstWindow()
  await page.getByRole('link', { name: /服务器管理$/ }).click()
  await expect(page.locator('.server-card').first()).toBeVisible()
})

test.afterEach(async () => {
  await app?.close()
  await new Promise(resolve => setTimeout(resolve, 300))
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})

test('服务器卡片点击进详情、长按拖动不越界且顺序持久化', async () => {
  const cards = page.locator('.server-card')
  const names = await cards.locator('.server-name').allTextContents()
  expect(names.length).toBeGreaterThan(1)

  await cards.first().click()
  await expect(page).toHaveURL(/#\/servers\//)
  await page.getByRole('link', { name: '← 主控台' }).click()
  await expect(cards.first()).toBeVisible()

  const first = await cards.nth(0).boundingBox()
  const second = await cards.nth(1).boundingBox()
  const grid = await page.locator('.server-grid').boundingBox()
  expect(first && second && grid).toBeTruthy()
  await page.mouse.move(second!.x + 90, second!.y + 65)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.move(-500, -500, { steps: 5 })
  const clamped = await cards.nth(1).boundingBox()
  expect(clamped!.x).toBeGreaterThanOrEqual(grid!.x - 1)
  expect(clamped!.y).toBeGreaterThanOrEqual(grid!.y - 1)
  await page.mouse.move(first!.x + 80, first!.y + 30, { steps: 8 })
  await page.mouse.up()
  await expect(cards.locator('.server-name').first()).toHaveText(names[1])
  await expect(page).toHaveURL(/#\/servers$/)
  await expect(page.getByText('服务器顺序已保存', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.locator('.server-card').first()).toBeVisible()
  await expect(page.locator('.server-card .server-name').first()).toHaveText(names[1])
  await expect(page.getByLabel('服务器排序方式')).toHaveValue('manual')
})

test('卡片拖到窗口边缘自动滚动，取消后立即停止', async () => {
  await page.evaluate(() => {
    const grid = document.querySelector('.server-grid')!
    const template = grid.querySelector('.server-card')!
    for (let index = 0; index < 14; index++) {
      const clone = template.cloneNode(true) as HTMLElement
      clone.dataset.serverId = `scroll-fixture-${index}`
      grid.appendChild(clone)
    }
    const main = document.querySelector('.main') as HTMLElement
    main.scrollTop = 0
  })
  const card = await page.locator('.server-card').first().boundingBox()
  const main = await page.locator('.main').boundingBox()
  expect(card && main).toBeTruthy()
  await page.mouse.move(card!.x + 90, card!.y + 65)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.move(card!.x + 90, main!.y + main!.height - 8)
  await expect.poll(() => page.locator('.main').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })))
  await page.mouse.up()
  const stopped = await page.locator('.main').evaluate(element => element.scrollTop)
  await page.waitForTimeout(250)
  const after = await page.locator('.main').evaluate(element => element.scrollTop)
  expect(Math.abs(after - stopped)).toBeLessThanOrEqual(1)
})
