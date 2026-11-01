import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import EChart from '../components/EChart'
import { STATUS_META, useStore } from '../store/useStore'
import { bucketize, bucketizeCrashes, fmtNum, fmtTime, last24Hours, lastNDays, logCount } from '../utils/stats'
import { chartColors } from '../utils/chartTheme'
import Modal from '../components/Modal'
import { createBackup, parseBackup, saveBackup } from '../utils/backup'
import { refreshServerStatuses } from '../utils/status'
import { useAccessLogRefresh } from '../utils/useAccessLogRefresh'

export default function Dashboard() {
  const colors = chartColors()
  const PALETTE = colors.palette
  const servers = useStore((s) => s.servers)
  const partitions = useStore((s) => s.partitions)
  const credentials = useStore((s) => s.credentials)
  const accessLogs = useStore((s) => s.accessLogs)
  const crashLogs = useStore((s) => s.crashLogs)
  const liveStatus = useStore((s) => s.liveStatus)
  const demoWorkspace = useStore((s) => s.demoWorkspace)
  const clearDemoWorkspace = useStore((s) => s.clearDemoWorkspace)
  const restoreBackup = useStore((s) => s.restoreBackup)
  const [confirmDemoClear, setConfirmDemoClear] = useState(false)
  const [backupMessage, setBackupMessage] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const { refresh: refreshLogs, refreshing: logsRefreshing, message: logsMessage } = useAccessLogRefresh()

  const exportConfig = async () => {
    setBackupBusy(true)
    try {
      if (await saveBackup(createBackup(partitions, servers))) setBackupMessage('脱敏备份已导出；不包含凭证、请求头、环境变量或 admin Key')
    } catch (error) { setBackupMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBackupBusy(false) }
  }
  const importConfig = async (file: File) => {
    setBackupBusy(true)
    try {
      const data = parseBackup(await file.text())
      const before = { partitions: partitions.length, servers: servers.length }
      restoreBackup(data.partitions, data.servers)
      const state = useStore.getState()
      const addedPartitions = state.partitions.length - before.partitions
      const addedServers = state.servers.length - before.servers
      const skipped = data.partitions.length + data.servers.length - addedPartitions - addedServers
      setBackupMessage(`备份合并完成：新增 ${addedPartitions} 个分区、${addedServers} 台服务器，跳过 ${skipped} 项冲突`)
      void refreshServerStatuses()
    } catch (error) { setBackupMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBackupBusy(false) }
  }

  const active = servers.filter((s) => !s.archived)
  const running = active.filter((s) => liveStatus[s.id] === 'online').length
  const crashed = active.filter((s) => s.status === 'crashed' && liveStatus[s.id] !== 'online').length
  const stopped = active.filter((s) => liveStatus[s.id] === 'offline' && s.status !== 'crashed').length
  const unconfirmed = active.length - running - crashed - stopped

  const dayAgo = Date.now() - 86400_000
  const weekAgo = Date.now() - 7 * 86400_000
  const access24h = accessLogs.reduce((a, l) => (l.ts >= dayAgo ? a + logCount(l) : a), 0)
  const access7d = accessLogs.reduce((a, l) => (l.ts >= weekAgo ? a + logCount(l) : a), 0)
  const crashes7d = crashLogs.filter((l) => l.ts >= weekAgo).length
  const latencies = accessLogs.filter((l) => l.ts >= dayAgo).flatMap((l) => l.latencyMs === null ? [] : [l.latencyMs])
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0

  const trend = useMemo(() => {
    const { labels, start, step } = lastNDays(14)
    return { labels, accesses: bucketize(accessLogs, start, step, 14), crashes: bucketizeCrashes(crashLogs, start, step, 14) }
  }, [accessLogs, crashLogs])

  const hourly = useMemo(() => {
    const { labels, start, step } = last24Hours()
    return { labels, data: bucketize(accessLogs, start, step, 24) }
  }, [accessLogs])

  const topTools = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of accessLogs) {
      if (l.ts < weekAgo) continue
      m.set(l.tool, (m.get(l.tool) ?? 0) + logCount(l))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [accessLogs, weekAgo])

  const axis = {
    axisLine: { lineStyle: { color: colors.border } },
    axisLabel: { color: colors.text3, fontSize: 11 },
    splitLine: { lineStyle: { color: colors.grid } },
  }
  const tooltip = { trigger: 'axis' as const, backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.text, fontSize: 12 } }

  const optTrend: EChartsOption = {
    tooltip, legend: { textStyle: { color: colors.text2, fontSize: 12 }, top: 0 },
    grid: { left: 46, right: 40, top: 32, bottom: 24 },
    xAxis: { type: 'category', data: trend.labels, ...axis },
    yAxis: [
      { type: 'value', name: '访问', ...axis },
      { type: 'value', name: '崩溃', ...axis, splitLine: { show: false } },
    ],
    series: [
      { name: '访问次数', type: 'line', smooth: true, symbol: 'none', data: trend.accesses, lineStyle: { width: 2.5, color: colors.accent }, itemStyle: { color: colors.accent }, areaStyle: { color: colors.accentSoft } },
      { name: '崩溃次数', type: 'bar', yAxisIndex: 1, data: trend.crashes, itemStyle: { color: colors.red, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 10 },
    ],
  }

  const optHourly: EChartsOption = {
    tooltip,
    grid: { left: 46, right: 16, top: 20, bottom: 24 },
    xAxis: { type: 'category', data: hourly.labels, ...axis },
    yAxis: { type: 'value', ...axis },
    series: [
      { name: '访问量', type: 'line', smooth: true, symbol: 'none', data: hourly.data, lineStyle: { width: 2, color: colors.green }, itemStyle: { color: colors.green }, areaStyle: { color: colors.accentSoft } },
    ],
  }

  const optStatus: EChartsOption = {
    tooltip: { trigger: 'item', backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.text, fontSize: 12 } },
    legend: { bottom: 0, textStyle: { color: colors.text2, fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['45%', '70%'], center: ['50%', '44%'],
      label: { color: colors.text2, fontSize: 11 },
      itemStyle: { borderColor: colors.surface, borderWidth: 2 },
      data: [
        { name: '运行中', value: running, itemStyle: { color: colors.green } },
        { name: '已停止', value: stopped, itemStyle: { color: colors.text3 } },
        { name: '崩溃', value: crashed, itemStyle: { color: colors.red } },
        { name: '未确认', value: unconfirmed, itemStyle: { color: colors.orange } },
      ],
    }],
  }

  const optTools: EChartsOption = {
    tooltip,
    grid: { left: 110, right: 30, top: 8, bottom: 24 },
    xAxis: { type: 'value', ...axis },
    yAxis: { type: 'category', data: topTools.map(([t]) => t).reverse(), ...axis },
    series: [{
      type: 'bar', barMaxWidth: 14,
      data: topTools.map(([, v], i) => ({ value: v, itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [0, 4, 4, 0] } })).reverse(),
    }],
  }

  const activeCredentials = credentials.filter((c) => c.enabled && (!c.expiresAt || c.expiresAt > Date.now()))
  const expiredEnabled = credentials.filter((c) => c.enabled && c.expiresAt && c.expiresAt <= Date.now()).length
  const credentialReminders = credentials.filter((credential) => credential.enabled && credential.expiresAt && credential.expiresAt <= Date.now() + 7 * 86400_000)
    .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0)).slice(0, 6)
  const stats = [
    { label: '运行中服务器', value: `${running} / ${active.length}`, extra: `崩溃 ${crashed} · 停止 ${stopped} · 未确认 ${unconfirmed}`, color: 'var(--green)' },
    { label: '24h 访问量', value: fmtNum(access24h), extra: `近 7 天 ${fmtNum(access7d)} 次`, color: 'var(--accent)' },
    { label: '近 7 天崩溃', value: String(crashes7d), extra: '查看日志统计定位原因', color: crashes7d > 0 ? 'var(--red)' : 'var(--green)' },
    { label: '活跃凭证', value: String(activeCredentials.length), extra: `共 ${credentials.length} 个 · 已过期未停用 ${expiredEnabled} · 平均延迟 ${avgLatency}ms`, color: 'var(--purple)' },
  ]

  const recentEvents = useMemo(() => {
    const serverNames = new Map(servers.map((server) => [server.id, server.name]))
    const evts = [
      ...crashLogs.slice(-8).map((c) => ({ ts: c.ts, text: `服务器 ${serverNames.get(c.serverId) ?? c.serverId} 崩溃：${c.reason}`, kind: 'crash' as const })),
    ]
    return evts.sort((a, b) => b.ts - a.ts).slice(0, 8)
  }, [crashLogs, servers])

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">总览</h2>
          <div className="page-sub">MCP 集群运行状态一览 · {partitions.filter((p) => !p.archived).length} 个分区</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={logsRefreshing} onClick={() => void refreshLogs()}>{logsRefreshing ? '日志刷新中…' : '↻ 刷新日志'}</button>
          <button className="btn" disabled={backupBusy} onClick={() => document.getElementById('backup-file')?.click()}>导入备份</button>
          <button className="btn" disabled={backupBusy} onClick={() => void exportConfig()}>导出脱敏备份</button>
          <input id="backup-file" aria-label="选择备份文件" type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importConfig(file); event.target.value = '' }} />
        </div>
      </div>

      {logsMessage && <div className="card form-notice" role="status">{logsMessage}</div>}
      {backupMessage && <div className="card form-notice" role="status">{backupMessage}<button className="btn btn-sm" style={{ float: 'right' }} onClick={() => setBackupMessage('')}>关闭</button></div>}
      {credentialReminders.length > 0 && <div className="card credential-reminders" role="status">
        <div><strong>凭证到期提醒</strong><span>{credentialReminders.length} 个启用凭证已过期或将在 7 天内到期</span></div>
        <div className="credential-reminder-list">{credentialReminders.map((credential) => <a href="#/credentials" key={credential.id} className={(credential.expiresAt ?? 0) <= Date.now() ? 'expired' : ''}><span>{credential.name}</span><small>{(credential.expiresAt ?? 0) <= Date.now() ? '已过期' : '即将到期'} · {fmtTime(credential.expiresAt!)}</small></a>)}</div>
      </div>}
      {demoWorkspace && <div className="card onboarding-banner">
        <div><strong>演示工作区</strong><p>当前包含内置示例服务器、分区和凭证，不代表真实运行环境。你可以先体验界面，或清除示例后开始接入。</p></div>
        <button className="btn btn-primary" onClick={() => setConfirmDemoClear(true)}>清空演示数据，开始接入</button>
      </div>}

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        {stats.map((s) => (
          <div key={s.label} className="card stat-card">
            <span className="stat-label">{s.label}</span>
            <span className="stat-value" style={{ color: s.color }}>{s.value}</span>
            <span className="stat-extra">{s.extra}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-3" style={{ marginBottom: 14 }}>
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <h3 className="card-title">14 天访问 / 崩溃趋势</h3>
          <EChart option={optTrend} height={260} />
        </div>
        <div className="card">
          <h3 className="card-title">服务器状态分布</h3>
          <EChart option={optStatus} height={260} />
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <h3 className="card-title">24 小时访问走势</h3>
          <EChart option={optHourly} height={220} />
        </div>
        <div className="card">
          <h3 className="card-title">热门工具 TOP8（7 天）</h3>
          <EChart option={optTools} height={220} />
        </div>
      </div>

      {recentEvents.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 className="card-title">近期异常事件</h3>
          <table>
            <tbody>
              {recentEvents.map((e, i) => (
                <tr key={i}>
                  <td style={{ color: 'var(--text-3)', whiteSpace: 'nowrap', width: 130 }}>{fmtTime(e.ts)}</td>
                  <td style={{ color: e.kind === 'crash' ? 'var(--red)' : 'var(--text)' }}>{e.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal title="清空演示数据" open={confirmDemoClear} onClose={() => setConfirmDemoClear(false)} footer={<><button className="btn" onClick={() => setConfirmDemoClear(false)}>取消</button><button className="btn btn-danger" onClick={() => { clearDemoWorkspace(); setConfirmDemoClear(false) }}>确认清空</button></>}>
        <p className="permission-details">将移除内置示例分区、服务器、凭证及其日志；你自行接入的真实配置会保留。此操作不可撤销，建议先导出脱敏备份。</p>
      </Modal>
    </div>
  )
}
