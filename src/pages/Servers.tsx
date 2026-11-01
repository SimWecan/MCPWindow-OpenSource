import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { EChartsOption } from 'echarts'
import EChart from '../components/EChart'
import Modal from '../components/Modal'
import ServerFormModal from '../components/ServerFormModal'
import { parseMCPConfig } from '../data/localConfig'
import { STATUS_META, useStore } from '../store/useStore'
import type { MCPServer, ServerResourceMetric } from '../types'
import { bridge, isControllable, operateServer } from '../utils/control'
import { canManage } from '../utils/management'
import { LIVE_META } from '../utils/probe'
import { refreshServerData, SERVER_STATUS_POLL_MS } from '../utils/status'
import { discoverLocalHistory, importLocalHistory } from '../utils/accessLogSync'
import type { LocalAccessLogResult } from '../types'
import { bucketize, bucketizeCrashes, fmtTime, lastNDays, logCount } from '../utils/stats'
import { chartColors } from '../utils/chartTheme'
import { useTranslation } from '../i18n'
import { useLongPressReorder } from '../utils/useLongPressReorder'

export default function Servers() {
  const { serverId } = useParams()
  if (serverId) return <ServerDetail id={serverId} />
  return <ServerConsole />
}

/** 手动刷新与 30 分钟自动刷新共用状态及访问日志同步链路。 */
async function runProbe() {
  await refreshServerData()
}

function useResourceMetrics(idList: string) {
  const [metrics, setMetrics] = useState<Record<string, ServerResourceMetric>>({})
  useEffect(() => {
    let active = true
    const load = async () => {
      const ids = idList.split(',').filter(Boolean)
      if (!ids.length || !bridge()?.procMetrics) { if (active) setMetrics({}); return }
      try {
        const values = await bridge()!.procMetrics!(ids)
        if (active) setMetrics(Object.fromEntries(values.map((value) => [value.id, value])))
      } catch { if (active) setMetrics({}) }
    }
    void load()
    const timer = window.setInterval(() => void load(), 10_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [idList])
  return metrics
}

function formatUptime(seconds: number) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} 小时`
  return `${(seconds / 86400).toFixed(1)} 天`
}

/* ================= 主控台 ================= */

interface SavedServerView {
  name: string
  query: string
  partitionId: string
  tag: string
  favoritesOnly: boolean
}

function loadServerViews(): SavedServerView[] {
  try {
    const value = JSON.parse(localStorage.getItem('mcpwindow-server-views-v1') ?? '[]')
    return Array.isArray(value) ? value.filter((item) => item && typeof item.name === 'string').slice(0, 20) : []
  } catch { return [] }
}

function ServerConsole() {
  const servers = useStore((s) => s.servers)
  const partitions = useStore((s) => s.partitions)
  const accessLogs = useStore((s) => s.accessLogs)
  const crashLogs = useStore((s) => s.crashLogs)
  const liveStatus = useStore((s) => s.liveStatus)
  const lastProbeAt = useStore((s) => s.lastProbeAt)
  const probeIssues = useStore((s) => s.probeIssues)
  const { archiveServer, deleteServer, addServer, updateServer, reorderServers } = useStore()
  const proc = useStore((s) => s.proc)
  const controllableAvailable = !!bridge()?.procStart

  const [showArchived, setShowArchived] = useState(false)
  const [filterPartition, setFilterPartition] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'manual' | 'name' | 'status' | 'crashes' | 'access'>('manual')
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<MCPServer | null>(null)
  const [cloneMode, setCloneMode] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [movePartitionId, setMovePartitionId] = useState('')
  const [savedViews, setSavedViews] = useState<SavedServerView[]>(loadServerViews)
  const [viewName, setViewName] = useState('')
  const [historyQueue, setHistoryQueue] = useState<Array<LocalAccessLogResult & { serverId: string; serverName: string }>>([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const serverGridRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { t } = useTranslation()
  useLongPressReorder(serverGridRef, (orderedIds) => {
    reorderServers(orderedIds)
    setSortBy('manual')
    setImportMsg('服务器顺序已保存')
  })

  const activeParts = partitions.filter((p) => !p.archived)
  const partMap = useMemo(() => new Map(partitions.map((p) => [p.id, p])), [partitions])
  const allTags = useMemo(() => [...new Set(servers.flatMap((server) => server.tags ?? []))].sort(), [servers])
  const metrics = useResourceMetrics(Object.keys(proc).filter((id) => proc[id]).sort().join(','))
  useEffect(() => { localStorage.setItem('mcpwindow-server-views-v1', JSON.stringify(savedViews)) }, [savedViews])
  useEffect(() => { setSelectedIds((current) => current.filter((id) => servers.some((server) => server.id === id && !server.archived))) }, [servers])

  const historyPrompt = historyQueue[0]
  const detectAddedHistory = async (serverId: string) => {
    const server = useStore.getState().servers.find((item) => item.id === serverId)
    if (!server) return
    try {
      const detected = await discoverLocalHistory(server)
      if (detected.total > 0) {
        setHistoryError('')
        setHistoryQueue((current) => [...current, { ...detected, serverId, serverName: server.name }])
      } else updateServer(serverId, { accessLogSync: 'enabled' })
    } catch (error) {
      // 检测失败不阻断接入，也不在未经确认时导入旧记录；仅尝试后续新增内容。
      updateServer(serverId, { accessLogSync: 'enabled', accessLogSince: Date.now() })
      setImportMsg(`服务器已接入；历史记录检测失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const dismissHistory = () => {
    if (!historyPrompt || historyBusy) return
    updateServer(historyPrompt.serverId, { accessLogSync: 'enabled', accessLogSince: Date.now() })
    setHistoryQueue((current) => current.slice(1))
    setHistoryError('')
  }
  const confirmHistory = async () => {
    if (!historyPrompt || historyBusy) return
    const server = useStore.getState().servers.find((item) => item.id === historyPrompt.serverId)
    if (!server) { setHistoryQueue((current) => current.slice(1)); return }
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const result = await importLocalHistory(server)
      updateServer(server.id, { accessLogSync: 'enabled', accessLogSince: undefined })
      setImportMsg(`${server.name}：已导入 ${result.imported} 条访问记录${result.skipped ? `，跳过 ${result.skipped} 条无法识别记录` : ''}`)
      setHistoryQueue((current) => current.slice(1))
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error))
    } finally { setHistoryBusy(false) }
  }

  const dayAgo = Date.now() - 86400_000
  const access24h = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of accessLogs) {
      if (l.ts >= dayAgo) m.set(l.serverId, (m.get(l.serverId) ?? 0) + (l.count ?? 1))
    }
    return m
  }, [accessLogs]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = servers.filter((s) => {
    if (!showArchived && s.archived) return false
    if (filterPartition && s.partitionId !== filterPartition) return false
    if (filterTag && !(s.tags ?? []).includes(filterTag)) return false
    if (favoritesOnly && !s.favorite) return false
    const keyword = query.trim().toLowerCase()
    if (keyword && !`${s.name} ${s.description} ${s.command} ${(s.tags ?? []).join(' ')}`.toLowerCase().includes(keyword)) return false
    return true
  }).sort((a, b) => {
    if (sortBy === 'manual') return 0
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    if (sortBy === 'status') {
      const rank = { online: 0, auth: 1, offline: 2, unknown: 3 }
      return rank[liveStatus[a.id] ?? 'unknown'] - rank[liveStatus[b.id] ?? 'unknown'] || a.name.localeCompare(b.name)
    }
    if (sortBy === 'access') return (access24h.get(b.id) ?? 0) - (access24h.get(a.id) ?? 0)
    const crashCount = (id: string) => crashLogs.filter((log) => log.serverId === id && log.ts >= Date.now() - 14 * 86400_000).length
    return crashCount(b.id) - crashCount(a.id)
  })

  const onProbe = async () => {
    setProbing(true)
    setImportMsg(null)
    try {
      await runProbe()
      const activeCount = servers.filter((server) => !server.archived).length
      const issueCount = Object.keys(useStore.getState().probeIssues).length
      setImportMsg(`刷新完成：共 ${activeCount} 台，正常 ${activeCount - issueCount} 台，异常 ${issueCount} 台`)
    } catch (error) {
      setImportMsg(`刷新失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setProbing(false) }
  }

  const onOperate = async (server: MCPServer, action: 'start' | 'stop' | 'restart') => {
    setBusyId(server.id)
    setImportMsg(null)
    try {
      await operateServer(server, action)
      setImportMsg(canManage(server) ? `${server.name}${action === 'start' ? '启动' : action === 'stop' ? '停止' : '重启'}成功，已核实真实运行状态` : '进程操作已完成')
    } catch (error) {
      setImportMsg(`操作失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusyId(null)
    }
  }

  const guardLocalRunning = (server: MCPServer, action: '归档' | '删除'): boolean => {
    if (canManage(server) || !proc[server.id]) return true
    setImportMsg(`请先停止本地服务器 ${server.name} 再${action}，避免遗留不受管理的进程`)
    return false
  }

  const selectedServers = servers.filter((server) => selectedIds.includes(server.id) && !server.archived)
  const onBulk = async (action: 'start' | 'stop' | 'archive') => {
    if (!selectedServers.length) return
    setBulkBusy(true)
    let succeeded = 0
    let skipped = 0
    const errors: string[] = []
    for (const server of selectedServers) {
      if (action !== 'archive' && !(canManage(server) || (controllableAvailable && isControllable(server)))) { skipped++; continue }
      if (action === 'archive' && !guardLocalRunning(server, '归档')) { skipped++; continue }
      try {
        if (action === 'archive') archiveServer(server.id, true)
        else await operateServer(server, action)
        succeeded++
      } catch (error) { errors.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    setImportMsg(`批量操作完成：成功 ${succeeded} 台，跳过 ${skipped} 台，失败 ${errors.length} 台${errors.length ? `；${errors.join('；')}` : ''}`)
    setBulkBusy(false)
    if (!errors.length) setSelectedIds([])
  }

  const moveSelected = () => {
    if (!movePartitionId || !selectedIds.length) return
    for (const id of selectedIds) updateServer(id, { partitionId: movePartitionId })
    setImportMsg(`已将 ${selectedIds.length} 台服务器移动到 ${partitions.find((partition) => partition.id === movePartitionId)?.name ?? '目标分区'}`)
    setSelectedIds([])
  }
  const saveCurrentView = () => {
    const name = viewName.trim()
    if (!name) return
    const view = { name, query, partitionId: filterPartition, tag: filterTag, favoritesOnly }
    setSavedViews((current) => [...current.filter((item) => item.name !== name), view].slice(-20))
    setViewName('')
    setImportMsg(`已保存自定义视图“${name}”`)
  }
  const applyView = (name: string) => {
    const view = savedViews.find((item) => item.name === name)
    if (!view) return
    setQuery(view.query); setFilterPartition(view.partitionId); setFilterTag(view.tag); setFavoritesOnly(view.favoritesOnly)
  }

  const onImportFile = async (file: File) => {
    try {
      const parsed = parseMCPConfig(JSON.parse(await file.text()))
      if (parsed.length === 0) {
        setImportMsg('未在文件中找到可识别的 MCP 服务器配置')
        return
      }
      const target = filterPartition || activeParts[0]?.id
      if (!target) {
        setImportMsg('请先创建一个分区再导入')
        return
      }
      const existing = new Set(servers.map((s) => s.name))
      let added = 0
      for (const p of parsed) {
        if (existing.has(p.name)) continue
        const id = addServer({ ...p, partitionId: target, version: '导入', status: 'stopped', accessLogSync: 'pending' })
        added++
        void detectAddedHistory(id)
      }
      setImportMsg(`已导入 ${added} 个服务器${parsed.length - added > 0 ? `（跳过重复 ${parsed.length - added} 个）` : ''}`)
    } catch {
      setImportMsg('解析失败：不是有效的 JSON 配置文件')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const counts = {
    all: list.length,
    online: list.filter((s) => liveStatus[s.id] === 'online').length,
    auth: list.filter((s) => liveStatus[s.id] === 'auth').length,
    offline: list.filter((s) => liveStatus[s.id] === 'offline').length,
    unknown: list.filter((s) => !liveStatus[s.id] || liveStatus[s.id] === 'unknown').length,
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">{t('服务器管理 · 主控台')}</h2>
          <div className="page-sub">{lastProbeAt ? `${t('上次刷新')} ${fmtTime(lastProbeAt)} · ${t('下次约')} ${fmtTime(lastProbeAt + SERVER_STATUS_POLL_MS)}` : t('启动后自动刷新中…')} · {t('异常')} {Object.keys(probeIssues).length}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onProbe} disabled={probing}>{t(probing ? '探测中…' : '↻ 重新探测')}</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>{t('⇪ 导入 mcp.json')}</button>
          <button className="btn btn-primary" onClick={() => { setCloneMode(false); setEditTarget(null); setFormOpen(true) }}>{t('+ 接入服务器')}</button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f) }} />
        </div>
      </div>

      {importMsg && (
        <div className="card" style={{ marginBottom: 14, padding: '10px 16px', color: 'var(--text-2)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{importMsg}</span>
          <button className="btn btn-sm" onClick={() => setImportMsg(null)}>{t('关闭')}</button>
        </div>
      )}
      {Object.keys(probeIssues).length > 0 && <details className="card refresh-issues">
        <summary>{t('查看本轮')} {Object.keys(probeIssues).length} {t('项状态异常及原因')}</summary>
        <ul>{servers.filter((server) => probeIssues[server.id]).map((server) => <li key={server.id}><strong>{server.name}</strong>：{probeIssues[server.id]}</li>)}</ul>
      </details>}

      <div className="grid grid-5" style={{ marginBottom: 14 }}>
        {[
          { label: '全部服务器', value: counts.all, color: 'var(--text)' },
          { label: '在线', value: counts.online, color: 'var(--green)' },
          { label: '离线', value: counts.offline, color: counts.offline > 0 ? 'var(--red)' : 'var(--text)' },
          { label: '需凭证', value: counts.auth, color: counts.auth > 0 ? 'var(--orange)' : 'var(--text)' },
          { label: '未探测', value: counts.unknown, color: 'var(--text-2)' },
        ].map((c) => (
          <div key={c.label} className="card stat-card">
            <span className="stat-label">{t(c.label)}</span>
            <span className="stat-value" style={{ color: c.color }}>{c.value}</span>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <input aria-label={t('搜索服务器')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索名称、描述或命令')} />
        <select aria-label={t('按分区筛选服务器')} value={filterPartition} onChange={(e) => setFilterPartition(e.target.value)}>
          <option value="">{t('全部分区')}</option>
          {activeParts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select aria-label={t('服务器排序方式')} value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
          <option value="manual">{t('手动排序')}</option><option value="name">{t('按名称排序')}</option>
          <option value="status">{t('按在线状态排序')}</option><option value="crashes">{t('按 14 天崩溃排序')}</option>
          <option value="access">{t('按 24h 访问排序')}</option>
        </select>
        <label className="scope-check" style={{ padding: 0 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('显示已归档')}
        </label>
        <div className="spacer" />
        <span style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{t('共')} {list.length} {t('个 · 点击进详情 · 长按拖动排序')}</span>
      </div>
      <div className="toolbar server-view-toolbar">
        <select aria-label="按 Tags 筛选" value={filterTag} onChange={(event) => setFilterTag(event.target.value)}>
          <option value="">全部 Tags</option>{allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <label className="scope-check" style={{ padding: 0 }}><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />仅看收藏</label>
        <select aria-label="自定义视图" value="" onChange={(event) => { applyView(event.target.value); event.target.value = '' }}>
          <option value="">应用自定义视图…</option>{savedViews.map((view) => <option key={view.name} value={view.name}>{view.name}</option>)}
        </select>
        <input aria-label="视图名称" value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="保存当前筛选为视图" />
        <button className="btn btn-sm" disabled={!viewName.trim()} onClick={saveCurrentView}>保存视图</button>
      </div>
      {selectedIds.length > 0 && <div className="card bulk-toolbar">
        <strong>已选择 {selectedIds.length} 台服务器</strong>
        <button className="btn btn-sm" disabled={bulkBusy} onClick={() => void onBulk('start')}>批量启动</button>
        <button className="btn btn-sm" disabled={bulkBusy} onClick={() => void onBulk('stop')}>批量停止</button>
        <button className="btn btn-sm" disabled={bulkBusy} onClick={() => void onBulk('archive')}>批量归档</button>
        <select aria-label="批量移动目标分区" value={movePartitionId} onChange={(event) => setMovePartitionId(event.target.value)}><option value="">移动到分区…</option>{activeParts.map((partition) => <option key={partition.id} value={partition.id}>{partition.name}</option>)}</select>
        <button className="btn btn-sm" disabled={!movePartitionId || bulkBusy} onClick={moveSelected}>确认移动</button>
        <button className="btn btn-sm" disabled={bulkBusy} onClick={() => setSelectedIds([])}>取消选择</button>
      </div>}

      <div className="server-grid" ref={serverGridRef}>
        {list.map((s) => {
          const live = liveStatus[s.id] ?? 'unknown'
          const lm = LIVE_META[live]
          const part = partMap.get(s.partitionId)
          return (
            <div key={s.id} data-server-id={s.id} className="card server-card clickable" style={{ opacity: s.archived ? 0.55 : 1 }}
              title="长按卡片可拖动排序" onClick={() => navigate(`/servers/${s.id}`)}>
              {!s.archived && <div className="server-card-tools" onClick={(event) => event.stopPropagation()}>
                <label className="scope-check"><input aria-label={`选择服务器 ${s.name}`} type="checkbox" checked={selectedIds.includes(s.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, s.id])] : current.filter((id) => id !== s.id))} />选择</label>
                <button className={`favorite-button ${s.favorite ? 'active' : ''}`} aria-label={s.favorite ? `取消收藏 ${s.name}` : `收藏 ${s.name}`} aria-pressed={s.favorite ?? false} onClick={() => updateServer(s.id, { favorite: !s.favorite })}>{s.favorite ? '★' : '☆'}</button>
              </div>}
              <div className="server-top">
                <span className="server-name">
                  <span className={`dot ${live === 'online' ? 'pulse' : ''}`} style={{ background: lm.color, marginRight: 8 }} />
                  {s.name}
                </span>
                <span className="badge" style={{ color: lm.color, borderColor: lm.color }}>{lm.label}</span>
              </div>
              <div style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{s.description || '—'}</div>
              <div className="server-meta">
                {part && (
                  <span className="badge"><span className="dot" style={{ background: part.color }} />{part.name}</span>
                )}
                <span className="badge">{s.transport}</span>
                <span className="badge">24h 访问 {access24h.get(s.id)?.toLocaleString() ?? 0}</span>
                {(s.tags ?? []).map((tag) => <span key={tag} className="badge server-tag">#{tag}</span>)}
              </div>
              {metrics[s.id] && <div className="resource-metrics" aria-label={`资源监控 ${s.name}`}>
                <span>CPU <strong>{metrics[s.id].cpuPercent === null ? '采样中' : `${metrics[s.id].cpuPercent!.toFixed(1)}%`}</strong></span>
                <span>内存 <strong>{metrics[s.id].memoryMB.toFixed(1)} MB</strong></span>
                <span>运行 <strong>{formatUptime(metrics[s.id].uptimeSeconds)}</strong></span>
              </div>}
              <div className="partition-actions" onClick={(e) => e.stopPropagation()}>
                {!s.archived && (canManage(s) || (controllableAvailable && isControllable(s))) && (
                  (canManage(s) ? s.status === 'running' : proc[s.id])
                    ? <>
                        <button className="btn btn-sm" disabled={busyId === s.id} onClick={() => void onOperate(s, 'stop')}>停止</button>
                        <button className="btn btn-sm" disabled={busyId === s.id} onClick={() => void onOperate(s, 'restart')}>重启</button>
                      </>
                    : <button className="btn btn-sm btn-primary" disabled={busyId === s.id} onClick={() => void onOperate(s, 'start')}>{busyId === s.id ? '执行中…' : '启动'}</button>
                )}
                {live === 'auth' && <button className="btn btn-sm btn-primary" onClick={() => { setCloneMode(false); setEditTarget(s); setFormOpen(true) }}>配置访问凭证</button>}
                <button className="btn btn-sm" onClick={() => { setCloneMode(false); setEditTarget(s); setFormOpen(true) }}>编辑</button>
                <button className="btn btn-sm" onClick={() => { setCloneMode(true); setEditTarget({ ...s, name: `${s.name} 副本` }); setFormOpen(true) }}>克隆</button>
                <button className="btn btn-sm" onClick={() => { if (!s.archived && !guardLocalRunning(s, '归档')) return; archiveServer(s.id, !s.archived) }}>{s.archived ? '恢复' : '归档'}</button>
                <button className="btn btn-sm btn-danger" onClick={() => { if (guardLocalRunning(s, '删除')) setConfirmDelete(s.id) }}>删除</button>
              </div>
            </div>
          )
        })}
      </div>
      {list.length === 0 && <div className="empty">
        {query || filterPartition ? <><div>没有符合当前搜索或筛选条件的服务器</div><button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => { setQuery(''); setFilterPartition('') }}>清除搜索与筛选</button></> : t('暂无服务器，点击右上角「接入服务器」')}
      </div>}

      <ServerFormModal open={formOpen} initial={editTarget} clone={cloneMode} defaultPartitionId={filterPartition} onClose={() => setFormOpen(false)} onAdded={(id) => void detectAddedHistory(id)} />

      <Modal title="检测到历史访问记录" open={!!historyPrompt} onClose={dismissHistory}
        footer={<>
          <button className="btn" onClick={dismissHistory} disabled={historyBusy}>不导入历史记录</button>
          <button className="btn btn-primary" onClick={() => void confirmHistory()} disabled={historyBusy}>{historyBusy ? '导入中…' : '导入历史记录'}</button>
        </>}>
        {historyPrompt && <div>
          <p style={{ lineHeight: 1.7 }}>检测到 <strong>{historyPrompt.serverName}</strong> 的 <strong>{historyPrompt.total.toLocaleString()} 条</strong>历史访问记录。是否导入到 MCPWindow？</p>
          <div className="form-notice">导入仅写入本机加密存储，不会修改原日志。拒绝后将从现在开始同步新记录。</div>
          <ul style={{ paddingLeft: 18, lineHeight: 1.7, fontSize: 12 }}>
            {historyPrompt.files.map((file) => <li key={file.path}><code style={{ wordBreak: 'break-all' }}>{file.path}</code><br /><span style={{ color: 'var(--text-2)' }}>{file.count.toLocaleString()} 条可识别记录{file.skipped ? `，${file.skipped} 条跳过` : ''}</span></li>)}
          </ul>
          {historyError && <div role="alert" style={{ color: 'var(--red)' }}>导入失败：{historyError}</div>}
        </div>}
      </Modal>

      <Modal title="删除服务器" open={!!confirmDelete} onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDelete(null)}>取消</button>
            <button className="btn btn-danger" onClick={() => {
              if (confirmDelete) deleteServer(confirmDelete)
              setConfirmDelete(null)
            }}>确认删除</button>
          </>
        }>
        <p style={{ color: 'var(--text-2)', lineHeight: 1.7, margin: 0 }}>删除服务器将同时清除其访问日志与崩溃记录，不可恢复。</p>
      </Modal>
    </div>
  )
}

/* ================= 详细信息 ================= */

function ServerDetail({ id }: { id: string }) {
  const servers = useStore((s) => s.servers)
  const partitions = useStore((s) => s.partitions)
  const credentials = useStore((s) => s.credentials)
  const accessLogs = useStore((s) => s.accessLogs)
  const crashLogs = useStore((s) => s.crashLogs)
  const liveStatus = useStore((s) => s.liveStatus)
  const { setServerStatus, archiveServer, deleteServer } = useStore()
  const proc = useStore((s) => s.proc)
  const controllableAvailable = !!bridge()?.procStart
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const navigate = useNavigate()
  const metrics = useResourceMetrics(proc[id] ? id : '')

  const server = servers.find((s) => s.id === id)
  const onOperate = async (target: MCPServer, action: 'start' | 'stop' | 'restart') => {
    setBusy(true)
    setActionMessage(null)
    try {
      await operateServer(target, action)
      setActionMessage(canManage(target) ? '操作成功，已核实服务器真实运行状态' : '进程操作已完成')
    } catch (error) {
      setActionMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  const trend = useMemo(() => {
    if (!server) return null
    const { labels, start, step } = lastNDays(14)
    return {
      labels,
      accesses: bucketize(accessLogs, start, step, 14, server.id),
      crashes: bucketizeCrashes(crashLogs, start, step, 14, server.id),
    }
  }, [accessLogs, crashLogs, server])

  const endpoints = useMemo(() => {
    if (!server) return []
    const m = new Map<string, number>()
    const since = Date.now() - 14 * 86400_000
    for (const l of accessLogs) {
      if (l.serverId !== server.id || l.ts < since) continue
      m.set(l.endpoint, (m.get(l.endpoint) ?? 0) + logCount(l))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value }))
  }, [accessLogs, server])

  const recentLogs = useMemo(() => {
    if (!server) return []
    return accessLogs.filter((l) => l.serverId === server.id).sort((a, b) => b.ts - a.ts).slice(0, 30)
  }, [accessLogs, server])

  const crashes = useMemo(() => {
    if (!server) return []
    return crashLogs.filter((l) => l.serverId === server.id).sort((a, b) => b.ts - a.ts).slice(0, 15)
  }, [crashLogs, server])

  if (!server) {
    return (
      <div>
        <div className="page-header">
          <div><h2 className="page-title">服务器不存在</h2><div className="page-sub">该服务器可能已被删除</div></div>
          <Link to="/servers" className="btn">← 返回主控台</Link>
        </div>
      </div>
    )
  }

  const part = partitions.find((p) => p.id === server.partitionId)
  const live = liveStatus[server.id] ?? 'unknown'
  const lm = LIVE_META[live]
  const meta = STATUS_META[server.status]
  const controllable = canManage(server) || (controllableAvailable && isControllable(server))
  const scopedCreds = credentials.filter((c) => c.scopes.includes(server.partitionId))

  const colors = chartColors()
  const PALETTE = colors.palette
  const axis = {
    axisLine: { lineStyle: { color: colors.border } },
    axisLabel: { color: colors.text3, fontSize: 11 },
    splitLine: { lineStyle: { color: colors.grid } },
  }
  const tooltip = { trigger: 'axis' as const, backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.text, fontSize: 12 } }

  const optTrend: EChartsOption = {
    tooltip, legend: { textStyle: { color: colors.text2, fontSize: 12 }, top: 0 },
    grid: { left: 44, right: 40, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: trend?.labels ?? [], ...axis },
    yAxis: [
      { type: 'value', name: '访问', ...axis },
      { type: 'value', name: '崩溃', ...axis, splitLine: { show: false } },
    ],
    series: [
      { name: '访问次数', type: 'line', smooth: true, symbol: 'none', data: trend?.accesses ?? [], lineStyle: { width: 2.5, color: colors.accent }, itemStyle: { color: colors.accent }, areaStyle: { color: colors.accentSoft } },
      { name: '崩溃次数', type: 'bar', yAxisIndex: 1, data: trend?.crashes ?? [], itemStyle: { color: colors.red, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 10 },
    ],
  }

  const optPie: EChartsOption = {
    tooltip: { trigger: 'item', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.text, fontSize: 12 } },
    legend: { bottom: 0, textStyle: { color: colors.text2, fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['45%', '70%'], center: ['50%', '44%'],
      label: { color: colors.text2, fontSize: 11 },
      itemStyle: { borderColor: colors.surface, borderWidth: 2 },
      data: endpoints.map((d, i) => ({ ...d, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
    }],
  }

  const statusAction = (s: MCPServer) => {
    if (!controllable) return null
    const running = canManage(s) ? s.status === 'running' : proc[s.id]
    return running
      ? <>
          <button className="btn" disabled={busy} onClick={() => void onOperate(s, 'stop')}>停止</button>
          <button className="btn" disabled={busy} onClick={() => void onOperate(s, 'restart')}>重启</button>
        </>
      : <button className="btn btn-primary" disabled={busy} onClick={() => void onOperate(s, 'start')}>{busy ? '执行中…' : '启动'}</button>
  }

  const guardLocalRunning = (action: '归档' | '删除'): boolean => {
    if (canManage(server) || !proc[server.id]) return true
    setActionMessage(`请先停止本地服务器再${action}，避免遗留不受管理的进程`)
    return false
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">
            <Link to="/servers" className="back-link">← 主控台</Link>
            <span className={`dot ${live === 'online' ? 'pulse' : ''}`} style={{ background: lm.color, marginRight: 8, marginLeft: 12 }} />
            {server.name}
          </h2>
          <div className="page-sub">{server.description || '（无描述）'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!server.archived && statusAction(server)}
          <button className="btn" onClick={() => { if (!server.archived && !guardLocalRunning('归档')) return; archiveServer(server.id, !server.archived) }}>{server.archived ? '恢复' : '归档'}</button>
          <button className="btn btn-danger" onClick={() => { if (guardLocalRunning('删除')) setConfirmDelete(true) }}>删除</button>
        </div>
      </div>

      {actionMessage && <div className="card" style={{ marginBottom: 14, padding: 12 }}>{actionMessage}</div>}

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        {[
          { label: '实际探测', value: lm.label, color: lm.color },
          controllable
            ? { label: canManage(server) ? '远程管理' : '进程托管', value: canManage(server) ? '已配置 admin 权限' : proc[server.id] ? '托管运行中' : '未托管', color: canManage(server) || proc[server.id] ? 'var(--green)' : 'var(--text-2)' }
            : { label: '管理状态', value: meta.label, color: meta.color },
          { label: '24h 访问', value: accessLogs.reduce((a, l) => (l.serverId === server.id && l.ts >= Date.now() - 86400_000 ? a + logCount(l) : a), 0).toLocaleString(), color: 'var(--accent)' },
          { label: '14 天崩溃', value: String(crashLogs.filter((l) => l.serverId === server.id && l.ts >= Date.now() - 14 * 86400_000).length), color: 'var(--red)' },
        ].map((c) => (
          <div key={c.label} className="card stat-card">
            <span className="stat-label">{c.label}</span>
            <span className="stat-value" style={{ color: c.color, fontSize: 22 }}>{c.value}</span>
          </div>
        ))}
      </div>

      {metrics[id] && <div className="card resource-detail" aria-label={`资源监控 ${server.name}`}>
        <h3 className="card-title">资源监控 <small>PID {metrics[id].pid} · 每 10 秒采样</small></h3>
        <div><span>CPU 使用率<strong>{metrics[id].cpuPercent === null ? '首次采样中' : `${metrics[id].cpuPercent!.toFixed(1)}%`}</strong></span><span>工作集内存<strong>{metrics[id].memoryMB.toFixed(1)} MB</strong></span><span>连续运行时间<strong>{formatUptime(metrics[id].uptimeSeconds)}</strong></span></div>
      </div>}

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3 className="card-title">连接配置</h3>
          <div className="server-cmd mono">{server.command}{server.args ? ` ${server.args}` : ''}</div>
          <div className="server-meta" style={{ marginTop: 10 }}>
            {part && <span className="badge"><span className="dot" style={{ background: part.color }} />{part.name}</span>}
            <span className="badge">{server.transport}</span>
            <span className="badge">v{server.version}</span>
            <span className="badge">接入于 {fmtTime(server.createdAt).slice(0, 10)}</span>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
            {canManage(server)
              ? `远程管理：${server.managementUrl}，操作结果以服务器响应和状态回读为准`
              : !isControllable(server)
              ? '远程 HTTP 服务：未配置管理接口，仅支持在线探测'
              : controllableAvailable
                ? '本地服务：可由 MCPWindow 桌面版托管进程（启动 / 停止 / 重启）'
                : '浏览器预览模式：进程托管不可用，请使用桌面版控制启停'}
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">可访问凭证（{scopedCreds.length}）</h3>
          {scopedCreds.length === 0 && <div className="empty">该服务器所属分区未授权给任何凭证</div>}
          {scopedCreds.map((c) => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(38,47,71,.5)', fontSize: 13 }}>
              <span>{c.name} <span className="mono">{c.keyPrefix}…</span></span>
              <span className="badge">
                <span className="dot" style={{ background: c.enabled ? '#22c993' : '#8a93a6' }} />
                {c.enabled ? '启用' : '停用'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3 className="card-title">14 天访问 / 崩溃</h3>
          <EChart option={optTrend} height={260} />
        </div>
        <div className="card">
          <h3 className="card-title">端点分布（14 天）</h3>
          {endpoints.length ? <EChart option={optPie} height={260} /> : <div className="empty">暂无访问数据</div>}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <h3 className="card-title" style={{ padding: '16px 18px 0' }}>最近访问</h3>
          <table>
            <thead><tr><th>时间</th><th>端点</th><th>客户端</th><th>耗时</th><th>结果</th></tr></thead>
            <tbody>
              {recentLogs.map((l, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{fmtTime(l.ts).slice(5)}</td>
                  <td className="mono">{l.endpoint}</td>
                  <td>{l.client}</td>
                  <td>{l.latencyMs === null ? '—' : `${l.latencyMs}ms`}</td>
                  <td>{l.ok ? <span style={{ color: 'var(--green)' }}>成功 ×{l.count ?? 1}</span> : <span style={{ color: 'var(--red)' }}>失败</span>}</td>
                </tr>
              ))}
              {recentLogs.length === 0 && <tr><td colSpan={5}><div className="empty">暂无访问记录</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <h3 className="card-title" style={{ padding: '16px 18px 0' }}>崩溃记录</h3>
          <table>
            <thead><tr><th>时间</th><th>原因</th></tr></thead>
            <tbody>
              {crashes.map((l, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{fmtTime(l.ts).slice(5)}</td>
                  <td style={{ color: 'var(--red)' }}>{l.reason}</td>
                </tr>
              ))}
              {crashes.length === 0 && <tr><td colSpan={2}><div className="empty">无崩溃记录 🎉</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal title="删除服务器" open={confirmDelete} onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDelete(false)}>取消</button>
            <button className="btn btn-danger" onClick={() => {
              deleteServer(server.id)
              setConfirmDelete(false)
              navigate('/servers')
            }}>确认删除</button>
          </>
        }>
        <p style={{ color: 'var(--text-2)', lineHeight: 1.7, margin: 0 }}>删除服务器将同时清除其访问日志与崩溃记录，不可恢复。</p>
      </Modal>
    </div>
  )
}
