// @ts-nocheck -- 独立运行时的轻量 Node 脚本，编译为主进程同目录 CJS。
// 独立 stdio MCP 守护进程：MCPWindow 退出后继续保持 MCP 的 stdin/stdout。
const { spawn, execFile } = require('node:child_process')

let child
let stopping = false

function killTree(pid, done) {
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => done())
  else { try { child.kill('SIGTERM') } catch { /* already stopped */ } done() }
}

process.on('message', (message) => {
  if (message?.type === 'stop' && child?.pid) {
    stopping = true
    killTree(child.pid, () => process.exit(0))
    return
  }
  if (message?.type !== 'start' || child) return
  const { id, command, args, env } = message
  const directBinary = /^(node|python|python3)$/i.test(command) || /\.(exe|com)$/i.test(command)
  child = spawn(command, args, {
    shell: process.platform === 'win32' && !directBinary,
    windowsHide: true,
    env: { ...process.env, ...env },
  })
  let buffer = ''
  let ready = false
  const timeout = setTimeout(() => finish(false), 15_000)
  function finish(ok) {
    if (ready) return
    ready = true
    clearTimeout(timeout)
    if (!ok) {
      if (process.connected) process.send({ type: 'start-result', id, ok: false })
      killTree(child.pid, () => process.exit(0))
      return
    }
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    if (process.connected) process.send({ type: 'start-result', id, ok: true, pid: child.pid })
  }
  child.once('error', () => finish(false))
  child.once('exit', (code) => {
    if (process.connected) process.send({ type: 'exit', id, code })
    if (!stopping) process.exit(code || 0)
  })
  child.stdout.on('data', (chunk) => {
    if (ready) return
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      try {
        const response = JSON.parse(line)
        if (response.id !== 'mcpwindow-initialize') continue
        finish(response.jsonrpc === '2.0' && typeof response.result?.protocolVersion === 'string' && typeof response.result?.capabilities === 'object')
        return
      } catch { /* MCP stdout may contain ordinary logs */ }
    }
  })
  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0', id: 'mcpwindow-initialize', method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'mcpwindow', version: '0.8.0' } },
  })}\n`, (error) => { if (error) finish(false) })
})

// 与 Electron 断开 IPC 是正常生命周期事件，不得停止 MCP。
process.on('disconnect', () => { if (process.channel) process.channel.unref() })
