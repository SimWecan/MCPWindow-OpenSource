import type { AccessLog, CrashLog } from '../types'

export const DAY = 86400_000
export const HOUR = 3600_000

/** 最近 N 天的日期标签（MM-DD）与起止时间戳 */
export function lastNDays(n: number): { labels: string[]; start: number; step: number } {
  const now = Date.now()
  const labels: string[] = []
  const start = now - n * DAY
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * DAY)
    labels.push(`${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return { labels, start, step: DAY }
}

/** 最近 24 小时标签（HH:00） */
export function last24Hours(): { labels: string[]; start: number; step: number } {
  const now = Date.now()
  const labels: string[] = []
  const start = now - 24 * HOUR
  for (let i = 0; i < 24; i++) {
    const d = new Date(start + i * HOUR)
    labels.push(`${String(d.getHours()).padStart(2, '0')}:00`)
  }
  return { labels, start, step: HOUR }
}

export const logCount = (l: AccessLog) => l.count ?? 1

/** 按桶聚合访问量，返回每个桶的总数（可过滤 serverId） */
export function bucketize(logs: AccessLog[], start: number, step: number, n: number, serverId?: string): number[] {
  const out = new Array(n).fill(0)
  for (const l of logs) {
    if (serverId && l.serverId !== serverId) continue
    const idx = Math.floor((l.ts - start) / step)
    if (idx >= 0 && idx < n) out[idx] += logCount(l)
  }
  return out
}

export function bucketizeCrashes(logs: CrashLog[], start: number, step: number, n: number, serverId?: string): number[] {
  const out = new Array(n).fill(0)
  for (const l of logs) {
    if (serverId && l.serverId !== serverId) continue
    const idx = Math.floor((l.ts - start) / step)
    if (idx >= 0 && idx < n) out[idx] += 1
  }
  return out
}

export function fmtNum(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n.toLocaleString()
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
