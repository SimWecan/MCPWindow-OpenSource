// 移动端 ↔ 桌面端联调驱动（无 GUI 会话环境使用）：
// vite 开发服务器 + 无头 Chromium 运行真实渲染层 + 编译后的真实主进程模块
// （进程托管 + 配对服务，electron 以桩注入）。iOS 模拟器中的移动端通过
// http://127.0.0.1:42101 连接配对服务，与本驱动构成完整联调链路。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-e2e-desktop-'))
const log = (msg) => console.log(`[e2e-driver] ${new Date().toISOString()} ${msg}`)
log('驱动启动')

// 预置配对令牌（主进程启动时读取）
fs.writeFileSync(
  path.join(tempDir, 'pairing.json'),
  JSON.stringify({ token: 'e2e-token-0123456789abcdef', enabled: true }),
)

// ---- electron 桩：主进程模块在本 Node 进程内运行 ----
const handlers = new Map()
const listeners = new Map()
const pageRef = { page: null, ready: false }
const fakeWindow = {
  webContents: {
    send: (channel, ...args) => {
      if (channel === 'mcpwindow:pairing-command' && pageRef.ready) {
        const [id, method, params] = args
        void pageRef.page.evaluate(
          ([cmdId, cmdMethod, cmdParams]) => window.__dispatchPairingCommand(cmdId, cmdMethod, cmdParams),
          [id, method, params],
        ).catch(() => {})
      }
    },
  },
  isDestroyed: () => false,
}
const electronStub = {
  app: {
    getPath: () => tempDir,
    whenReady: () => new Promise(() => {}),
    on: () => {},
    quit: () => {},
    requestSingleInstanceLock: () => true,
  },
  ipcMain: {
    handle: (name, fn) => handlers.set(name, fn),
    on: (name, fn) => listeners.set(name, fn),
  },
  BrowserWindow: { getAllWindows: () => [fakeWindow] },
  dialog: {},
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  Menu: { buildFromTemplate: () => ({ }) },
  Tray: class {},
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) },
  shell: { openExternal: async () => {} },
  net: { fetch: (...args) => fetch(...args) },
  safeStorage: { isEncryptionAvailable: () => false },
}
const require = createRequire(path.join(root, 'scripts', 'x.cjs'))
const Module = require('node:module')
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub
  return originalLoad.call(this, request, parent, isMain)
}
require(path.join(root, 'electron-dist', 'main.cjs'))
require(path.join(root, 'electron-dist', 'pairingServer.cjs')).registerPairingIpc()
Module._load = originalLoad
log('主进程模块已加载（进程托管 + 配对服务）')

const invoke = (name, ...args) => {
  const handler = handlers.get(`mcpwindow:${name}`)
  if (!handler) throw new Error(`handler 不存在: ${name}`)
  return handler({}, ...args)
}

// ---- vite 开发服务器 ----
const NODE_BIN = '/Users/sim/Library/Application Support/kimi-desktop/daimon-share/daimon/command-process-owner/bin/node'
const vite = spawn(NODE_BIN, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '--port', '7100'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PATH: `/usr/bin:/bin:/usr/sbin:/sbin` },
})
let viteExited = false
vite.on('exit', (code) => { viteExited = true; log(`vite 退出 code=${code}`) })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite 启动超时')), 30_000)
  vite.stdout.on('data', (chunk) => {
    if (String(chunk).includes('Local:')) { clearTimeout(timer); resolve() }
  })
  vite.stderr.on('data', (chunk) => log(`vite: ${String(chunk).trim()}`))
})
log('vite 就绪 http://localhost:7100')

// ---- 无头 Chromium：真实渲染层 + 注入 mcpwindow 桥 ----
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
pageRef.page = page

await page.exposeBinding('__bridgeInvoke', async (_source, api, ...args) => {
  if (api === 'pairingCommandResult') {
    listeners.get('mcpwindow:pairing-command-result')?.call(null, {}, ...args)
    return
  }
  return invoke(api, ...args)
})
await page.exposeBinding('__bridgeEvent', (_source, api, ...args) => {
  if (api === 'proc-exit') {
    for (const win of [fakeWindow]) {
      // proc-exit 推送给渲染层：由页面侧注册的回调处理
    }
  }
  void args
})
await page.addInitScript(() => {
  const invoke = (api, ...args) => window.__bridgeInvoke(api, ...args)
  const pairingHandlers = new Set()
  window.__dispatchPairingCommand = (id, method, params) => {
    for (const cb of pairingHandlers) cb(id, method, params)
  }
  window.mcpwindow = {
    platform: 'darwin',
    versions: { electron: 'e2e', chrome: 'e2e', node: 'e2e' },
    // 探测：以真实托管进程清单为准（与桌面端语义一致）
    probeLocal: async (id) => (await invoke('proc-list')).includes(id) ? 'online' : 'offline',
    probeHttp: async () => { throw new Error('浏览器桩不支持 probeHttp') },
    procStart: (id, command, args, env) => invoke('proc-start', id, command, args, env),
    procStop: (id) => invoke('proc-stop', id),
    procRestart: (id, command, args, env) => invoke('proc-restart', id, command, args, env),
    procList: () => invoke('proc-list'),
    procMetrics: (ids) => invoke('proc-metrics', ids),
    onProcExit: () => () => {},
    pairingStatus: () => invoke('pairing-status'),
    pairingSetEnabled: (enabled) => invoke('pairing-set-enabled', enabled),
    pairingRegenerateToken: () => invoke('pairing-regenerate-token'),
    pairingSync: (snapshot) => invoke('pairing-sync', snapshot),
    pairingCommandResult: (id, result) => invoke('pairingCommandResult', id, result),
    onPairingCommand: (cb) => { pairingHandlers.add(cb); return () => pairingHandlers.delete(cb) },
    secureStorage: {
      isAvailable: () => false,
      encrypt: async () => { throw new Error('安全存储不可用') },
      decrypt: async () => { throw new Error('安全存储不可用') },
    },
  }
})

page.on('console', (msg) => { if (msg.type() === 'error') log(`页面错误: ${msg.text().slice(0, 200)}`) })
page.on('pageerror', (err) => log(`页面异常: ${String(err).slice(0, 300)}`))

await page.goto('http://localhost:7100', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.sidebar', { timeout: 20_000 })
await page.waitForTimeout(3000) // 等待 store 水合、种子数据导入与首轮快照同步
pageRef.ready = true
log('渲染层已加载并订阅配对')

// ---- 桌面侧准备：配对服务应已自动启动；写入联调服务器 ----
const status = await invoke('pairing-status')
log(`配对服务: running=${status.running} port=${status.port}`)
if (!status.running) throw new Error('配对服务未自动启动')

const BASE = `http://127.0.0.1:${status.port}`
const TOKEN = status.token
const addResponse = await fetch(`${BASE}/mobile/servers`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'E2E 联调服务',
    transport: 'stdio',
    command: '/tmp/mcpwindow-e2e/node /tmp/mcpwindow-e2e/mcp-server.js',
    description: '移动端联调用最小 MCP 服务',
    partition: '',
  }),
})
const addResult = await addResponse.json()
if (!addResult.ok) throw new Error(`添加联调服务器失败: ${addResult.error}`)
log('已通过配对 API 添加 E2E 联调服务器')

await page.waitForTimeout(1500) // 等快照同步
const snapshotResponse = await fetch(`${BASE}/mobile/snapshot`, { headers: { Authorization: `Bearer ${TOKEN}` } })
const snapshot = await snapshotResponse.json()
const e2eServer = snapshot.servers.find((s) => s.name === 'E2E 联调服务')
if (!e2eServer) throw new Error('快照中未找到 E2E 联调服务器')
log(`E2E 服务器 id=${e2eServer.id} status=${e2eServer.status}，桌面侧准备完成`)

fs.writeFileSync('/tmp/mcpwindow-e2e/credentials.json', JSON.stringify({
  baseUrl: BASE, token: TOKEN, serverId: e2eServer.id,
}, null, 2))
fs.writeFileSync('/tmp/mcpwindow-e2e/ready', String(process.pid))
log(`凭据已写入 /tmp/mcpwindow-e2e/credentials.json，驱动就绪 pid=${process.pid}`)

// ---- 保持运行，信号清理 ----
let closing = false
const shutdown = async (signal) => {
  if (closing) return
  closing = true
  log(`收到 ${signal}，清理中`)
  try { await browser.close() } catch { /* 忽略 */ }
  try { vite.kill('SIGTERM') } catch { /* 忽略 */ }
  fs.rmSync(tempDir, { recursive: true, force: true })
  try { fs.unlinkSync('/tmp/mcpwindow-e2e/ready') } catch { /* 忽略 */ }
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
setInterval(() => { if (viteExited && !closing) void shutdown('vite-exit') }, 1000).unref()
