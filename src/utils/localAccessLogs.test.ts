import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { inspectLocalAccessLogs, parseAccessLogLine } = require('../../electron-dist/accessLogs.cjs') as typeof import('../../electron/accessLogs.cts')

const temporary: string[] = []
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('本地访问日志发现与解析', () => {
  it('从服务器脚本目录发现常见日志并保留未知耗时', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpwindow-access-logs-'))
    temporary.push(root)
    fs.mkdirSync(path.join(root, 'data'))
    const script = path.join(root, 'server.cjs')
    fs.writeFileSync(script, '')
    fs.writeFileSync(path.join(root, 'data', 'request.log'), [
      "2026-10-30 12:00 POST /mcp auth=Y origin='https://platform.kimi.com' ct='application/json' -> 200",
      'truncated request',
      '2026-10-30 12:01 GET /health auth=N origin=None -> 503',
    ].join('\n'))
    fs.writeFileSync(path.join(root, 'data', 'access.jsonl'), `${JSON.stringify({ at: '2026-10-30T12:02:00+08:00', path: '/mcp', client: 'test', method: 'tools/call', status: 200, latencyMs: 18 })}\n`)
    const server = { id: 'local', name: 'local', command: process.execPath, args: `"${script}"` }

    const detected = await inspectLocalAccessLogs(server, false)
    expect(detected.total).toBe(3)
    expect(detected.skipped).toBe(1)
    expect(detected.logs).toEqual([])

    const result = await inspectLocalAccessLogs(server)
    expect(result.logs).toHaveLength(3)
    expect(result.logs[0]).toMatchObject({ sourceKey: 'terrafin-request:1', endpoint: '/mcp', client: 'platform.kimi.com', latencyMs: null, ok: true })
    expect(result.logs[1]).toMatchObject({ sourceKey: 'terrafin-request:3', ok: false })
    expect(result.logs[2]).toMatchObject({ latencyMs: 18, tool: 'tools/call', client: 'test' })
  })

  it('JSONL 时间戳支持秒并拒绝无时间记录', () => {
    const valid = parseAccessLogLine(JSON.stringify({ ts: 1_700_000_000, endpoint: '/mcp', ok: true }), 4, 's', 'access.jsonl')
    expect(valid?.ts).toBe(1_700_000_000_000)
    expect(parseAccessLogLine(JSON.stringify({ endpoint: '/mcp' }), 5, 's', 'access.jsonl')).toBeNull()
  })
})
