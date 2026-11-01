const DAY = 86400000
const HOUR = 3600000

export function dailySeries(logs, now = Date.now(), days = 14) {
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)
  const start = end.getTime() - (days - 1) * DAY
  const values = Array(days).fill(0)
  for (const log of logs) {
    const date = new Date(log.ts)
    date.setHours(0, 0, 0, 0)
    const index = Math.round((date.getTime() - start) / DAY)
    if (index >= 0 && index < days) values[index] += log.count ?? 1
  }
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start + index * DAY)
    return { label: `${date.getMonth() + 1}/${date.getDate()}`, value: values[index] }
  })
}

export function hourlySeries(logs, now = Date.now()) {
  const end = Math.floor(now / HOUR) * HOUR
  const start = end - 23 * HOUR
  const values = Array(24).fill(0)
  for (const log of logs) {
    const index = Math.floor((log.ts - start) / HOUR)
    if (index >= 0 && index < 24) values[index] += log.count ?? 1
  }
  return Array.from({ length: 24 }, (_, index) => ({ label: `${String(new Date(start + index * HOUR).getHours()).padStart(2, '0')}:00`, value: values[index] }))
}

export function topEndpoints(logs, limit = 5) {
  const counts = new Map()
  for (const log of logs) counts.set(log.endpoint, (counts.get(log.endpoint) || 0) + (log.count ?? 1))
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, value]) => ({ name, value }))
}

const SVG_NS = 'http://www.w3.org/2000/svg'
function svgElement(tag, attributes = {}, text = '') {
  const element = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  if (text) element.textContent = text
  return element
}

function chartSvg(container) {
  container.replaceChildren()
  const svg = svgElement('svg', { viewBox: '0 0 440 150', role: 'img', class: 'access-chart' })
  container.append(svg)
  svg.append(svgElement('line', { x1: 30, y1: 116, x2: 428, y2: 116, class: 'chart-axis' }))
  return svg
}

export function renderLineChart(container, series) {
  const svg = chartSvg(container)
  svg.setAttribute('aria-label', '14 天访问趋势图')
  const max = Math.max(1, ...series.map(item => item.value))
  const points = series.map((item, index) => ({ ...item, x: 32 + index * 392 / Math.max(1, series.length - 1), y: 110 - item.value / max * 88 }))
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  svg.append(svgElement('path', { d: `${path} L424,116 L32,116 Z`, class: 'chart-area' }))
  svg.append(svgElement('path', { d: path, class: 'chart-line' }))
  for (const point of points.filter((_, index) => index === 0 || index === series.length - 1 || index === Math.floor(series.length / 2))) {
    svg.append(svgElement('text', { x: point.x, y: 137, 'text-anchor': 'middle', class: 'chart-label' }, point.label))
  }
  svg.append(svgElement('text', { x: 428, y: 14, 'text-anchor': 'end', class: 'chart-value' }, `峰值 ${max === 1 && series.every(item => !item.value) ? 0 : max}`))
}

export function renderBarChart(container, series) {
  const svg = chartSvg(container)
  svg.setAttribute('aria-label', '24 小时访问分布图')
  const max = Math.max(1, ...series.map(item => item.value))
  const width = 392 / series.length
  series.forEach((item, index) => {
    const height = item.value / max * 88
    const x = 32 + index * width
    svg.append(svgElement('rect', { x: x + 1, y: 110 - height, width: Math.max(2, width - 3), height, rx: 2, class: 'chart-bar' }, ''))
    const title = svgElement('title', {}, `${item.label}：${item.value} 次`)
    svg.lastChild.append(title)
    if (index % 6 === 0 || index === 23) svg.append(svgElement('text', { x, y: 137, 'text-anchor': 'middle', class: 'chart-label' }, item.label))
  })
}

export function renderEndpoints(container, logs) {
  container.replaceChildren()
  const entries = topEndpoints(logs)
  if (!entries.length) {
    const empty = document.createElement('div')
    empty.className = 'chart-empty'
    empty.textContent = '暂无访问记录；请确认日志管理接口与 admin 凭证已配置。'
    container.append(empty)
    return
  }
  const max = entries[0].value
  for (const entry of entries) {
    const row = document.createElement('div')
    row.className = 'endpoint-row'
    const name = document.createElement('span')
    name.textContent = entry.name
    name.title = entry.name
    const track = document.createElement('div')
    track.className = 'endpoint-track'
    const bar = document.createElement('div')
    bar.className = 'endpoint-bar'
    bar.style.width = `${Math.max(3, entry.value / max * 100)}%`
    track.append(bar)
    const value = document.createElement('strong')
    value.textContent = String(entry.value)
    row.append(name, track, value)
    container.append(row)
  }
}
