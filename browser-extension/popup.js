import { probeServer, validateServerUrl } from './mcp.js'
import { parseMCPConfig, reorderByIds } from './config-parser.js'
import { attachCardInteractions } from './interactions.js'
import { normalizeManagementUrl } from './logs.js'
import { dailySeries, hourlySeries, renderBarChart, renderEndpoints, renderLineChart } from './charts.js'
import { appendServerActivity, filterAndSortServers } from './catalog.js'

const $ = id => document.getElementById(id)
const labels = { online: '在线', auth: '需凭证', offline: '离线', unknown: '待探测' }
const actionLabels = { add: '添加', remove: '删除', refresh: '探测', 'log-settings': '日志设置' }
const authLabels = { none: '无需认证', bearer: 'Bearer Token', basic: 'Basic Auth', 'api-key': 'API Key' }
const embedded = new URLSearchParams(location.search).get('embedded') === '1'
let servers = []
let accessLogs = []
let accessLogMeta = {}
let serverActivities = []
let lastAccessLogSyncAt = null
let probing = false
let detailId = null

async function recordActivity(action, serverName, ok, message) {
  serverActivities = appendServerActivity(serverActivities, { action, serverName, ok, message })
  await chrome.storage.local.set({ serverActivities })
  renderActivities()
}
function renderActivities() {
  $('activity-count').textContent = serverActivities.length ? `(${serverActivities.length})` : ''
  $('clear-activities').hidden = !serverActivities.length
  $('activities').replaceChildren()
  if (!serverActivities.length) {
    const empty = document.createElement('p')
    empty.className = 'notice'
    empty.textContent = '暂无操作记录'
    $('activities').append(empty)
    return
  }
  serverActivities.forEach(activity => {
    const item = document.createElement('div')
    item.className = `activity ${activity.ok ? 'success' : 'failure'}`
    const text = document.createElement('span')
    text.textContent = `${actionLabels[activity.action]} · ${activity.serverName} · ${activity.message}`
    const time = document.createElement('time')
    time.textContent = formatTime(activity.ts)
    item.append(text, time)
    $('activities').append(item)
  })
}

async function save() { await chrome.storage.local.set({ servers }) }
function setMessage(id, text, error = false) {
  $(id).textContent = text
  $(id).style.color = error ? '#f59aab' : ''
}
function formatTime(timestamp) { return timestamp ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : '尚未探测' }
async function requestLogSync() {
  const response = await chrome.runtime.sendMessage({ type: 'mcpwindow-access-logs-sync' })
  if (!response?.ok) throw new Error(response?.error || '访问日志同步失败')
  return response.result
}

function renderLogDashboard(server) {
  const logs = accessLogs.filter(log => log.serverId === server.id)
  const now = Date.now()
  const recent = logs.filter(log => log.ts >= now - 86400000)
  const count = items => items.reduce((total, log) => total + (log.count ?? 1), 0)
  const successful = recent.filter(log => log.ok)
  const recentTotal = count(recent)
  $('log-total-24h').textContent = recentTotal.toLocaleString()
  $('log-total-14d').textContent = count(logs.filter(log => log.ts >= now - 14 * 86400000)).toLocaleString()
  $('log-success-24h').textContent = recentTotal ? `${(count(successful) / recentTotal * 100).toFixed(1)}%` : '—'
  const meta = accessLogMeta[server.id]
  const syncedAt = meta?.lastSyncAt || lastAccessLogSyncAt
  $('log-sync-time').textContent = `每 30 分钟同步${syncedAt ? ` · ${formatTime(syncedAt)}` : ''}`
  setMessage('log-sync-error', meta?.error ? `日志同步失败：${meta.error}` : '', !!meta?.error)
  renderLineChart($('trend-chart'), dailySeries(logs, now))
  renderBarChart($('hourly-chart'), hourlySeries(logs, now))
  renderEndpoints($('endpoint-chart'), logs.filter(log => log.ts >= now - 14 * 86400000))
}

function renderDetail() {
  const server = servers.find(item => item.id === detailId)
  if (!server) { detailId = null; $('detail-view').hidden = true; $('list-view').hidden = false; return }
  const status = server.status || 'unknown'
  $('detail-name').textContent = server.name
  $('detail-dot').dataset.status = status
  $('detail-status').textContent = labels[status]
  $('detail-url').textContent = server.url
  $('detail-auth').textContent = authLabels[server.authType] || '无需认证'
  $('detail-result').textContent = labels[status]
  $('detail-time').textContent = formatTime(server.lastProbeAt)
  if (document.activeElement !== $('detail-management-url')) $('detail-management-url').value = server.managementUrl || ''
  if (document.activeElement !== $('detail-management-key')) $('detail-management-key').value = ''
  $('refresh-detail').disabled = probing
  renderLogDashboard(server)
}

function render() {
  const showingDetail = !!detailId && servers.some(server => server.id === detailId)
  $('list-view').hidden = showingDetail
  $('detail-view').hidden = !showingDetail
  if (showingDetail) { renderDetail(); return }
  const root = $('servers')
  root.replaceChildren()
  const counts = { online: 0, auth: 0, offline: 0, unknown: 0 }
  servers.forEach(server => { counts[server.status || 'unknown'] += 1 })
  $('summary').textContent = servers.length
    ? `${servers.length} 台服务器 · ${counts.online} 在线 · ${counts.auth} 需凭证 · ${counts.offline} 离线`
    : '尚未添加远程 MCP 服务器'
  const visibleServers = filterAndSortServers(servers, $('server-search').value, $('server-status-filter').value, $('server-sort').value)
  const customOrder = $('server-sort').value === 'custom' && !$('server-search').value.trim() && $('server-status-filter').value === 'all'
  document.querySelector('.list-hint').hidden = !visibleServers.length
  if (!visibleServers.length && servers.length) {
    const empty = document.createElement('p')
    empty.className = 'notice empty-result'
    empty.textContent = '没有符合条件的服务器'
    root.append(empty)
    return
  }
  visibleServers.forEach(server => {
    const card = document.createElement('article')
    card.className = 'server'
    card.dataset.status = server.status || 'unknown'
    card.dataset.serverId = server.id
    card.tabIndex = 0
    card.setAttribute('role', 'button')
    card.setAttribute('aria-label', `查看 ${server.name} 详情${customOrder ? '，长按可拖动排序' : ''}`)
    const dot = document.createElement('span')
    dot.className = 'status-dot'
    const info = document.createElement('div')
    info.className = 'server-info'
    const name = document.createElement('div')
    name.className = 'server-name'
    name.textContent = server.name
    const url = document.createElement('div')
    url.className = 'server-url'
    url.textContent = server.url
    url.title = server.url
    info.append(name, url)
    const state = document.createElement('span')
    state.className = 'server-state'
    state.textContent = labels[server.status || 'unknown']
    const remove = document.createElement('button')
    remove.className = 'delete'
    remove.title = `删除 ${server.name}`
    remove.setAttribute('aria-label', `删除 ${server.name}`)
    remove.textContent = '×'
    remove.addEventListener('click', async event => {
      event.stopPropagation()
      if (!confirm(`删除服务器“${server.name}”及其已保存凭证？`)) return
      servers = servers.filter(item => item.id !== server.id)
      accessLogs = accessLogs.filter(log => log.serverId !== server.id)
      delete accessLogMeta[server.id]
      await chrome.storage.local.set({ servers, accessLogs, accessLogMeta })
      await recordActivity('remove', server.name, true, '已删除')
      render()
    })
    card.append(dot, info, state, remove)
    root.append(card)
  })
}

async function refreshOne(server) {
  const status = await probeServer(server)
  return { ...server, status, lastProbeAt: Date.now() }
}
async function refreshAll() {
  if (probing) return
  probing = true
  $('refresh').disabled = true
  $('refresh-detail').disabled = true
  try {
    const results = await Promise.all(servers.map(refreshOne))
    const byId = new Map(results.map(server => [server.id, server]))
    servers = servers.map(server => byId.get(server.id) || server)
    await save()
    await requestLogSync().catch(() => undefined)
  } finally {
    probing = false
    $('refresh').disabled = false
    $('refresh-detail').disabled = false
    render()
  }
}

function updateAuthFields() {
  const type = $('auth-type').value
  $('credential-row').hidden = type === 'none'
  $('username-row').hidden = type !== 'basic'
  $('header-row').hidden = type !== 'api-key'
}

attachCardInteractions($('servers'), {
  onOpen(id) { detailId = id; render() },
  async onReorder(ids) {
    if ($('server-sort').value !== 'custom' || $('server-search').value.trim() || $('server-status-filter').value !== 'all') return
    const next = reorderByIds(servers, ids)
    if (next.some((server, index) => server.id !== servers[index]?.id)) {
      servers = next
      await save()
      $('summary').textContent = '服务器顺序已保存'
    }
    render()
  },
})

$('auth-type').addEventListener('change', updateAuthFields)
$('server-search').addEventListener('input', render)
$('server-status-filter').addEventListener('change', render)
$('server-sort').addEventListener('change', render)
$('clear-activities').addEventListener('click', async () => {
  serverActivities = []
  await chrome.storage.local.set({ serverActivities })
  renderActivities()
})
$('refresh').addEventListener('click', refreshAll)
$('back').addEventListener('click', () => { detailId = null; render() })
$('refresh-detail').addEventListener('click', async () => {
  const index = servers.findIndex(server => server.id === detailId)
  if (index < 0 || probing) return
  probing = true
  renderDetail()
  const serverName = servers[index].name
  try {
    servers[index] = await refreshOne(servers[index])
    await save()
    await requestLogSync().catch(() => undefined)
    await recordActivity('refresh', serverName, servers[index].status === 'online', labels[servers[index].status])
  } catch (error) {
    await recordActivity('refresh', serverName, false, error.message || '探测失败')
  } finally { probing = false; render() }
})
$('save-log-settings').addEventListener('click', async () => {
  const index = servers.findIndex(server => server.id === detailId)
  if (index < 0) return
  const button = $('save-log-settings')
  const serverName = servers[index].name
  button.disabled = true
  try {
    const managementUrl = normalizeManagementUrl($('detail-management-url').value)
    const managementKey = $('detail-management-key').value.trim()
    servers[index] = { ...servers[index], managementUrl, ...(managementKey ? { managementKey } : {}) }
    await save()
    const result = await requestLogSync()
    const error = result.errors.find(item => item.startsWith(`${servers[index].name}:`))
    if (error) throw new Error(error)
    const message = `日志接口已保存，本次新增 ${result.imported} 条记录`
    setMessage('log-settings-message', message)
    await recordActivity('log-settings', serverName, true, message)
  } catch (error) {
    const message = error.message || '日志接口保存或同步失败'
    setMessage('log-settings-message', message, true)
    await recordActivity('log-settings', serverName, false, message)
  } finally { button.disabled = false; renderDetail() }
})
$('pin').addEventListener('click', async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: embedded ? 'mcpwindow-panel-close' : 'mcpwindow-panel-toggle' })
    if (!response?.ok) throw new Error(response?.error || '无法钉住面板')
    if (embedded) $('pin').classList.remove('active')
  } catch (error) { alert(error.message || '当前网页不支持钉住面板') }
})
$('parse-json').addEventListener('click', () => {
  try {
    const { servers: parsed, skipped } = parseMCPConfig($('config-json').value)
    const first = parsed[0]
    $('name').value = first.name
    $('url').value = first.url
    $('auth-type').value = first.authType
    $('username').value = first.username || ''
    $('header-name').value = first.headerName || 'X-API-Key'
    $('credential').value = first.credential || ''
    updateAuthFields()
    $('add-panel').open = true
    $('config-json').value = ''
    setMessage('parse-message', `识别到 ${parsed.length} 台远程服务器，已填写“${first.name}”${skipped ? `；跳过 ${skipped} 项本地或无效配置` : ''}。请核对后保存。`)
    $('name').focus()
  } catch (error) { setMessage('parse-message', error.message || '无法识别配置', true) }
})
$('server-form').addEventListener('submit', async event => {
  event.preventDefault()
  const submit = event.submitter || event.target.querySelector('[type=submit]')
  submit.disabled = true
  const serverName = $('name').value.trim() || '未命名服务器'
  try {
    const server = {
      id: crypto.randomUUID(), name: $('name').value.trim(), url: validateServerUrl($('url').value.trim()),
      authType: $('auth-type').value, username: $('username').value,
      headerName: $('header-name').value.trim() || 'X-API-Key', credential: $('credential').value,
      managementUrl: normalizeManagementUrl($('management-url').value), managementKey: $('management-key').value.trim(),
    }
    if (!server.name) throw new Error('请填写名称')
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(server.headerName)) throw new Error('API Key 请求头格式无效')
    Object.assign(server, await refreshOne(server))
    servers.push(server)
    await save()
    await requestLogSync().catch(() => undefined)
    event.target.reset()
    $('header-name').value = 'X-API-Key'
    updateAuthFields()
    setMessage('form-message', '已保存并完成真实 MCP 探测')
    await recordActivity('add', server.name, true, labels[server.status])
    detailId = null
    render()
  } catch (error) {
    const message = error.message || '无法添加服务器'
    setMessage('form-message', message, true)
    await recordActivity('add', serverName, false, message)
  }
  finally { submit.disabled = false }
})

if (embedded) {
  document.body.classList.add('embedded')
  $('pin').classList.add('active')
  $('pin').title = '取消钉住'
  $('pin').setAttribute('aria-label', '取消钉住')
  const header = $('window-header')
  header.title = '拖动标题区移动窗口'
  const sendDrag = (type, event) => { void chrome.runtime.sendMessage({ type, x: event.screenX, y: event.screenY }).catch(() => {}) }
  let dragPointerId = null
  header.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || event.target.closest('button')) return
    event.preventDefault()
    dragPointerId = event.pointerId
    header.setPointerCapture(event.pointerId)
    sendDrag('mcpwindow-panel-drag-start', event)
  })
  header.addEventListener('pointermove', event => {
    if (dragPointerId === event.pointerId) sendDrag('mcpwindow-panel-drag-move', event)
  })
  const endDrag = event => {
    if (dragPointerId !== event.pointerId) return
    dragPointerId = null
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId)
    sendDrag('mcpwindow-panel-drag-end', event)
  }
  header.addEventListener('pointerup', endDrag)
  header.addEventListener('pointercancel', endDrag)
}
const stored = await chrome.storage.local.get(['servers', 'accessLogs', 'accessLogMeta', 'lastAccessLogSyncAt', 'serverActivities'])
servers = Array.isArray(stored.servers) ? stored.servers : []
accessLogs = Array.isArray(stored.accessLogs) ? stored.accessLogs : []
accessLogMeta = stored.accessLogMeta && typeof stored.accessLogMeta === 'object' ? stored.accessLogMeta : {}
serverActivities = Array.isArray(stored.serverActivities) ? stored.serverActivities : []
lastAccessLogSyncAt = stored.lastAccessLogSyncAt || null
render()
renderActivities()
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  let changed = false
  if (changes.servers && Array.isArray(changes.servers.newValue)) {
    servers = changes.servers.newValue
    changed = true
  }
  if (changes.accessLogs && Array.isArray(changes.accessLogs.newValue)) {
    accessLogs = changes.accessLogs.newValue
    changed = true
  }
  if (changes.accessLogMeta) {
    accessLogMeta = changes.accessLogMeta.newValue && typeof changes.accessLogMeta.newValue === 'object' ? changes.accessLogMeta.newValue : {}
    changed = true
  }
  if (changes.lastAccessLogSyncAt) {
    lastAccessLogSyncAt = changes.lastAccessLogSyncAt.newValue || null
    changed = true
  }
  if (changed) render()
})
await refreshAll()
