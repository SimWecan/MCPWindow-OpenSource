// 远程访问隧道：通过 cloudflared 快速隧道（quick tunnel）把配对服务暴露到公网，
// 让不在同一局域网的手机也能连接桌面端。未安装 cloudflared 时优雅降级。
import { ipcMain } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'

export interface TunnelStatus {
  running: boolean
  url: string
  error: string
}

let child: ChildProcess | null = null
let current: TunnelStatus = { running: false, url: '', error: '' }
const listeners = new Set<(status: TunnelStatus) => void>()
const TRY_CLOUDFLARE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i

function cloudflaredPath(): string | null {
  const candidates = [
    process.env.MCPWINDOW_CLOUDFLARED_PATH,
    process.env.CLOUDFLARED_PATH,
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
    '/usr/bin/cloudflared',
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch { /* 继续尝试下一个候选 */ }
  }
  try {
    const found = execFileSyncText('which', ['cloudflared'])
    if (found) return found
  } catch { /* PATH 中也没有 */ }
  return null
}

function execFileSyncText(command: string, args: string[]): string {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
  try {
    return execFileSync(command, args, { encoding: 'utf8', timeout: 4_000 }).trim()
  } catch {
    return ''
  }
}

function emit(): void {
  const snapshot = { ...current }
  for (const listener of listeners) listener(snapshot)
}

function stopTunnel(): TunnelStatus {
  if (child) {
    try { child.kill('SIGTERM') } catch { /* 进程可能已退出 */ }
    child = null
  }
  current = { running: false, url: '', error: '' }
  emit()
  return { ...current }
}

async function startTunnel(port: number): Promise<TunnelStatus> {
  stopTunnel()
  const binary = cloudflaredPath()
  if (!binary) {
    current = { running: false, url: '', error: 'cloudflared not found' }
    emit()
    return { ...current }
  }
  const target = `http://127.0.0.1:${port}`
  return new Promise((resolve) => {
    let buffer = ''
    let settled = false
    const finish = (status: TunnelStatus): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      current = status
      emit()
      resolve({ ...status })
    }
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const match = TRY_CLOUDFLARE.exec(buffer)
      if (match) finish({ running: true, url: match[0], error: '' })
    }
    const proc = spawn(binary, ['tunnel', '--url', target, '--no-autoupdate'], { windowsHide: true })
    child = proc
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.once('error', (error) => finish({ running: false, url: '', error: error.message }))
    proc.once('exit', (code) => {
      if (child === proc) child = null
      if (!settled) finish({ running: false, url: '', error: `cloudflared exited with code ${code}` })
      else if (current.running) { current = { running: false, url: '', error: 'tunnel closed' }; emit() }
    })
    const timer = setTimeout(
      () => finish({ running: false, url: '', error: 'tunnel startup timed out' }),
      45_000,
    )
    void timer
  })
}

export function registerTunnelIpc(): void {
  ipcMain.handle('mcpwindow:tunnel-status', () => ({ ...current }))
  ipcMain.handle('mcpwindow:tunnel-start', (_event, port: number) => startTunnel(Number(port) || 42101))
  ipcMain.handle('mcpwindow:tunnel-stop', () => stopTunnel())
}

// 供主进程退出时清理（before-quit 钩子调用）。
export function shutdownTunnel(): void {
  if (child) {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
    child = null
  }
  current = { running: false, url: '', error: '' }
}

export function onTunnelStatus(listener: (status: TunnelStatus) => void): () => void {
  listeners.add(listener)
  listener({ ...current })
  return () => listeners.delete(listener)
}
