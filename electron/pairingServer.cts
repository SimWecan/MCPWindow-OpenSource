// 移动端本地配对服务：局域网 HTTP + WebSocket，令牌鉴权。
// 数据快照由渲染进程（zustand 状态）同步到主进程，主进程仅做传输与鉴权；
// 移动端的所有写操作（启停/添加/删除/告警已读/审批）转发给渲染进程执行。
import { BrowserWindow, ipcMain, app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_PORT = 42101
const PORT_ATTEMPTS = 20
const COMMAND_TIMEOUT_MS = 20_000
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export interface PairingStatus {
  running: boolean
  port: number | null
  token: string
  addresses: string[]
  url: string | null
  /** 已连接的移动设备数（WS 长连接） */
  deviceCount: number
}

interface PairingConfig {
  token: string
  port?: number | null
  enabled?: boolean
}

interface CommandRequest {
  method: string
  params: Record<string, unknown>
  resolve: (result: { ok: boolean; error?: string }) => void
  timer: NodeJS.Timeout
}

let httpServer: http.Server | null = null
let currentPort: number | null = null
let snapshot: unknown = null
const pendingCommands = new Map<string, CommandRequest>()
const wsClients = new Set<{ send: (data: string) => void; close: () => void }>()

function configPath(): string {
  return path.join(app.getPath('userData'), 'pairing.json')
}

function loadConfig(): PairingConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as PairingConfig
    if (typeof parsed?.token === 'string' && parsed.token.length >= 16) return parsed
  } catch { /* 首次使用或配置损坏时重建 */ }
  return { token: crypto.randomBytes(24).toString('base64url') }
}

function saveConfig(patch: Partial<PairingConfig>): PairingConfig {
  const next = { ...loadConfig(), ...patch }
  try { fs.writeFileSync(configPath(), JSON.stringify(next, null, 2)) } catch { /* 最佳努力 */ }
  return next
}

function lanAddresses(): string[] {
  const addresses: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address)
    }
  }
  return addresses
}

function publicStatus(): PairingStatus {
  const config = loadConfig()
  const url = currentPort ? `http://<本机局域网IP>:${currentPort}` : null
  return { running: Boolean(httpServer), port: currentPort, token: config.token, addresses: lanAddresses(), url, deviceCount: wsClients.size }
}

// ---------------- HTTP 响应与鉴权 ----------------

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // 配对服务绑定局域网并强制令牌鉴权；放开 CORS 仅便于浏览器端调试工具。
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  })
  res.end(payload)
}

// HTTP 路由只认 Authorization 头：query token 会留在访问日志里，不安全。
function authorized(req: http.IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${loadConfig().token}`
}

// WS 升级（/mobile/events）无法携带自定义头，仅在此处允许 query token。
function authorizedWs(req: http.IncomingMessage): boolean {
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams
  return query.get('token') === loadConfig().token
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined)
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('请求体不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

// ---------------- 渲染进程命令转发 ----------------

function nextWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.find((win) => !win.isDestroyed() && win.webContents) ?? null
}

function forwardCommand(method: string, params: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const win = nextWindow()
  if (!win) return Promise.resolve({ ok: false, error: '桌面端窗口不可用' })
  const id = crypto.randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id)
      resolve({ ok: false, error: '桌面端处理超时' })
    }, COMMAND_TIMEOUT_MS)
    pendingCommands.set(id, { method, params, resolve, timer })
    try { win.webContents.send('mcpwindow:pairing-command', id, method, params) } catch { /* 窗口正在关闭 */ }
  })
}

// ---------------- 极简 WebSocket（RFC 6455 服务端文本帧） ----------------

interface WsConn { send: (data: string) => void; close: () => void }

function wsAcceptKey(key: string): string {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length
  let header: Buffer
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length])
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  return Buffer.concat([header, payload])
}

function handleWsConnection(socket: import('node:net').Socket): void {
  socket.setNoDelay(true)
  let buffer = Buffer.alloc(0)
  let fragments: Buffer[] = []
  let alive = true
  const conn: WsConn = {
    send: (data) => {
      if (!alive) return
      try { socket.write(encodeFrame(0x1, Buffer.from(data, 'utf8'))) } catch { /* 连接已断开 */ }
    },
    close: () => {
      alive = false
      try { socket.end(encodeFrame(0x8, Buffer.alloc(0))) } catch { /* 已断开 */ }
      wsClients.delete(conn)
    },
  }
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    // 循环解析完整帧：最少需要 2 字节头。
    while (buffer.length >= 2) {
      const fin = (buffer[0] & 0x80) !== 0
      const opcode = buffer[0] & 0x0f
      const masked = (buffer[1] & 0x80) !== 0
      let length = buffer[1] & 0x7f
      let offset = 2
      if (length === 126) {
        if (buffer.length < 4) return
        length = buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (buffer.length < 10) return
        const bigLength = buffer.readBigUInt64BE(2)
        if (bigLength > BigInt(8 * 1024 * 1024)) { conn.close(); return }
        length = Number(bigLength)
        offset = 10
      }
      const maskOffset = offset
      if (masked) offset += 4
      if (buffer.length < offset + length) return
      let payload = buffer.subarray(offset, offset + length)
      if (masked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4)
        const unmasked = Buffer.alloc(length)
        for (let i = 0; i < length; i++) unmasked[i] = payload[i] ^ mask[i & 3]
        payload = unmasked
      }
      buffer = buffer.subarray(offset + length)
      if (opcode === 0x8) { conn.close(); return }
      if (opcode === 0x9) { try { socket.write(encodeFrame(0xA, payload)) } catch { /* 已断开 */ } continue }
      if (opcode === 0xA) continue
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        fragments.push(payload)
        // 分片消息的结束标志是首个帧的 FIN 位；文本消息收到 FIN 即完整。
        if (fin) {
          const assembled = Buffer.concat(fragments).toString('utf8')
          fragments = []
          // 移动端事件通道目前只接收连接确认类消息，内容解析后直接忽略。
          void assembled
        }
      }
    }
  })
  socket.on('error', () => { alive = false; wsClients.delete(conn) })
  socket.on('close', () => { alive = false; wsClients.delete(conn) })
  wsClients.add(conn)
  conn.send(JSON.stringify({ type: 'connected', service: 'mcpwindow-pairing', at: Date.now() }))
  // 连接建立即下发当前快照：移动端首屏数据零等待，无需等下一次状态变化。
  if (snapshot !== null) {
    conn.send(JSON.stringify({ type: 'snapshot', data: snapshot }))
  }
}

function broadcastSnapshot(): void {
  if (snapshot === null) return
  const message = JSON.stringify({ type: 'snapshot', data: snapshot })
  for (const client of wsClients) client.send(message)
}

// ---------------- 路由 ----------------

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  const method = req.method ?? 'GET'
  if (process.env.MCPWINDOW_PAIRING_DEBUG === '1') {
    console.log(`[pairing] ${method} ${pathname} from ${req.socket.remoteAddress ?? '?'}`)
  }

  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'mcpwindow-pairing', version: '0.8.5' })
    return
  }
  if (method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' }); res.end(); return }
  if (!authorized(req)) { sendJson(res, 401, { ok: false, error: '未授权：需要配对令牌' }); return }

  const segments = pathname.split('/').filter(Boolean) // e.g. ['mobile','servers',':id','start']

  if (method === 'GET' && pathname === '/mobile/snapshot') {
    if (snapshot === null) { sendJson(res, 503, { ok: false, error: '桌面端尚未同步状态' }); return }
    sendJson(res, 200, snapshot)
    return
  }
  if (method === 'GET' && segments.length === 2 && segments[0] === 'mobile' && ['summary', 'servers', 'alerts', 'approvals'].includes(segments[1])) {
    if (snapshot === null || typeof snapshot !== 'object') { sendJson(res, 503, { ok: false, error: '桌面端尚未同步状态' }); return }
    sendJson(res, 200, (snapshot as Record<string, unknown>)[segments[1]] ?? null)
    return
  }

  if (method === 'POST' && segments.length === 4 && segments[0] === 'mobile' && segments[1] === 'servers' && ['start', 'stop', 'restart'].includes(segments[3])) {
    const result = await forwardCommand('server.operate', { id: segments[2], action: segments[3] })
    sendJson(res, result.ok ? 200 : 502, { ok: result.ok, error: result.error })
    return
  }
  if (method === 'DELETE' && segments.length === 3 && segments[0] === 'mobile' && segments[1] === 'servers') {
    const result = await forwardCommand('server.remove', { id: segments[2] })
    sendJson(res, result.ok ? 200 : 502, { ok: result.ok, error: result.error })
    return
  }
  if (method === 'POST' && segments.length === 2 && segments[0] === 'mobile' && segments[1] === 'servers') {
    const body = await readBody(req)
    const result = await forwardCommand('server.add', { payload: body })
    sendJson(res, result.ok ? 200 : 400, { ok: result.ok, error: result.error })
    return
  }
  if (method === 'POST' && segments.length === 3 && segments[0] === 'mobile' && segments[1] === 'alerts' && segments[2] === 'read-all') {
    const result = await forwardCommand('alerts.readAll', {})
    sendJson(res, result.ok ? 200 : 502, { ok: result.ok, error: result.error })
    return
  }
  if (method === 'POST' && segments.length === 4 && segments[0] === 'mobile' && segments[1] === 'approvals' && segments[3] === 'respond') {
    const body = (await readBody(req)) as { approved?: boolean }
    const result = await forwardCommand('approval.respond', { id: segments[2], approved: body?.approved === true })
    sendJson(res, result.ok ? 200 : 410, { ok: result.ok, error: result.error })
    return
  }
  sendJson(res, 404, { ok: false, error: '接口不存在' })
}

function createServer(): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    handleApi(req, res, url.pathname).catch((error) => {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    })
  })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/mobile/events' || !authorizedWs(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const key = req.headers['sec-websocket-key']
    if (!key || Array.isArray(key)) { socket.destroy(); return }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n\r\n`,
    )
    if (head?.length) socket.unshift(head)
    handleWsConnection(socket as import('node:net').Socket)
  })
  return server
}

function tryListen(port: number, attempts: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = httpServer
    if (!server) return resolve(null)
    const onError = (error: NodeJS.ErrnoException): void => {
      if (error.code === 'EADDRINUSE' && attempts > 1 && port < DEFAULT_PORT + PORT_ATTEMPTS) {
        resolve(tryListen(port + 1, attempts - 1))
      } else {
        resolve(null)
      }
    }
    server.once('error', onError)
    server.listen(port, '0.0.0.0', () => {
      server.off('error', onError)
      resolve(port)
    })
  })
}

async function startPairing(): Promise<PairingStatus> {
  if (httpServer) return publicStatus()
  httpServer = createServer()
  const port = await tryListen(DEFAULT_PORT, PORT_ATTEMPTS)
  if (port === null) {
    httpServer.close()
    httpServer = null
    currentPort = null
    return publicStatus()
  }
  currentPort = port
  saveConfig({ port, enabled: true })
  return publicStatus()
}

function stopPairing(): PairingStatus {
  for (const client of [...wsClients]) client.close()
  if (httpServer) {
    httpServer.close()
    httpServer = null
  }
  currentPort = null
  saveConfig({ enabled: false })
  return publicStatus()
}

// ---------------- IPC 注册 ----------------

export function registerPairingIpc(): void {
  ipcMain.handle('mcpwindow:pairing-status', () => publicStatus())
  ipcMain.handle('mcpwindow:pairing-set-enabled', async (_event, enabled: boolean) =>
    enabled ? startPairing() : stopPairing(),
  )
  ipcMain.handle('mcpwindow:pairing-regenerate-token', () => {
    const config = saveConfig({ token: crypto.randomBytes(24).toString('base64url') })
    return { ...publicStatus(), token: config.token }
  })
  ipcMain.handle('mcpwindow:pairing-sync', (_event, next: unknown) => {
    snapshot = next ?? null
    broadcastSnapshot()
    return { ok: true, devices: wsClients.size }
  })
  // 渲染进程执行命令后的回执
  ipcMain.on('mcpwindow:pairing-command-result', (_event, id: string, result: { ok?: boolean; error?: string }) => {
    const pending = pendingCommands.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingCommands.delete(id)
    pending.resolve({ ok: result?.ok === true, error: typeof result?.error === 'string' ? result.error : undefined })
  })

  // 上次退出前处于开启状态则自动启动配对服务。
  if (loadConfig().enabled) void startPairing().then((status) => {
    if (status.running) console.log(`[pairing] auto-started on port ${status.port}`)
  })
}
