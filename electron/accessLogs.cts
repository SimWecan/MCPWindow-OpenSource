import fs from 'node:fs'
import path from 'node:path'

export interface AccessLogServerConfig {
  id: string
  name: string
  command: string
  args: string
  argList?: string[]
}

export interface ParsedAccessLog {
  ts: number
  endpoint: string
  client: string
  tool: string
  ok: boolean
  latencyMs: number | null
  sourceKey: string
}

export interface AccessLogFileSummary {
  path: string
  count: number
  skipped: number
}

export interface LocalAccessLogResult {
  files: AccessLogFileSummary[]
  total: number
  skipped: number
  logs: ParsedAccessLog[]
}

const LOG_RELATIVE_PATHS = [
  'data/request.log', 'logs/request.log', 'request.log',
  'data/access.jsonl', 'logs/access.jsonl', 'access.jsonl',
  'data/access.log', 'logs/access.log', 'access.log',
]
const MAX_LOG_BYTES = 32 * 1024 * 1024
const REQUEST_PATTERN = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (\S+) (\S+) auth=([YN])(?: origin=(?:'([^']*)'|None))?(?: ct=(?:'[^']*'|None))? -> (\d{3})$/

function splitArgs(input: string): string[] {
  const output: string[] = []
  let current = ''
  let quote = ''
  for (const char of input) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? '' : char
    else if (/\s/.test(char) && !quote) { if (current) output.push(current); current = '' }
    else current += char
  }
  if (current) output.push(current)
  return output
}

function sourceHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function candidateRoots(server: AccessLogServerConfig): string[] {
  const roots = new Set<string>()
  const tokens = [...splitArgs(server.command), ...(server.argList ?? splitArgs(server.args))]
  for (const raw of tokens) {
    const token = raw.trim().replace(/^['"]|['"]$/g, '')
    if (!path.isAbsolute(token) || /^https?:\/\//i.test(token)) continue
    try {
      const stat = fs.existsSync(token) ? fs.statSync(token) : null
      roots.add(stat?.isDirectory() ? token : path.dirname(token))
    } catch { /* 无效路径不参与检测 */ }
  }
  // TerraFin 的远程 HTTP 配置不包含本地脚本路径；仅在明确命名为 TerraFin 时，
  // 从当前工作区向上最多两层寻找其约定的 mcp-server 目录，不做全盘扫描。
  if (server.name.toLowerCase().includes('TerraFin'.toLowerCase())) {
    let current = process.cwd()
    for (let depth = 0; depth < 3; depth++) {
      roots.add(path.join(current, 'mcp-server'))
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return [...roots]
}

export function discoverAccessLogFiles(server: AccessLogServerConfig): string[] {
  const files = new Set<string>()
  for (const root of candidateRoots(server)) {
    for (const relative of LOG_RELATIVE_PATHS) {
      const candidate = path.join(root, relative)
      try { if (fs.statSync(candidate).isFile()) files.add(path.resolve(candidate)) } catch { /* 不存在或不可读 */ }
    }
  }
  return [...files]
}

function requestLog(line: string, lineNumber: number): ParsedAccessLog | null {
  const match = REQUEST_PATTERN.exec(line)
  if (!match) return null
  const [at, method, rawEndpoint, auth, origin, rawStatus] = match.slice(1)
  const ts = Date.parse(`${at.replace(' ', 'T')}:00+08:00`)
  if (!Number.isFinite(ts)) return null
  let client = auth === 'Y' ? '已认证请求' : '未认证请求'
  if (origin) {
    try { client = new URL(origin).hostname || client } catch { /* 保留认证来源 */ }
  }
  const status = Number(rawStatus)
  return {
    ts, endpoint: rawEndpoint.split('?')[0] || '/', client, tool: `HTTP ${method}`,
    ok: status >= 200 && status < 400, latencyMs: null, sourceKey: `${'TerraFin'.toLowerCase()}-request:${lineNumber}`,
  }
}

function numericLatency(record: Record<string, unknown>): number | null {
  const value = record.latencyMs ?? record.latency_ms ?? record.durationMs ?? record.duration_ms
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function jsonAccessLog(line: string, lineNumber: number, serverId: string, file: string): ParsedAccessLog | null {
  try {
    const record = JSON.parse(line) as Record<string, unknown>
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null
    const rawTs = record.ts ?? record.timestamp ?? record.at ?? record.time
    let ts = typeof rawTs === 'number' ? rawTs : typeof rawTs === 'string' ? Date.parse(rawTs) : NaN
    if (Number.isFinite(ts) && ts < 1_000_000_000_000) ts *= 1000
    if (!Number.isFinite(ts)) return null
    const endpoint = [record.endpoint, record.path, record.url].find((value) => typeof value === 'string') as string | undefined
    const client = [record.client, record.clientIp, record.origin].find((value) => typeof value === 'string') as string | undefined
    const tool = [record.tool, record.method, record.action].find((value) => typeof value === 'string') as string | undefined
    const status = typeof record.status === 'number' ? record.status : typeof record.statusCode === 'number' ? record.statusCode : null
    const ok = typeof record.ok === 'boolean' ? record.ok : status !== null ? status >= 200 && status < 400 : true
    return {
      ts, endpoint: endpoint || '/mcp', client: client || '未知客户端', tool: tool || 'MCP 请求', ok,
      latencyMs: numericLatency(record), sourceKey: `local-json:${serverId}:${file}:${lineNumber}:${sourceHash(line)}`,
    }
  } catch { return null }
}

export function parseAccessLogLine(line: string, lineNumber: number, serverId: string, file: string): ParsedAccessLog | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  return trimmed.startsWith('{')
    ? jsonAccessLog(trimmed, lineNumber, serverId, file)
    : requestLog(trimmed, lineNumber)
}

export async function inspectLocalAccessLogs(server: AccessLogServerConfig, includeLogs = true): Promise<LocalAccessLogResult> {
  const result: LocalAccessLogResult = { files: [], total: 0, skipped: 0, logs: [] }
  for (const file of discoverAccessLogFiles(server)) {
    const stat = await fs.promises.stat(file)
    if (stat.size > MAX_LOG_BYTES) throw new Error(`访问日志超过 32 MB，请先归档：${file}`)
    const content = await fs.promises.readFile(file, 'utf8')
    let count = 0
    let skipped = 0
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index].trim()) continue
      const parsed = parseAccessLogLine(lines[index], index + 1, server.id, file)
      if (!parsed) { skipped++; continue }
      count++
      if (includeLogs) result.logs.push(parsed)
    }
    if (count > 0 || skipped > 0) result.files.push({ path: file, count, skipped })
    result.total += count
    result.skipped += skipped
  }
  result.logs.sort((a, b) => a.ts - b.ts || a.sourceKey.localeCompare(b.sourceKey))
  return result
}
