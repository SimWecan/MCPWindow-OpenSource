// 真机端到端：启动最新打包的 MCPWindow.app，经 UI/桥启用配对服务，
// 然后以移动端协议形态（与 Flutter MobileApiClient/MobileEventsClient 一致）
// 对真实桌面端发起调用：Bearer 快照、命令响应形态、WS 推送。
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'

const results = []
const record = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// 与 tests/electron.spec.ts 相同的方式：用仓库内 Electron 运行时直接加载
// 当前编译产物（dist/ + electron-dist/），行为与打包后的应用一致。
const electronBinary = path.join(
  '/Users/sim/Documents/MCPServer/repo/MCPWindow/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
)
if (!fs.existsSync(electronBinary)) { console.error('未找到 Electron 运行时'); process.exit(1) }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-real-'))
const env = { ...process.env, MCPWINDOW_DEV: '0' }
delete env.ELECTRON_RUN_AS_NODE
const { _electron: electron } = await import('@playwright/test')
const app = await electron.launch({
  executablePath: electronBinary,
  args: ['.', `--user-data-dir=${profile}`],
  cwd: '/Users/sim/Documents/MCPServer/repo/MCPWindow',
  env,
})
const page = await app.firstWindow()
await page.waitForTimeout(2500)

// 通过桥开启配对服务（等价于用户点击弹窗开关）
const pair = await page.evaluate(async () => {
  const bridge = window.mcpwindow
  if (!bridge?.pairingSetEnabled) return { error: 'bridge missing' }
  const status = await bridge.pairingSetEnabled(true)
  return { running: status.running, port: status.port, token: status.token, addresses: status.addresses }
})
record('真实桌面端配对服务启动', pair.running === true && !!pair.port && !!pair.token, `port=${pair.port} addr=${pair.addresses?.[0]}`)
const { port, token } = pair
const base = `http://127.0.0.1:${port}`

// —— 模拟移动端 HTTP 调用（与 MobileApiClient 一致：Bearer 头）——
const get = async (route) => {
  const started = performance.now()
  const response = await fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${token}` } })
  const text = await response.text()
  return { status: response.status, ms: performance.now() - started, bytes: Buffer.byteLength(text), body: text ? JSON.parse(text) : null }
}
const health = await fetch(`${base}/health`).then((r) => r.json())
record('GET /health 无需令牌', health.ok === true)

const snapshot = await get('/mobile/snapshot')
record('GET /mobile/snapshot（真实桌面数据）', snapshot.status === 200, `${snapshot.ms.toFixed(1)}ms · ${(snapshot.bytes / 1024).toFixed(1)}KB · servers=${snapshot.body?.servers?.length ?? '—'}`)

const noToken = await fetch(`${base}/mobile/snapshot`)
record('无令牌 401（query token 已禁用）', noToken.status === 401)
const queryToken = await fetch(`${base}/mobile/snapshot?token=${encodeURIComponent(token)}`)
record('query token 同样 401', queryToken.status === 401)

const servers = await get('/mobile/servers')
const alerts = await get('/mobile/alerts')
record('GET /mobile/servers + /alerts', servers.status === 200 && alerts.status === 200)

// —— 模拟移动端命令调用（真实转发到窗口；无窗口时 502）——
const fakeId = 'no-such-server'
const cmdStarted = performance.now()
const cmd = await fetch(`${base}/mobile/servers/${fakeId}/start`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}` },
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), ms: performance.now() - cmdStarted }))
record('命令经真实窗口转发并校验（轻量错误响应）', [200, 502, 410].includes(cmd.status) && cmd.body && !('snapshot' in cmd.body) && typeof cmd.body.error === 'string', `${cmd.status} · ${JSON.stringify(cmd.body ?? {}).slice(0, 60)} · ${cmd.ms.toFixed(0)}ms`)

// —— 模拟移动端 WS（与 MobileEventsClient 一致：query token 握手）——
const wsResult = await new Promise((resolve) => {
  const key = crypto.randomBytes(16).toString('base64')
  const started = performance.now()
  const socket = net.connect(port, '127.0.0.1', () => {
    socket.write(
      `GET /mobile/events?token=${encodeURIComponent(token)} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    )
  })
  let upgraded = false
  let buffer = Buffer.alloc(0)
  const messages = []
  const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout', messages }), 15000)
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) return
      const header = buffer.subarray(0, end).toString('utf8')
      buffer = buffer.subarray(end + 4)
      upgraded = true
      if (!header.startsWith('HTTP/1.1 101')) { clearTimeout(timer); resolve({ ok: false, reason: header.split('\r\n')[0], messages }); return }
      record('WS 握手 101（query token）', true, `${(performance.now() - started).toFixed(1)}ms`)
    }
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f
      let length = buffer[1] & 0x7f
      let offset = 2
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4 }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10 }
      if (buffer.length < offset + length) return
      const payload = buffer.subarray(offset, offset + length).toString('utf8')
      buffer = buffer.subarray(offset + length)
      if (opcode === 0x1) {
        try { messages.push(JSON.parse(payload)) } catch { /* ignore */ }
        const snap = messages.find((m) => m.type === 'snapshot')
        if (snap) { clearTimeout(timer); resolve({ ok: true, handshakeMs: performance.now() - started, snapshot: snap, messages }) }
      }
    }
  })
  socket.on('error', () => { clearTimeout(timer); resolve({ ok: false, reason: 'socket error', messages }) })
})
record('WS 收到 connected 问候', wsResult.messages.some((m) => m.type === 'connected'))
record('WS 连接即推送当前快照（缺失：桌面状态未变化时无推送）', wsResult.ok === true && !!wsResult.snapshot,
  wsResult.ok ? `snapshot ${(JSON.stringify(wsResult.snapshot).length / 1024).toFixed(1)}KB · servers=${wsResult.snapshot.data?.servers?.length ?? '—'}` : wsResult.reason)

// —— 关闭配对并退出 ——
await page.evaluate(async () => { await window.mcpwindow?.pairingSetEnabled?.(false) })
await app.close().catch(() => {})
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })

const failed = results.filter((r) => !r.pass)
console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项`)
process.exit(failed.length ? 1 : 0)
