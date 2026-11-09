// 移动端调用面端到端压测：以 electron 桩驱动编译后的 pairingServer.cjs，
// 按移动端 MobileApiClient 的真实调用顺序/并发形态请求每个接口，记录状态码、
// 延迟与负载大小，并验证错误路径的响应形态。用于发现可优化点。
// 运行前提：npx tsc -p electron/tsconfig.json；node scripts/test-mobile-calls.mjs
import { createRequire } from 'node:module'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-mobile-calls-'))
const handlers = new Map()
const listeners = new Map()

const require = createRequire(path.join(root, 'scripts', 'x.cjs'))
const Module = require('node:module')
const electronStub = {
  app: { getPath: () => tempDir },
  ipcMain: {
    handle: (name, fn) => handlers.set(name, fn),
    on: (name, fn) => listeners.set(name, fn),
  },
  BrowserWindow: { getAllWindows: () => [] },
}
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electronStub
  return originalLoad.call(this, request, parent, isMain)
}
const pairing = require(path.join(root, 'electron-dist', 'pairingServer.cjs'))
pairing.registerPairingIpc()

const results = []
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const invoke = (name, ...args) => handlers.get(name)({}, ...args)

const get = async (url, token) => {
  const started = performance.now()
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const text = await response.text()
  return { status: response.status, ms: performance.now() - started, bytes: Buffer.byteLength(text), body: JSON.parse(text) }
}
const post = async (url, token, body, method = 'POST') => {
  const started = performance.now()
  const response = await fetch(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, ms: performance.now() - started, bytes: Buffer.byteLength(text), body: text ? JSON.parse(text) : null }
}

// ---- 极简 WS 客户端 ----
function wsConnect(port, token) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64')
    const started = performance.now()
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET /mobile/events?token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      )
    })
    let upgraded = false
    let buffer = Buffer.alloc(0)
    const messages = []
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!upgraded) {
        const headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return
        const header = buffer.subarray(0, headerEnd).toString('utf8')
        if (!header.startsWith('HTTP/1.1 101')) return reject(new Error(`WS upgrade failed: ${header.split('\r\n')[0]}`))
        buffer = buffer.subarray(headerEnd + 4)
        upgraded = true
        resolve({ socket, messages, handshakeMs: performance.now() - started })
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
        if (opcode === 0x1) messages.push(JSON.parse(payload))
        if (opcode === 0x8) socket.end()
      }
    })
    socket.on('error', reject)
  })
}

// ---- 准备：启动服务 + 同步一份有代表性的快照（200 台服务器 + 100 条告警）----
const bigSnapshot = {
  summary: { online: 180, needsCredentials: 5, offline: 15, crashesToday: 3, unreadAlerts: 40, pendingApprovals: 2 },
  servers: Array.from({ length: 200 }, (_, i) => ({
    id: `srv-${i}`, name: `server-${i}`, description: 'integration test server',
    partition: '默认分区', transport: i % 2 ? 'stdio' : 'streamableHttp',
    status: i % 11 === 0 ? 'offline' : 'online',
    endpoint: i % 2 ? 'node server.js' : 'http://127.0.0.1:9000/mcp',
    credentialType: 'none', lastSeen: Date.now(), favorite: false,
  })),
  alerts: Array.from({ length: 100 }, (_, i) => ({
    id: `alert-${i}`, title: `告警标题 ${i}`, message: '服务器连接中断，请检查网络与凭证',
    severity: i % 5 === 0 ? 'critical' : 'warning', createdAt: Date.now() - i * 60000, read: i > 40,
  })),
  approvals: [{ id: 'ap-1', serverId: 'srv-1', serverName: 'server-1', action: 'restart', requestedBy: 'tester', createdAt: Date.now(), status: 'pending' }],
  generatedAt: Date.now(),
}

const status = await invoke('mcpwindow:pairing-set-enabled', true)
record('配对服务启动', status.running === true && typeof status.port === 'number')
const { port, token } = status
const base = `http://127.0.0.1:${port}`

const syncResult = await invoke('mcpwindow:pairing-sync', bigSnapshot)
record('大快照同步（200 服务器/100 告警）', syncResult.ok === true, `bytes=${JSON.stringify(bigSnapshot).length}`)

// ---- 1. 移动端主链路：单调用快照 ----
const snapshot = await get(`${base}/mobile/snapshot`, token)
record('GET /mobile/snapshot', snapshot.status === 200, `${snapshot.ms.toFixed(1)}ms · ${(snapshot.bytes / 1024).toFixed(1)}KB`)

// ---- 2. 辅助列表接口（移动端当前未用，但客户端已封装）----
for (const route of ['servers', 'alerts', 'approvals']) {
  const r = await get(`${base}/mobile/${route}`, token)
  const len = Array.isArray(r.body) ? r.body.length : '—'
  record(`GET /mobile/${route}`, r.status === 200, `${r.ms.toFixed(1)}ms · ${(r.bytes / 1024).toFixed(1)}KB · ${len} 条`)
}

// ---- 3. 并发形态：快照 + 三列表同时发（最坏情况）----
{
  const started = performance.now()
  const [a, b, c, d] = await Promise.all([
    get(`${base}/mobile/snapshot`, token),
    get(`${base}/mobile/servers`, token),
    get(`${base}/mobile/alerts`, token),
    get(`${base}/mobile/approvals`, token),
  ])
  const total = performance.now() - started
  const ok = [a, b, c, d].every((r) => r.status === 200)
  record('并发 4 请求（快照+三列表）', ok, `总耗时 ${total.toFixed(1)}ms`)
}

// ---- 4. 快照往返时延采样（10 次，看抖动）----
{
  const samples = []
  for (let i = 0; i < 10; i++) samples.push((await get(`${base}/mobile/snapshot`, token)).ms)
  samples.sort((x, y) => x - y)
  record('快照延迟采样 ×10', true, `min=${samples[0].toFixed(1)} p50=${samples[5].toFixed(1)} max=${samples[9].toFixed(1)}ms`)
}

// ---- 5. WS 通道：握手 + 快照广播延迟 ----
{
  const ws = await wsConnect(port, token)
  const t0 = performance.now()
  await invoke('mcpwindow:pairing-sync', { ...bigSnapshot, generatedAt: Date.now() })
  const waitBroadcast = new Promise((resolve) => {
    const timer = setInterval(() => {
      if (ws.messages.some((m) => m.type === 'snapshot')) { clearInterval(timer); resolve(performance.now() - t0) }
    }, 1)
    setTimeout(() => { clearInterval(timer); resolve(-1) }, 3000)
  })
  const broadcastMs = await waitBroadcast
  record('WS 握手', ws.handshakeMs < 500, `${ws.handshakeMs.toFixed(1)}ms`)
  record('WS 快照广播到达', broadcastMs >= 0, broadcastMs >= 0 ? `${broadcastMs.toFixed(1)}ms` : '3s 内未收到')
  ws.socket.end()
}

// ---- 6. 错误路径形态 ----
const unauthorized = await get(`${base}/mobile/snapshot`)
record('无令牌 → 401', unauthorized.status === 401, JSON.stringify(unauthorized.body))
const badToken = await get(`${base}/mobile/snapshot`, 'wrong-token')
record('错误令牌 → 401', badToken.status === 401)
const notFound = await get(`${base}/mobile/nope`, token)
record('未知路由 → 404', notFound.status === 404)
const startUnknown = await post(`${base}/mobile/servers/nope/start`, token)
record('启动未知服务器（无窗口）', startUnknown.status === 502 || startUnknown.status === 404, `${startUnknown.status} · ${JSON.stringify(startUnknown.body).slice(0, 120)}`)
record('错误响应不再内嵌快照', startUnknown.body && !('snapshot' in startUnknown.body), `${startUnknown.bytes}B`)
const approvalRespond = await post(`${base}/mobile/approvals/ap-1/respond`, token, { approved: true })
record('审批响应（无窗口）', [410, 502].includes(approvalRespond.status), `${approvalRespond.status} · body ${approvalRespond.bytes}B`)
const readAll = await post(`${base}/mobile/alerts/read-all`, token)
record('全部标记已读（无窗口时 502 为预期）', [200, 502].includes(readAll.status), `${readAll.status} · ${readAll.ms.toFixed(1)}ms · body ${readAll.bytes}B`)

// ---- 7. 令牌头形态差异：移动端用标准 Bearer ----
const queryToken = await fetch(`${base}/mobile/snapshot?token=${encodeURIComponent(token)}`)
record('HTTP 路由不再接受 query token', queryToken.status === 401, `status=${queryToken.status}`)

// ---- 汇总 ----
const failed = results.filter((r) => !r.pass)
console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项`)
await invoke('mcpwindow:pairing-set-enabled', false)
process.exit(failed.length ? 1 : 0)
