import test from 'node:test'
import assert from 'node:assert/strict'
import { dailySeries, hourlySeries, topEndpoints } from './charts.js'

const HOUR = 3600000
const DAY = 24 * HOUR

test('14 天趋势按本地自然日归档并支持聚合计数', () => {
  const now = new Date(2026, 9, 30, 12).getTime()
  const today = new Date(2026, 9, 30, 1).getTime()
  const yesterday = new Date(2026, 9, 29, 23).getTime()
  const series = dailySeries([
    { ts: today, count: 3 }, { ts: today, count: 0 }, { ts: yesterday }, { ts: now - 14 * DAY },
  ], now)
  assert.equal(series.length, 14)
  assert.equal(series.at(-1).value, 3)
  assert.equal(series.at(-2).value, 1)
  assert.equal(series.reduce((sum, item) => sum + item.value, 0), 4)
  assert.equal(series.at(-1).label, '10/30')
})

test('24 小时分布使用滚动小时窗口并忽略窗口外记录', () => {
  const now = new Date(2026, 9, 30, 12, 30).getTime()
  const currentHour = new Date(2026, 9, 30, 12, 10).getTime()
  const series = hourlySeries([
    { ts: currentHour, count: 2 }, { ts: currentHour - 23 * HOUR }, { ts: currentHour - 24 * HOUR },
  ], now)
  assert.equal(series.length, 24)
  assert.equal(series.at(-1).value, 2)
  assert.equal(series.at(-1).label, '12:00')
  assert.equal(series.reduce((sum, item) => sum + item.value, 0), 3)
})

test('热门端点按访问量降序并限制数量', () => {
  const entries = topEndpoints([
    { endpoint: '/mcp', count: 3 }, { endpoint: '/health' }, { endpoint: '/mcp', count: 2 },
    { endpoint: '/other', count: 4 },
  ], 2)
  assert.deepEqual(entries, [{ name: '/mcp', value: 5 }, { name: '/other', value: 4 }])
})
