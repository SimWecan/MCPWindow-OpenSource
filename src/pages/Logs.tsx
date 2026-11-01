import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from '../components/EChart'
import { seedAccessLogs, seedCrashLogs } from '../data/seed'
import { useStore } from '../store/useStore'
import { bucketize, bucketizeCrashes, fmtTime, last24Hours, lastNDays, logCount } from '../utils/stats'
import { chartColors } from '../utils/chartTheme'
import { useAccessLogRefresh } from '../utils/useAccessLogRefresh'

export default function Logs() {
  const colors = chartColors()
  const PALETTE = colors.palette
  const servers = useStore((s) => s.servers)
  const realCrashLogs = useStore((s) => s.crashLogs)
  const realAccessLogs = useStore((s) => s.accessLogs)
  const lastAccessLogSyncAt = useStore((s) => s.lastAccessLogSyncAt)
  const [serverFilter, setServerFilter] = useState('')
  const [showDemo, setShowDemo] = useState(false)
  const { refresh, refreshing, message } = useAccessLogRefresh()
  const accessLogs = useMemo(() => showDemo ? [...realAccessLogs, ...seedAccessLogs()] : realAccessLogs, [realAccessLogs, showDemo])
  const crashLogs = useMemo(() => showDemo ? [...realCrashLogs, ...seedCrashLogs()] : realCrashLogs, [realCrashLogs, showDemo])

  const active = servers.filter((s) => !s.archived)
  const nameOf = useMemo(() => new Map(servers.map((s) => [s.id, s.name])), [servers])

  // 14 天访问趋势（按服务器分层折线）
  const trend14 = useMemo(() => {
    const { labels, start, step } = lastNDays(14)
    const top = [...active]
      .map((s) => ({ s, total: accessLogs.filter((l) => l.serverId === s.id && l.ts >= start).reduce((a, l) => a + logCount(l), 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((x) => x.s)
    const series = top.map((s, i) => ({
      name: s.name, type: 'line' as const, smooth: true, symbol: 'none',
      lineStyle: { width: 2 }, itemStyle: { color: PALETTE[i % PALETTE.length] },
      emphasis: { focus: 'series' as const },
      data: bucketize(accessLogs, start, step, 14, s.id),
    }))
    return { labels, series }
  }, [accessLogs, active])

  // 24 小时访问 + 崩溃对比
  const hourly = useMemo(() => {
    const { labels, start, step } = last24Hours()
    const accesses = bucketize(accessLogs, start, step, 24, serverFilter || undefined)
    const crashes = bucketizeCrashes(crashLogs, start, step, 24, serverFilter || undefined)
    return { labels, accesses, crashes }
  }, [accessLogs, crashLogs, serverFilter])

  // 端点分布 & 客户端分布 & 工具调用
  const dist = useMemo(() => {
    const ep = new Map<string, number>()
    const cl = new Map<string, number>()
    const window_ = Date.now() - 14 * 86400_000
    for (const l of accessLogs) {
      if (l.ts < window_) continue
      if (serverFilter && l.serverId !== serverFilter) continue
      const c = logCount(l)
      ep.set(l.endpoint, (ep.get(l.endpoint) ?? 0) + c)
      cl.set(l.client, (cl.get(l.client) ?? 0) + c)
    }
    const pie = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
    return { endpoints: pie(ep), clients: pie(cl) }
  }, [accessLogs, serverFilter])

  const recent = useMemo(() => {
    return [...accessLogs]
      .filter((l) => !serverFilter || l.serverId === serverFilter)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 40)
  }, [accessLogs, serverFilter])

  const recentCrashes = useMemo(() => {
    return [...crashLogs]
      .filter((l) => !serverFilter || l.serverId === serverFilter)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20)
  }, [crashLogs, serverFilter])

  const axisStyle = {
    axisLine: { lineStyle: { color: colors.border } },
    axisLabel: { color: colors.text3, fontSize: 11 },
    splitLine: { lineStyle: { color: colors.grid } },
  }
  const tooltip = { trigger: 'axis' as const, backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.text, fontSize: 12 } }
  const legend = { textStyle: { color: colors.text2, fontSize: 12 }, top: 0 }

  const optTrend14: EChartsOption = {
    tooltip, legend,
    grid: { left: 44, right: 16, top: 34, bottom: 26 },
    xAxis: { type: 'category', data: trend14.labels, ...axisStyle },
    yAxis: { type: 'value', ...axisStyle },
    series: trend14.series,
  }

  const optHourly: EChartsOption = {
    tooltip, legend,
    grid: { left: 44, right: 44, top: 34, bottom: 26 },
    xAxis: { type: 'category', data: hourly.labels, ...axisStyle },
    yAxis: [
      { type: 'value', name: '访问', ...axisStyle },
      { type: 'value', name: '崩溃', ...axisStyle, splitLine: { show: false } },
    ],
    series: [
      { name: '访问量', type: 'line', smooth: true, symbol: 'none', data: hourly.accesses, lineStyle: { width: 2.5, color: colors.accent }, itemStyle: { color: colors.accent }, areaStyle: { color: colors.accentSoft } },
      { name: '崩溃次数', type: 'bar', yAxisIndex: 1, data: hourly.crashes, itemStyle: { color: colors.red, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 14 },
    ],
  }

  const pieOf = (data: { name: string; value: number }[], palette: string[]): EChartsOption => ({
    tooltip: { trigger: 'item', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.text, fontSize: 12 } },
    legend: { ...legend, bottom: 0, type: 'scroll' as const },
    series: [{
      type: 'pie', radius: ['42%', '68%'], center: ['50%', '46%'],
      itemStyle: { borderColor: colors.surface, borderWidth: 2 },
      label: { color: colors.text2, fontSize: 11 },
      data: data.map((d, i) => ({ ...d, itemStyle: { color: palette[i % palette.length] } })),
    }],
  })

  const total14d = trend14.series.reduce((a, s) => a + s.data.reduce((x, y) => x + y, 0), 0)
  const crashCount = recentCrashes.length

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">日志统计</h2>
          <div className="page-sub">访问次数、崩溃次数、访问端点与来源客户端统一可视化 · 访问日志每 30 分钟同步{lastAccessLogSyncAt ? ` · 上次同步 ${fmtTime(lastAccessLogSyncAt)}` : ''}</div>
        </div>
        <button className="btn" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? '日志刷新中…' : '↻ 刷新日志'}</button>
      </div>
      {message && <div className="card form-notice" role="status">{message}</div>}

      <div className="toolbar">
        <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>服务器筛选：</span>
        <select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)}>
          <option value="">全部</option>
          {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="scope-check" style={{ padding: 0 }}>
          <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
          合并显示演示数据
        </label>
        <div className="spacer" />
        <span style={{ color: 'var(--text-3)', fontSize: 12.5 }}>{showDemo ? '含演示数据 · ' : ''}近 14 天总访问 {total14d.toLocaleString()} 次</span>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3 className="card-title">14 天访问趋势（按服务器）</h3>
          <EChart option={optTrend14} height={280} />
        </div>
        <div className="card">
          <h3 className="card-title">24 小时访问与崩溃对比</h3>
          <EChart option={optHourly} height={280} />
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <h3 className="card-title">访问端点分布（14 天）</h3>
          <EChart option={pieOf(dist.endpoints, PALETTE)} height={250} />
        </div>
        <div className="card">
          <h3 className="card-title">来源客户端分布（14 天）</h3>
          <EChart option={pieOf(dist.clients, ['#22c993', '#4f8dff', '#f6a04d', '#a78bfa', '#38bdf8', '#eab308'])} height={250} />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <h3 className="card-title" style={{ padding: '16px 18px 0' }}>最近访问明细</h3>
          <table>
            <thead><tr><th>时间</th><th>服务器</th><th>端点</th><th>客户端</th><th>耗时</th><th>结果</th></tr></thead>
            <tbody>
              {recent.map((l, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{fmtTime(l.ts).slice(5)}</td>
                  <td>{nameOf.get(l.serverId) ?? l.serverId}</td>
                  <td className="mono">{l.endpoint}</td>
                  <td>{l.client}</td>
                  <td>{l.latencyMs === null ? '—' : `${l.latencyMs}ms`}</td>
                  <td>{l.ok ? <span style={{ color: 'var(--green)' }}>成功 ×{l.count ?? 1}</span> : <span style={{ color: 'var(--red)' }}>失败</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <h3 className="card-title" style={{ padding: '16px 18px 0' }}>崩溃记录（{crashCount} 条近期）</h3>
          <table>
            <thead><tr><th>时间</th><th>服务器</th><th>原因</th></tr></thead>
            <tbody>
              {recentCrashes.map((l, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{fmtTime(l.ts).slice(5)}</td>
                  <td>{nameOf.get(l.serverId) ?? l.serverId}</td>
                  <td style={{ color: 'var(--red)' }}>{l.reason}</td>
                </tr>
              ))}
              {recentCrashes.length === 0 && <tr><td colSpan={3}><div className="empty">近期无崩溃 🎉</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
