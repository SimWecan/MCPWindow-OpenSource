import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, safeStorage, screen, shell, Tray } from 'electron'
import { execFile, execSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closePluginWindows, registerPluginIpc } from './pluginManager.cjs'
import { inspectLocalAccessLogs, type AccessLogServerConfig } from './accessLogs.cjs'

// 启动诊断日志（桌面端启动验证用，开源版保留以便用户排障）
const diagLog = path.join(os.tmpdir(), 'mcpwindow-main.log')
const log = (msg: string): void => {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    fs.appendFileSync(diagLog, line)
  } catch {
    /* ignore */
  }
  try {
    // 备份位置：应用目录旁，避免 tmpdir 异常时无日志
    fs.appendFileSync(path.join(__dirname, 'main-debug.log'), line)
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', (e) => log(`uncaughtException: ${e.message}\n${e.stack ?? ''}`))
process.on('unhandledRejection', (e) => log(`unhandledRejection: ${String(e)}`))

log(`main started, pid=${process.pid}, platform=${process.platform}, isDev=${process.env.MCPWINDOW_DEV === '1'}`)

const isDev = process.env.MCPWINDOW_DEV === '1'
let allowWindowClose = false
let tray: Tray | null = null
let closePrompt: BrowserWindow | null = null

function restoreMainWindow(win: BrowserWindow): void {
  win.setSkipTaskbar(false)
  win.show()
  win.focus()
}

function ensureTray(win: BrowserWindow): void {
  if (tray) return
  const icon = nativeImage.createFromPath(path.join(__dirname, '../build/icon.png'))
  tray = new Tray(icon)
  tray.setToolTip('MCPWindow · MCP 状态监控运行中')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 MCPWindow', click: () => restoreMainWindow(win) },
    { type: 'separator' },
    { label: '退出应用', click: () => { allowWindowClose = true; app.quit() } },
  ]))
  tray.on('click', () => restoreMainWindow(win))
}

function dismissClosePrompt(): void {
  const prompt = closePrompt
  closePrompt = null
  if (prompt && !prompt.isDestroyed()) prompt.close()
}

function positionClosePrompt(win: BrowserWindow, prompt: BrowserWindow): void {
  if (win.isDestroyed() || prompt.isDestroyed()) return
  const parent = win.getBounds()
  const bounds = prompt.getBounds()
  const area = screen.getDisplayMatching(parent).workArea
  const x = Math.max(area.x, Math.min(parent.x + Math.round((parent.width - bounds.width) / 2), area.x + area.width - bounds.width))
  const y = Math.max(area.y, Math.min(parent.y + Math.round((parent.height - bounds.height) / 2), area.y + area.height - bounds.height))
  prompt.setPosition(x, y)
}

function showClosePrompt(win: BrowserWindow): void {
  if (closePrompt && !closePrompt.isDestroyed()) {
    positionClosePrompt(win, closePrompt)
    closePrompt.focus()
    return
  }
  const prompt = new BrowserWindow({
    parent: win, modal: true, width: 442, height: 340, useContentSize: true,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    frame: false, transparent: true, show: false, title: '关闭 MCPWindow', backgroundColor: '#00151020',
    webPreferences: { preload: path.join(__dirname, 'closeDialogPreload.cjs'), contextIsolation: true, nodeIntegration: false },
  })
  closePrompt = prompt
  const reposition = () => positionClosePrompt(win, prompt)
  win.on('move', reposition)
  win.on('resize', reposition)
  prompt.loadFile(path.join(__dirname, '../dist/close-dialog.html'))
  prompt.once('ready-to-show', () => { reposition(); prompt.show() })
  prompt.on('closed', () => {
    win.off('move', reposition)
    win.off('resize', reposition)
    if (closePrompt === prompt) closePrompt = null
  })
}

ipcMain.on('mcpwindow:close-choice', (event, choice: string) => {
  if (!closePrompt || event.sender !== closePrompt.webContents) return
  const win = closePrompt.getParentWindow()
  dismissClosePrompt()
  if (!win || win.isDestroyed()) return
  if (choice === 'minimize') {
    ensureTray(win)
    win.setSkipTaskbar(true)
    win.hide()
  } else if (choice === 'quit') {
    allowWindowClose = true
    app.quit()
  }
})

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    title: 'MCPWindow',
    backgroundColor: '#100d1c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('close', (event) => {
    if (allowWindowClose) return
    log('window close requested')
    event.preventDefault()
    showClosePrompt(win)
    log('close prompt created')
  })

  // 仅 http(s) 外部链接交给系统浏览器，避免打开本地协议或可执行内容。
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'http:' || target.protocol === 'https:') {
        void shell.openExternal(url).catch((error) => log(`openExternal error: ${error instanceof Error ? error.message : String(error)}`))
      }
    } catch {
      log(`blocked invalid external url: ${url.slice(0, 200)}`)
    }
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL('http://localhost:7100')
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    log(`loading file: ${indexPath}, exists=${fs.existsSync(indexPath)}`)
    win.loadFile(indexPath).catch((e) => log(`loadFile error: ${e.message}`))
  }
  log('window created')
}

ipcMain.handle('mcpwindow:select-directory', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('mcpwindow:save-text-file', async (event, defaultName: string, content: string) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (result.canceled || !result.filePath) return false
  fs.writeFileSync(result.filePath, content, 'utf8')
  return true
})

// 只检测服务器项目目录中的约定访问日志，不开放任意文件读取。
ipcMain.handle('mcpwindow:access-logs-discover', (_event, server: AccessLogServerConfig) =>
  inspectLocalAccessLogs(server, false),
)
ipcMain.handle('mcpwindow:access-logs-read', (_event, server: AccessLogServerConfig) =>
  inspectLocalAccessLogs(server, true),
)

app.whenReady().then(() => {
  log(`app ready, secureStorage=${safeStorage.isEncryptionAvailable()}`)
  registerPluginIpc()
  restoreDetachedProcesses()
  createWindow()
  app.on('activate', () => {
    const windows = BrowserWindow.getAllWindows().filter((win) => win !== closePrompt)
    if (windows.length === 0) createWindow()
    else restoreMainWindow(windows[0])
  })
})

// 本地 stdio MCP 探测以真实托管进程为准；exe 存在不代表 MCP 正在运行。
ipcMain.handle('mcpwindow:probe-local', (_event, id: string, command: string) => {
  if (!String(command).trim()) return 'unknown'
  return runningPid(id) ? 'online' : 'offline'
})

// ---------------- 本地 MCP 进程托管（启动 / 停止 / 重启） ----------------
const managed = new Map<string, ChildProcess>()
const detachedProcesses = new Map<string, number>()
const processRegistry = (): string => path.join(app.getPath('userData'), 'managed-processes.json')
function saveProcessRegistry(): void {
  try { fs.writeFileSync(processRegistry(), JSON.stringify(Object.fromEntries(detachedProcesses))) } catch { /* best effort */ }
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}
function restoreDetachedProcesses(): void {
  try {
    const saved = JSON.parse(fs.readFileSync(processRegistry(), 'utf8')) as Record<string, number>
    for (const [id, pid] of Object.entries(saved)) if (typeof pid === 'number' && processAlive(pid)) detachedProcesses.set(id, pid)
  } catch { /* no previous process registry */ }
}
function runningPid(id: string): number | null {
  return managed.get(id)?.pid ?? detachedProcesses.get(id) ?? null
}
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    else process.kill(-pid, 'SIGTERM')
  } catch { /* already stopped */ }
}

function notifyProcExit(id: string, code: number | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.send('mcpwindow:proc-exit', id, code) } catch { /* window closing */ }
  }
}

function detachSupervisors(): void {
  for (const supervisor of managed.values()) {
    // 退出前主动切断控制面，避免 Electron/便携启动器按仍连接的子进程回收进程树。
    // 不发送 stop：守护进程继续持有 MCP stdio，PID 注册保留供下次启动恢复。
    if (supervisor.connected) supervisor.disconnect()
    supervisor.unref()
    supervisor.channel?.unref()
  }
}

async function stopManaged(id: string): Promise<boolean> {
  const supervisor = managed.get(id)
  if (supervisor?.connected) supervisor.send({ type: 'stop' })
  else if (supervisor?.pid) killProcessTree(supervisor.pid)
  else {
    const pid = detachedProcesses.get(id)
    if (pid) killProcessTree(pid)
  }
  managed.delete(id)
  detachedProcesses.delete(id)
  saveProcessRegistry()
  return true
}

function splitArgs(input: string): string[] {
  const output: string[] = []
  let current = ''
  let quote = ''
  for (const char of input) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? '' : char
    } else if (/\s/.test(char) && !quote) {
      if (current) output.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) output.push(current)
  return output
}

function waitForMcpReady(child: ChildProcess, timeoutMs = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    let buffer = ''
    let settled = false
    const finish = (ready: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.off('exit', onExit)
      child.off('error', onError)
      resolve(ready)
    }
    const onExit = (): void => finish(false)
    const onError = (): void => finish(false)
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        try {
          const message = JSON.parse(line)
          if (message.id !== 'mcpwindow-initialize') continue
          const result = message.result
          finish(message.jsonrpc === '2.0' && typeof result?.protocolVersion === 'string' && typeof result?.capabilities === 'object')
          return
        } catch {
          // 忽略服务器 stdout 中的非 JSON 日志，不把它们当作 MCP 响应。
        }
      }
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    child.once('error', onError)
    child.stdout?.on('data', onData)
    if (!child.stdout || !child.stdin) {
      finish(false)
      return
    }
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0', id: 'mcpwindow-initialize', method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcpwindow', version: '0.8.4' } },
    })}\n`, (error) => { if (error) finish(false) })
  })
}

function portableSupervisorRuntime(): string {
  // Windows 便携版退出后会清理临时应用目录，守护进程不得继续从该目录运行。
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) {
    try {
      // node 可能是 .cmd  shim；先解析真实可执行文件，直接启动才能保留 IPC。
      const command = execSync('node -p "process.execPath"', { encoding: 'utf8', windowsHide: true }).trim()
      if (command && fs.existsSync(command) && path.resolve(command) !== path.resolve(process.execPath)) return command
    } catch { /* 没有外部 Node 时保留桌面运行时作为兼容回退 */ }
  }
  return process.execPath
}

async function startManaged(id: string, command: string, args: string | string[], env: Record<string, string> = {}): Promise<boolean> {
  if (runningPid(id)) return true
  try {
    const commandParts = Array.isArray(args) ? [command] : splitArgs(command)
    const executable = commandParts.shift() ?? command
    const argList = [...commandParts, ...(Array.isArray(args) ? args : splitArgs(args))]
    log(`proc-start ${id}: ${[executable, ...argList].join(' ')}`)
    // 守护脚本位于用户数据目录，避免便携版清理 app.asar 后影响运行中的 MCP。
    const runtimeDirectory = path.join(app.getPath('userData'), 'supervisor-runtime')
    fs.mkdirSync(runtimeDirectory, { recursive: true })
    const supervisorScript = path.join(runtimeDirectory, 'processSupervisor.cjs')
    fs.copyFileSync(path.join(__dirname, 'processSupervisor.cjs'), supervisorScript)
    const runtime = portableSupervisorRuntime()
    log(`supervisor runtime: ${runtime}; script: ${supervisorScript}`)
    const supervisor = spawn(runtime, [supervisorScript], {
      detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    managed.set(id, supervisor)
    const result = await new Promise<{ ok: boolean; pid?: number }>((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false }), 20_000)
      supervisor.on('message', (message: { type?: string; ok?: boolean; pid?: number }) => {
        if (message.type !== 'start-result') return
        clearTimeout(timer)
        resolve({ ok: message.ok === true, pid: message.pid })
      })
      supervisor.once('error', () => { clearTimeout(timer); resolve({ ok: false }) })
      supervisor.once('exit', () => { clearTimeout(timer); resolve({ ok: false }) })
      supervisor.send({ type: 'start', id, command: executable, args: argList, env })
    })
    if (!result.ok || !result.pid) {
      await stopManaged(id)
      return false
    }
    detachedProcesses.set(id, result.pid)
    saveProcessRegistry()
    supervisor.on('exit', (code) => {
      if (managed.get(id) === supervisor) managed.delete(id)
      detachedProcesses.delete(id)
      saveProcessRegistry()
      log(`proc-exit ${id}, code=${code}`)
      notifyProcExit(id, code)
    })
    supervisor.unref()
    supervisor.channel?.unref()
    return true
  } catch (e) {
    log(`proc-start failed ${id}: ${e instanceof Error ? e.message : String(e)}`)
    await stopManaged(id)
    return false
  }
}

ipcMain.handle('mcpwindow:proc-start', (_event, id: string, command: string, args: string | string[], env?: Record<string, string>) =>
  startManaged(id, command, args, env),
)

ipcMain.handle('mcpwindow:proc-stop', (_event, id: string) => stopManaged(id))

ipcMain.handle('mcpwindow:proc-restart', async (_event, id: string, command: string, args: string | string[], env?: Record<string, string>) => {
  await stopManaged(id)
  await new Promise((resolve) => setTimeout(resolve, 600))
  return startManaged(id, command, args, env)
})

// 仅采样 MCPWindow 托管进程；CPU 百分比由相邻两次 CPU 时间与墙钟差计算。
const resourceSamples = new Map<string, { cpuSeconds: number; sampledAt: number }>()
function execText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { windowsHide: true, timeout: 4_000 }, (error, stdout) => error ? reject(error) : resolve(stdout)))
}
ipcMain.handle('mcpwindow:proc-metrics', async (_event, requestedIds: string[]) => {
  const ids = Array.isArray(requestedIds) ? requestedIds.filter((id) => runningPid(id)).slice(0, 100) : []
  return Promise.all(ids.map(async (id) => {
    const pid = runningPid(id)!
    const now = Date.now()
    let cpuSeconds: number | null = null
    let memoryMB = 0
    let uptimeSeconds = 0
    if (process.platform === 'win32') {
      const raw = await execText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${pid} | Select-Object -Property CPU,WorkingSet64,StartTime | ConvertTo-Json -Compress`])
      const value = JSON.parse(raw) as { CPU?: number; WorkingSet64: number; StartTime: string }
      cpuSeconds = typeof value.CPU === 'number' ? value.CPU : null
      memoryMB = value.WorkingSet64 / 1048576
      // Windows PowerShell 默认把 DateTime 输出为 /Date(毫秒)/，而非 ISO 字符串。
      const dotnetDate = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(value.StartTime)
      const startedAt = dotnetDate ? Number(dotnetDate[1]) : Date.parse(value.StartTime)
      uptimeSeconds = Number.isFinite(startedAt) ? Math.max(0, (now - startedAt) / 1000) : 0
    } else {
      const raw = await execText('ps', ['-p', String(pid), '-o', 'times=,rss=,etimes='])
      const [times, rss, etimes] = raw.trim().split(/\s+/)
      cpuSeconds = Number(times)
      memoryMB = Number(rss) / 1024
      uptimeSeconds = Number(etimes)
    }
    const previous = resourceSamples.get(id)
    const cpuPercent = cpuSeconds !== null && previous && now > previous.sampledAt
      ? Math.max(0, (cpuSeconds - previous.cpuSeconds) * 100 / ((now - previous.sampledAt) / 1000)) : null
    if (cpuSeconds !== null) resourceSamples.set(id, { cpuSeconds, sampledAt: now })
    return { id, pid, cpuPercent, memoryMB: Math.round(memoryMB * 10) / 10, uptimeSeconds: Math.round(uptimeSeconds), sampledAt: now }
  }))
})

// MCP 探测也从主进程发出，避免把浏览器 CORS 失败误报为服务器离线。
ipcMain.handle('mcpwindow:probe-http', async (_event, rawUrl: string, headers: Record<string, string>, timeoutMs: number) => {
  const url = new URL(rawUrl)
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('MCP 地址仅支持 http(s)')
  if (url.protocol === 'http:' && !loopback) throw new Error('非本机 MCP 地址必须使用 HTTPS')
  const safeHeaders = Object.fromEntries(Object.entries(headers ?? {})
    .filter(([key, value]) => /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) && typeof value === 'string'))
  // Electron net 栈遵循 macOS / Windows 系统代理；Node fetch 会绕过代理导致远程握手失败。
  const response = await net.fetch(url.toString(), {
    method: 'POST',
    headers: { ...safeHeaders, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcpwindow', version: '0.8.4' } },
    }),
    signal: AbortSignal.timeout(Math.max(1_000, Math.min(Number(timeoutMs) || 8_000, 15_000))),
  })
  return { status: response.status, body: await response.text() }
})

// 管理请求在桌面主进程发出，避免远程服务器 CORS 导致界面“假成功”。
ipcMain.handle('mcpwindow:manage-request', async (_event, rawUrl: string, key: string, method: string, body?: unknown) => {
  const url = new URL(rawUrl)
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('管理接口仅支持 http(s)')
  if (url.protocol === 'http:' && !loopback) throw new Error('非本机管理接口必须使用 HTTPS')
  // Electron net 栈遵循 macOS / Windows 系统代理；Node fetch 会绕过代理导致远程握手失败。
  const response = await net.fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  })
  return { status: response.status, body: await response.json().catch(() => ({})) }
})

ipcMain.handle('mcpwindow:secure-storage-available', () => safeStorage.isEncryptionAvailable())
ipcMain.handle('mcpwindow:secure-storage-encrypt', (_event, value: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，请启用系统凭证库')
  return safeStorage.encryptString(String(value)).toString('base64')
})
ipcMain.handle('mcpwindow:secure-storage-decrypt', (_event, value: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，请启用系统凭证库')
  return safeStorage.decryptString(Buffer.from(String(value), 'base64'))
})

ipcMain.handle('mcpwindow:proc-list', () => [...new Set([...managed.keys(), ...detachedProcesses.keys()])])

// 应用生命周期与 MCP 生命周期解耦：仅关闭插件的沙箱窗口，不停止任何 MCP。
app.on('before-quit', () => {
  allowWindowClose = true
  detachSupervisors()
  closePluginWindows()
  tray?.destroy()
  tray = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
