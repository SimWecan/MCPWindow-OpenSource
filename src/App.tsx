import { lazy, Suspense, useEffect } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import ThemeSwitcher from './components/ThemeSwitcher'
import { I18nRuntime } from './i18n'
import { subscribeProcExit } from './utils/control'
import { registerPluginHost } from './utils/pluginHostApi'
import { refreshServerData, startStatusPolling } from './utils/status'
import { useStore } from './store/useStore'
import { useTheme } from './store/useTheme'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Partitions = lazy(() => import('./pages/Partitions'))
const Servers = lazy(() => import('./pages/Servers'))
const Credentials = lazy(() => import('./pages/Credentials'))
const Logs = lazy(() => import('./pages/Logs'))
const AIAssistant = lazy(() => import('./pages/AIAssistant'))

const NAV = [
  { to: '/', icon: 'dashboard', label: '总览', end: true },
  { to: '/partitions', icon: 'partitions', label: '分区管理' },
  { to: '/servers', icon: 'servers', label: '服务器管理' },
  { to: '/credentials', icon: 'credentials', label: '凭证发放' },
  { to: '/logs', icon: 'logs', label: '日志统计' },
  { to: '/ai', icon: 'ai', label: 'AI 辅助管理' },
]

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    dashboard: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    partitions: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
    servers: 'M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M11 7h6M11 17h6',
    credentials: 'M15 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM3 21l7-7m-3 3 3 3m-1-6 3 3',
    logs: 'M4 20V10m5 10V4m6 16v-7m5 7V7',
    ai: 'm12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 13 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z',
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

export default function App() {
  const servers = useStore((s) => s.servers)
  const liveStatus = useStore((s) => s.liveStatus)
  const localConfigImported = useStore((s) => s.localConfigImported)
  const importLocalConfig = useStore((s) => s.importLocalConfig)
  useTheme((state) => state.theme)
  const active = servers.filter((s) => !s.archived)
  const running = active.filter((s) => liveStatus[s.id] === 'online').length
  const crashed = active.filter((s) => s.status === 'crashed' && liveStatus[s.id] !== 'online').length

  useEffect(() => {
    if (!localConfigImported) importLocalConfig()
  }, [localConfigImported, importLocalConfig])

  useEffect(() => registerPluginHost(), [])

  // 等加密配置恢复后再启动探测，避免首轮只探测到初始种子数据。
  useEffect(() => {
    const unsubscribeProc = subscribeProcExit()
    let stopPolling: (() => void) | undefined
    let active = true
    const beginPolling = () => {
      if (!active || stopPolling) return
      stopPolling = startStatusPolling(refreshServerData)
    }
    const unsubscribeHydration = useStore.persist.onFinishHydration(beginPolling)
    if (useStore.persist.hasHydrated()) beginPolling()
    return () => {
      active = false
      unsubscribeHydration()
      unsubscribeProc()
      stopPolling?.()
    }
  }, [])

  return (
    <div className="app">
      <I18nRuntime />
      <aside className="sidebar">
        <div className="logo">
          <img className="logo-badge" src="./logo.png" alt="MCPWindow Logo" />
          <div className="logo-copy"><strong>MCPWindow</strong><span>CONTROL CENTER</span></div>
        </div>
        <nav aria-label="主导航">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end as boolean | undefined} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="icon"><NavIcon name={n.icon} /></span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-status"><span className="dot" />运行中 {running} · 异常 {crashed}</div>
          <ThemeSwitcher />
        </div>
      </aside>
      <main className="main">
        <Suspense fallback={<div className="empty">页面加载中…</div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/partitions" element={<Partitions />} />
            <Route path="/servers" element={<Servers />} />
            <Route path="/servers/:serverId" element={<Servers />} />
            <Route path="/credentials" element={<Credentials />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/ai" element={<AIAssistant />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
