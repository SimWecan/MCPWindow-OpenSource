// 配对服务端到端传输测试：以 electron 桩驱动编译后的 pairingServer.cjs，
// 验证 HTTP 路由、令牌鉴权、快照同步广播与 WS 事件通道。
// 运行前提：npx tsc -p electron/tsconfig.json；node scripts/test-pairing-server.mjs
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-pairing-test-'))
const handlers = new Map()
const listeners = new Map()

const require = createRequire(path.join(root, 'scripts', 'x.cjs'))
// electron 真实包会被优先解析到，这里在模块加载层拦截 require('electron') 注入桩。
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

// ---- 断言工具 ----
let failures = 0
const check = (name, condition) => {
  console.log(`${condition ? '✔' : '✘'} ${name}`)
  if (!condition) failures++
}

const invoke = (name, ...args) => handlers.get(name)({}, ...args)

// ---- HTTP 请求 ----
const getJson = async (url, token) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const response = await fetch(url, { headers })
  return { status: response.status, body: await response.json().catch(() => null) }
}
const post = async (url, token, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

// ---- 极简 WS 客户端（文本帧） ----
function wsConnect(port, token) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64')
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
        const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
        if (!header.includes(`Sec-WebSocket-Accept: ${accept}`)) return reject(new Error('WS accept key mismatch'))
        buffer = buffer.subarray(headerEnd + 4)
        upgraded = true
        resolve({ socket, messages })
      }
      // 解析服务端文本帧（无掩码，可能 126/127 扩展长度）。
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

// ---- 测试流程 ----
const snapshot = {
  summary: { online: 1, needsCredentials: 0, offline: 1, crashesToday: 0, unreadAlerts: 1, pendingApprovals: 0 },
  servers: [
    { id: 's-1', name: '测试服务', description: '', partition: '默认分区', transport: 'stdio', status: 'online', endpoint: 'node a.js', credentialType: 'none', lastSeen: null, favorite: false },
    { id: 's-2', name: '离线服务', description: '', partition: '默认分区', transport: 'streamableHttp', status: 'offline', endpoint: 'http://x/mcp', credentialType: 'bearerToken', lastSeen: null, favorite: false },
  ],
  alerts: [{ id: 'a-1', title: '离线', message: '连接中断', severity: 'warning', createdAt: 1730000000000, read: false }],
  approvals: [],
  generatedAt: Date.now(),
}

const status = await invoke('mcpwindow:pairing-set-enabled', true)
check('配对服务启动并返回端口', status.running === true && typeof status.port === 'number' && status.token.length >= 16)
const { port, token } = status
check('状态查询一致', (await invoke('mcpwindow:pairing-status')).running === true)

const health = await getJson(`http://127.0.0.1:${port}/health`)
check('/health 无需令牌', health.status === 200 && health.body.ok === true)

const unauthorized = await getJson(`http://127.0.0.1:${port}/mobile/servers`)
check('无令牌返回 401', unauthorized.status === 401)

await invoke('mcpwindow:pairing-sync', snapshot)
const servers = await getJson(`http://127.0.0.1:${port}/mobile/servers`, token)
check('带令牌读取服务器列表', servers.status === 200 && servers.body.length === 2)
const summary = await getJson(`http://127.0.0.1:${port}/mobile/summary`, token)
check('summary 字段完整', summary.body.online === 1 && summary.body.offline === 1)
const missing = await getJson(`http://127.0.0.1:${port}/mobile/nope`, token)
check('未知路由返回 404', missing.status === 404)

const operate = await post(`http://127.0.0.1:${port}/mobile/servers/s-1/start`, token)
check('无渲染窗口时转发命令返回 502', operate.status === 502 && /窗口不可用/.test(operate.body.error ?? ''))

const respond = await post(`http://127.0.0.1:${port}/mobile/approvals/x/respond`, token, { approved: true })
check('审批响应在无窗口时返回 410/502', [410, 502].includes(respond.status))

const ws = await wsConnect(port, token)
await invoke('mcpwindow:pairing-sync', { ...snapshot, generatedAt: Date.now() })
await new Promise((resolve) => setTimeout(resolve, 300))
check('WS 握手成功并收到 connected 消息', ws.messages.some((m) => m.type === 'connected'))
check('快照同步经 WS 广播', ws.messages.some((m) => m.type === 'snapshot' && m.data.servers.length === 2))
ws.socket.end()

const wsDenied = await new Promise((resolve) => {
  const socket = net.connect(port, '127.0.0.1', () => {
    socket.write(
      'GET /mobile/events HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    )
  })
  socket.on('data', (chunk) => resolve(chunk.toString('utf8').includes('401')))
  socket.on('error', () => resolve(false))
  setTimeout(() => resolve(false), 3000)
})
check('WS 无令牌拒绝 401', wsDenied)

const stopped = await invoke('mcpwindow:pairing-set-enabled', false)
check('配对服务可关闭', stopped.running === false)

fs.rmSync(tempDir, { recursive: true, force: true })
if (failures) { console.error(`\n${failures} 项失败`); process.exit(1) }
console.log('\n配对服务传输测试全部通过')
process.exit(0)
