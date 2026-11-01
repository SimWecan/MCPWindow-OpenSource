import { expect, test, _electron as electron } from '@playwright/test'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

test('首次接入询问导入历史记录，此后刷新仅追加新访问日志', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-log-profile-'))
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-log-project-'))
  fs.mkdirSync(path.join(project, 'data'))
  const script = path.join(project, 'server.cjs')
  const logFile = path.join(project, 'data', 'request.log')
  fs.writeFileSync(script, '')
  fs.writeFileSync(logFile, [
    "2026-10-30 12:00 POST /mcp auth=Y origin='https://platform.kimi.com' ct='application/json' -> 200",
    '2026-10-30 12:01 POST /mcp auth=N origin=None -> 401',
  ].join('\n'))
  const env = { ...process.env, MCPWINDOW_DEV: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root, env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill('local-history-e2e')
    await page.getByLabel(/启动命令 \/ 服务地址/).fill(process.execPath)
    await page.getByLabel('启动参数', { exact: true }).fill(script)
    await page.getByRole('button', { name: '保存', exact: true }).click()

    const prompt = page.getByRole('dialog', { name: '检测到历史访问记录', exact: true })
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('2 条')
    await prompt.getByRole('button', { name: '导入历史记录', exact: true }).click()
    await expect(prompt).toHaveCount(0)
    await expect(page.getByText('local-history-e2e：已导入 2 条访问记录', { exact: true })).toBeVisible()

    const countLogs = () => page.evaluate(async () => {
      const stored = localStorage.getItem('mcpwindow-store-v1') ?? ''
      const prefix = 'mcpwindow-encrypted:v1:'
      const bridge = (window as unknown as { mcpwindow: { secureStorage: { decrypt: (value: string) => Promise<string> } } }).mcpwindow
      const json = stored.startsWith(prefix) ? await bridge.secureStorage.decrypt(stored.slice(prefix.length)) : stored
      const state = JSON.parse(json).state
      const server = state.servers.find((item: { name: string }) => item.name === 'local-history-e2e')
      return state.accessLogs.filter((item: { serverId: string }) => item.serverId === server.id).length
    })
    await expect.poll(countLogs).toBe(2)

    fs.appendFileSync(logFile, "\n2026-10-30 12:02 POST /mcp auth=Y origin='https://example.com' ct='application/json' -> 200")
    await page.getByRole('button', { name: '↻ 重新探测', exact: true }).click()
    await expect(page.getByText(/刷新完成：/)).toBeVisible()
    await expect.poll(countLogs).toBe(3)
    await page.getByRole('button', { name: '↻ 重新探测', exact: true }).click()
    await expect.poll(countLogs).toBe(3)

    fs.appendFileSync(logFile, "\n2026-10-30 12:03 POST /mcp auth=Y origin='https://example.com' ct='application/json' -> 200")
    await page.getByRole('link', { name: /日志统计$/ }).click()
    await page.getByRole('button', { name: '↻ 刷新日志', exact: true }).click()
    await expect(page.getByText('日志已更新，新增 1 条记录', { exact: true })).toBeVisible()
    await expect.poll(countLogs).toBe(4)
    await expect(page.locator('canvas').first()).toBeVisible()

    fs.appendFileSync(logFile, "\n2026-10-30 12:04 POST /mcp auth=Y origin='https://example.com' ct='application/json' -> 200")
    await page.getByRole('link', { name: /总览$/ }).click()
    await page.getByRole('button', { name: '↻ 刷新日志', exact: true }).click()
    await expect(page.getByText('日志已更新，新增 1 条记录', { exact: true })).toBeVisible()
    await expect.poll(countLogs).toBe(5)
    await expect(page.locator('canvas').first()).toBeVisible()
    await page.getByRole('link', { name: /服务器管理$/ }).click()

    const emptyProject = path.join(project, 'empty')
    fs.mkdirSync(emptyProject)
    await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill('no-history-e2e')
    await page.getByLabel(/启动命令 \/ 服务地址/).fill(process.execPath)
    await page.getByLabel('启动参数', { exact: true }).fill(path.join(emptyProject, 'no-history.cjs'))
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('.server-card', { hasText: 'no-history-e2e' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: '检测到历史访问记录', exact: true })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/access-log-import.png', fullPage: true })
  } finally {
    await app.close()
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('桌面端通过管理接口持续获取远程日志且不重复导入', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-remote-log-profile-'))
  let logCount = 1
  const fixture = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/manage/status') {
      response.end(JSON.stringify({ ok: true, service: 'remote-log', status: 'running', pid: 123, started_at: 1, partitions: [], credentials: [] }))
    } else if (request.url?.startsWith('/manage/access-logs')) {
      response.end(JSON.stringify({ ok: true, logs: Array.from({ length: logCount }, (_, index) => ({
        timestamp: `2026-11-01T10:0${index}:00+08:00`, endpoint: '/mcp', client: 'fixture', tool: 'POST', ok: true, latencyMs: null, sourceKey: `remote:${index}`,
      })) }))
    } else if (request.url === '/mcp') {
      response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'remote-log', version: '1' } } }))
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('测试服务地址无效')
  const base = `http://127.0.0.1:${address.port}`
  const env = { ...process.env, MCPWINDOW_DEV: '0' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: root, env })
  try {
    const page = await app.firstWindow()
    await page.getByRole('link', { name: /服务器管理$/ }).click()
    await page.getByRole('button', { name: '+ 接入服务器', exact: true }).click()
    await page.getByLabel('服务器名称', { exact: true }).fill('remote-log-e2e')
    await page.getByLabel(/启动命令 \/ 服务地址/).fill(`${base}/mcp`)
    await page.getByLabel('传输方式', { exact: true }).selectOption('streamable-http')
    await page.getByText('远程管理（可选）', { exact: true }).click()
    await page.getByLabel('管理接口', { exact: true }).fill(base)
    await page.getByLabel('全局 admin 凭证（仅保存在本机）', { exact: true }).fill('admin-secret')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('link', { name: /日志统计$/ }).click()
    await page.getByRole('button', { name: '↻ 刷新日志', exact: true }).click()
    await expect(page.getByText('日志已更新，新增 1 条记录', { exact: true })).toBeVisible()
    logCount = 2
    await page.getByRole('button', { name: '↻ 刷新日志', exact: true }).click()
    await expect(page.getByText('日志已更新，新增 1 条记录', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '↻ 刷新日志', exact: true }).click()
    await expect(page.getByText('日志已刷新，暂无新增记录', { exact: true })).toBeVisible()
  } finally {
    await app.close()
    await new Promise<void>((resolve) => fixture.close(() => resolve()))
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
