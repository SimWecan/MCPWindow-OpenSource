import { buildHeaders, validateServerUrl } from './mcp.js'

export const ACCESS_LOG_ALARM = 'mcpwindow-access-log-sync'
export const ACCESS_LOG_PERIOD_MINUTES = 30
const MAX_LOGS = 20000

export function normalizeManagementUrl(value) {
  if (!String(value || '').trim()) return ''
  const url = new URL(String(value).trim())
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('日志管理接口仅支持 HTTP(S)')
  if (url.protocol === 'http:' && !loopback) throw new Error('非本机日志管理接口必须使用 HTTPS')
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/manage$/i, '')
  return url.toString().replace(/\/$/, '')
}

export function accessLogsUrl(server) {
  const base = normalizeManagementUrl(server.managementUrl) || new URL(validateServerUrl(server.url)).origin
  return `${base}/manage/access-logs?limit=${MAX_LOGS}`
}

function logHeaders(server) {
  if (server.managementKey) return { Accept: 'application/json', Authorization: `Bearer ${server.managementKey}` }
  const headers = buildHeaders(server)
  delete headers['Content-Type']
  return headers
}

function parseTime(value) {
  let ts = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  if (Number.isFinite(ts) && ts < 1_000_000_000_000) ts *= 1000
  return Number.isFinite(ts) ? ts : null
}

function sourceHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function normalizeAccessLog(record, serverId) {
  if (!record || typeof record !== 'object') return null
  const ts = parseTime(record.ts ?? record.timestamp ?? record.at ?? record.time)
  if (ts === null) return null
  const endpoint = String(record.endpoint ?? record.path ?? record.url ?? '/mcp')
  const client = String(record.client ?? record.clientIp ?? record.origin ?? '未知客户端')
  const tool = String(record.tool ?? record.method ?? record.action ?? 'MCP 请求')
  const status = typeof record.status === 'number' ? record.status : record.statusCode
  const ok = typeof record.ok === 'boolean' ? record.ok : typeof status === 'number' ? status >= 200 && status < 400 : true
  const rawLatency = record.latencyMs ?? record.latency_ms ?? record.durationMs ?? record.duration_ms
  const latencyMs = typeof rawLatency === 'number' && Number.isFinite(rawLatency) && rawLatency >= 0 ? rawLatency : null
  const id = record.id ?? record.sourceKey ?? record.request_id
  const sourceKey = `remote:${serverId}:${id ?? sourceHash(JSON.stringify([ts, endpoint, client, tool, ok, latencyMs]))}`
  const rawCount = record.count ?? record.requests ?? record.visits
  const count = typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount >= 0 ? rawCount : 1
  return { ts, serverId, endpoint, client, tool, ok, latencyMs, count, sourceKey }
}

export function normalizeAccessLogs(payload, serverId) {
  const records = Array.isArray(payload) ? payload : payload?.logs ?? payload?.records
  if (!Array.isArray(records)) throw new Error('日志接口响应缺少 logs 数组')
  return records.map(record => normalizeAccessLog(record, serverId)).filter(Boolean)
}

export function mergeAccessLogs(existing, incoming) {
  const known = new Set(existing.filter(log => log.sourceKey).map(log => `${log.serverId}\0${log.sourceKey}`))
  const additions = incoming.filter(log => {
    const key = `${log.serverId}\0${log.sourceKey}`
    if (known.has(key)) return false
    known.add(key)
    return true
  })
  return [...existing, ...additions].sort((a, b) => a.ts - b.ts).slice(-MAX_LOGS)
}

export async function fetchAccessLogs(server) {
  const response = await fetch(accessLogsUrl(server), {
    headers: logHeaders(server), signal: AbortSignal.timeout(12000),
  })
  if (response.status === 401 || response.status === 403) throw new Error('日志管理凭证无效或权限不足')
  if (!response.ok) throw new Error(`日志接口请求失败（HTTP ${response.status}）`)
  return normalizeAccessLogs(await response.json(), server.id)
}

let syncInFlight = null
export function syncAccessLogs() {
  if (syncInFlight) return syncInFlight
  syncInFlight = (async () => {
    const stored = await chrome.storage.local.get(['servers', 'accessLogs', 'accessLogMeta'])
    const servers = Array.isArray(stored.servers) ? stored.servers : []
    const currentLogs = Array.isArray(stored.accessLogs) ? stored.accessLogs : []
    const meta = stored.accessLogMeta && typeof stored.accessLogMeta === 'object' ? { ...stored.accessLogMeta } : {}
    let logs = currentLogs
    let imported = 0
    const errors = []
    await Promise.all(servers.map(async server => {
      try {
        const incoming = await fetchAccessLogs(server)
        const before = logs.length
        logs = mergeAccessLogs(logs, incoming)
        imported += logs.length - before
        meta[server.id] = { lastSyncAt: Date.now(), error: '' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        meta[server.id] = { lastSyncAt: Date.now(), error: message }
        errors.push(`${server.name}: ${message}`)
      }
    }))
    const lastAccessLogSyncAt = Date.now()
    await chrome.storage.local.set({ accessLogs: logs, accessLogMeta: meta, lastAccessLogSyncAt })
    return { servers: servers.length, imported, errors, lastAccessLogSyncAt }
  })().finally(() => { syncInFlight = null })
  return syncInFlight
}

export async function ensureAccessLogAlarm() {
  const alarm = await chrome.alarms.get(ACCESS_LOG_ALARM)
  if (!alarm) await chrome.alarms.create(ACCESS_LOG_ALARM, { periodInMinutes: ACCESS_LOG_PERIOD_MINUTES })
  return alarm || { name: ACCESS_LOG_ALARM, periodInMinutes: ACCESS_LOG_PERIOD_MINUTES }
}
