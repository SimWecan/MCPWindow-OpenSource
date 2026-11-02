import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { useTheme } from '../store/useTheme'
import { useLanguage } from '../store/useLanguage'
import { THEMES } from '../utils/theme'
import { useTranslation } from '../i18n'
import { bridge } from '../utils/bridge'
import type { ToolPlugin, ToolPluginTool } from '../types'
import { validateToolArguments } from '../utils/pluginArguments'
import { appendPluginActivity, filterAndSortPlugins, readPluginActivities, PLUGIN_ACTIVITY_KEY, type PluginActivity, type PluginActivityAction, type PluginSort, type PluginStatusFilter } from '../utils/pluginCatalog'
import { checkForUpdates, type UpdateResult } from '../utils/updateCheck'

function argumentTemplate(tool?: ToolPluginTool): string {
  const schema = tool?.inputSchema
  const properties = schema?.properties as Record<string, Record<string, unknown>> | undefined
  const required = Array.isArray(schema?.required) ? schema.required as string[] : []
  const names = [...new Set([...required, ...Object.entries(properties ?? {}).filter(([, field]) => 'default' in field).map(([name]) => name)])]
  return JSON.stringify(Object.fromEntries(names.map((name) => {
    const field = properties?.[name] ?? {}
    const value = 'default' in field ? field.default : Array.isArray(field.enum) ? field.enum[0]
      : field.type === 'string' ? '' : field.type === 'number' || field.type === 'integer' ? 0
      : field.type === 'boolean' ? false : field.type === 'array' ? [] : {}
    return [name, value]
  })), null, 2)
}

export default function ThemeSwitcher() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'appearance' | 'plugins'>('appearance')
  const theme = useTheme((state) => state.theme)
  const setTheme = useTheme((state) => state.setTheme)
  const language = useLanguage((state) => state.language)
  const setLanguage = useLanguage((state) => state.setLanguage)
  const { t } = useTranslation()
  const api = bridge()
  const [plugins, setPlugins] = useState<ToolPlugin[]>([])
  const [trustedSources, setTrustedSources] = useState<string[]>([])
  const [pluginId, setPluginId] = useState('')
  const [sourceDirectory, setSourceDirectory] = useState('')
  const [toolName, setToolName] = useState('')
  const [toolQuery, setToolQuery] = useState('')
  const [args, setArgs] = useState('{}')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<unknown>(null)
  const [pluginQuery, setPluginQuery] = useState('')
  const [pluginStatus, setPluginStatus] = useState<PluginStatusFilter>('all')
  const [pluginSort, setPluginSort] = useState<PluginSort>('name')
  const [activities, setActivities] = useState<PluginActivity[]>(() => readPluginActivities())
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false)
  const [downloadingUpdate, setDownloadingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState({ received: 0, total: 0 })
  const checkUpdate = async () => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    setUpdateResult(null)
    setUpdateError('')
    try {
      const checked = await checkForUpdates()
      setUpdateResult(checked)
      if (checked.updateAvailable) setUpdateConfirmOpen(true)
    } catch (reason) { setUpdateError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setCheckingUpdate(false) }
  }
  useEffect(() => api?.onUpdateProgress?.(setUpdateProgress), [api])
  const startUpdate = async () => {
    if (!updateResult || !api?.updateDownload || downloadingUpdate) return
    const key = api.platform === 'darwin' ? 'darwin-arm64' : api.platform === 'win32' ? 'win32-x64' : null
    const selectedArtifact = key ? updateResult.artifacts[key] : undefined
    if (!selectedArtifact) { setUpdateError(t('当前平台暂无可用的更新安装包。')); return }
    setDownloadingUpdate(true)
    setUpdateError('')
    setUpdateProgress({ received: 0, total: selectedArtifact.size })
    try { await api.updateDownload(selectedArtifact) }
    catch (reason) {
      setUpdateError(reason instanceof Error ? reason.message : String(reason))
      setDownloadingUpdate(false)
    }
  }
  const plugin = useMemo(() => plugins.find((item) => item.id === pluginId) ?? plugins[0], [plugins, pluginId])
  const visiblePlugins = useMemo(() => filterAndSortPlugins(plugins, pluginQuery, pluginStatus, pluginSort), [plugins, pluginQuery, pluginStatus, pluginSort])
  const matchingTools = useMemo(() => plugin?.tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(toolQuery.trim().toLowerCase())) ?? [], [plugin, toolQuery])
  const selectedTool = matchingTools.find((tool) => tool.name === toolName) ?? matchingTools[0]
  const schemaProperties = Object.entries(selectedTool?.inputSchema?.properties ?? {}) as [string, Record<string, unknown>][]
  const requiredArguments = Array.isArray(selectedTool?.inputSchema?.required) ? selectedTool.inputSchema.required as string[] : []

  const loadPlugins = async () => {
    if (!api?.pluginList) return
    try {
      const loaded = await api.pluginList()
      setPlugins(loaded)
      if (api.pluginTrustList) setTrustedSources(await api.pluginTrustList())
      if (!loaded.some((item) => item.id === pluginId)) setPluginId(loaded[0]?.id ?? '')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  useEffect(() => { if (open && tab === 'plugins') void loadPlugins() }, [open, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setToolName(selectedTool?.name ?? '')
    setArgs(argumentTemplate(selectedTool))
    setResult(null)
    setError('')
  }, [plugin?.id, selectedTool?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (operation: () => Promise<unknown>, refresh = true, activity?: { action: PluginActivityAction; pluginName: string }) => {
    if (busy) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const value = await operation()
      if (!refresh) setResult(value)
      await loadPlugins()
      if (activity) setActivities(appendPluginActivity({ ...activity, ok: true, message: t('操作成功') }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      if (activity) setActivities(appendPluginActivity({ ...activity, ok: false, message }))
    } finally { setBusy(false) }
  }

  const importPlugin = () => {
    if (!sourceDirectory.trim() || !api?.pluginImport) return
    void run(() => api.pluginImport!(sourceDirectory.trim()), true, { action: 'import', pluginName: sourceDirectory.trim() })
  }
  const updateArgument = (name: string, value: unknown) => {
    try {
      const current = JSON.parse(args) as Record<string, unknown>
      setArgs(JSON.stringify({ ...current, [name]: value }, null, 2))
    } catch { setError(t('请先修正 JSON，再使用快捷表单')) }
  }
  const callTool = () => {
    if (!plugin || !selectedTool || !api?.pluginCall) return
    let parsed: unknown
    try { parsed = JSON.parse(args) } catch { setError(t('参数必须是有效的 JSON 对象')); return }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { setError(t('参数必须是有效的 JSON 对象')); return }
    const errors = validateToolArguments(selectedTool.inputSchema, parsed as Record<string, unknown>)
    if (errors.length) { setError(errors.map((item) => item.startsWith('缺少必填参数: ') ? `${t('缺少必填参数')}: ${item.slice(8)}` : t(item)).join('\n')); return }
    void run(() => api.pluginCall!(plugin.id, selectedTool.name, parsed), false)
  }

  return (
    <>
      <button className="btn theme-trigger" onClick={() => { setTab('appearance'); setOpen(true) }} aria-label={t('界面设置')}>
        <span className="theme-trigger-icon">⚙</span><span className="theme-trigger-name">{t('设置')}</span><span aria-hidden="true">›</span>
      </button>
      <Modal
        title={t('界面设置')}
        open={open}
        onClose={() => setOpen(false)}
        className="settings-modal"
      >
        <div className="settings-tabs" role="tablist" aria-label={t('界面设置')}>
          <button role="tab" aria-selected={tab === 'appearance'} className={`btn ${tab === 'appearance' ? 'btn-primary' : ''}`} onClick={() => setTab('appearance')}>{t('外观与语言')}</button>
          <button role="tab" aria-selected={tab === 'plugins'} className={`btn ${tab === 'plugins' ? 'btn-primary' : ''}`} onClick={() => setTab('plugins')}>{t('Tool 插件')}</button>
        </div>
        {tab === 'appearance' ? <>
          <section className="settings-section">
            <h4>{t('语言')}</h4>
            <div className="language-options" role="group" aria-label={t('选择界面语言')}>
              <button className={`btn ${language === 'zh' ? 'btn-primary' : ''}`} aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>简体中文</button>
              <button className={`btn ${language === 'en' ? 'btn-primary' : ''}`} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
            </div>
            <p className="field-hint">{t('语言即时生效并保存在本机。')}</p>
          </section>
          <section className="settings-section update-settings">
            <h4>{t('软件更新')}</h4>
            <p className="field-hint">{t('从软件下载站检查新版本；确认后下载并校验安装包，再启动系统安装流程。')}</p>
            <button className="btn" disabled={checkingUpdate} onClick={() => void checkUpdate()}>{checkingUpdate ? t('正在检查…') : t('检测版本更新')}</button>
            {updateResult && <div className="form-notice update-result" role="status">
              <span>{updateResult.updateAvailable ? `${t('发现新版本')}: v${updateResult.latestVersion}` : `${t('当前已是最新版本')} · v${updateResult.currentVersion}`}</span>
              {updateResult.updateAvailable && <a href={updateResult.releaseUrl} target="_blank" rel="noreferrer">{t('查看发布说明')}</a>}
            </div>}
            {updateError && <div className="settings-error" role="alert">{updateError === 'NO_RELEASE' ? t('开发者尚未发布 Release，请稍后再试。') : updateError.startsWith('UPDATE_HTTP_') ? `${t('版本服务暂时不可用')} (${updateError.slice(12)})` : t('检查更新失败，请检查网络后重试。')}</div>}
          </section>
          <section className="settings-section">
            <h4>{t('界面主题')}</h4>
            <div className="theme-options" role="group" aria-label={t('选择界面主题')}>
              {THEMES.map((item) => (
                <button key={item.id} className={`theme-option ${theme === item.id ? 'active' : ''}`} aria-pressed={theme === item.id} onClick={() => setTheme(item.id)}>
                  <div className="theme-preview" style={{ background: item.preview.bg }} aria-hidden="true">
                    <div className="theme-preview-side" style={{ background: item.preview.side }} />
                    <div className="theme-preview-main"><div className="theme-preview-line" style={{ background: item.preview.accent, width: '62%' }} /><div className="theme-preview-card" style={{ background: item.preview.card }} /></div>
                  </div>
                  <strong>{t(item.name)}{theme === item.id ? ' ✓' : ''}</strong><small>{t(item.description)}</small>
                </button>
              ))}
            </div>
            <p className="field-hint" style={{ marginTop: 14 }}>{t('主题即时生效并保存在本机，下次启动自动恢复。')}</p>
          </section>
        </> : <section className="settings-section tools-settings">
          {!api?.pluginList ? <div className="empty">{t('Tool 插件仅在 MCPWindow 桌面版中可用。')}</div> : <>
            <div className="field">
              <label htmlFor="plugin-directory">{t('第三方插件目录')}</label>
              <div className="tools-server-row">
                <input id="plugin-directory" value={sourceDirectory} onChange={(event) => setSourceDirectory(event.target.value)} placeholder={t('包含 plugin.json 和 JS 入口的目录')} />
                {api.selectDirectory && <button className="btn" disabled={busy} onClick={() => void api.selectDirectory!().then((directory) => { if (directory) setSourceDirectory(directory) })}>{t('选择目录')}</button>}
                <button className="btn btn-primary" disabled={!sourceDirectory.trim() || busy} onClick={importPlugin}>{t('导入插件')}</button>
              </div>
              <p className="field-hint">{t('插件导入后默认停用；启用即认可其声明权限。插件以隔离环境运行，无 Node.js 与网络访问能力。')}</p>
              <p className="field-hint">{t('签名是 SHA-256 完整性摘要，并非发布者身份认证。未签名插件需自行核验来源；校验失败的插件会被拒绝。')}</p>
            </div>
            <details className="plugin-trust-settings">
              <summary>{t('受信任来源管理')}（{trustedSources.length}）</summary>
              <p className="field-hint">{t('受信任目录仅用于来源标识，不绕过插件权限和完整性检查。')}</p>
              <button className="btn" disabled={!sourceDirectory.trim() || busy} onClick={() => void run(() => api.pluginTrustAdd!(sourceDirectory.trim()))}>{t('信任当前目录')}</button>
              {trustedSources.map((source) => <div className="trusted-source" key={source}><code title={source}>{source}</code><button className="btn btn-danger" disabled={busy} onClick={() => void run(() => api.pluginTrustRemove!(source))}>{t('移除')}</button></div>)}
            </details>
            {error && <div role="alert" className="settings-error">{error}</div>}
            <div className="plugin-catalog-toolbar">
              <input aria-label={t('搜索已安装插件')} value={pluginQuery} onChange={(event) => setPluginQuery(event.target.value)} placeholder={t('搜索名称、描述或发布者')} />
              <select aria-label={t('插件状态筛选')} value={pluginStatus} onChange={(event) => setPluginStatus(event.target.value as PluginStatusFilter)}>
                <option value="all">{t('全部状态')}</option><option value="enabled">{t('仅已启用')}</option><option value="disabled">{t('仅已停用')}</option>
              </select>
              <select aria-label={t('插件排序方式')} value={pluginSort} onChange={(event) => setPluginSort(event.target.value as PluginSort)}>
                <option value="name">{t('按名称')}</option><option value="version">{t('按版本')}</option><option value="publisher">{t('按发布者')}</option>
              </select>
            </div>
            {plugins.length === 0 ? <div className="empty">{t('尚未安装 Tool 插件。')}</div> : <>
              {visiblePlugins.length === 0 && <div className="empty">{t('没有符合筛选条件的插件。')}</div>}
              <div className="plugin-manager" aria-label={t('已安装插件')}>
                {visiblePlugins.map((item) => <article key={item.id} className={`plugin-summary ${plugin?.id === item.id ? 'selected' : ''}`}>
                  <button className="plugin-select" aria-label={`${t('管理插件')}：${item.name}`} aria-pressed={plugin?.id === item.id} onClick={() => setPluginId(item.id)}>
                    <span><strong>{item.name}</strong><small>{item.id} · v{item.version} · {item.tools.length} {t('个工具')}</small></span>
                    <span className={`badge ${item.enabled ? 'badge-green' : ''}`}>{item.enabled ? t('已启用') : t('已停用')}</span>
                  </button>
                  <p>{item.description}</p>
                  <div className="plugin-trust-meta">
                    <span className={`badge ${item.signatureStatus === 'valid' ? 'badge-green' : ''}`}>{item.signatureStatus === 'valid' ? t('完整性校验通过') : item.signatureStatus === 'invalid' ? t('完整性校验失败') : t('未签名')}</span>
                    <span className={`badge ${item.trustedSource ? 'badge-green' : ''}`}>{item.trustedSource ? t('来源受信任') : t('来源未信任')}</span>
                    {item.publisher && <small>{t('发布者')}：{item.publisher}</small>}
                  </div>
                  <div className="plugin-permissions">{item.permissions.map((permission) => <code key={permission}>{permission}</code>)}</div>
                  <div className="dialog-actions">
                    <button className="btn" disabled={busy} onClick={() => void run(() => api.pluginCheckUpdate!(item.id), false, { action: 'check-update', pluginName: item.name })}>{t('检查更新')}</button>
                    <button className="btn" disabled={busy || item.signatureStatus === 'invalid'} onClick={() => void run(() => api.pluginSetEnabled!(item.id, !item.enabled), true, { action: item.enabled ? 'disable' : 'enable', pluginName: item.name })}>{item.enabled ? t('停用插件') : t('启用插件')}</button>
                    <button className="btn btn-danger" disabled={busy} onClick={() => { if (window.confirm(t('确定删除此插件？'))) void run(() => api.pluginRemove!(item.id), true, { action: 'remove', pluginName: item.name }) }}>{t('删除插件')}</button>
                  </div>
                </article>)}
              </div>
              {plugin && <>
                <h4 className="plugin-tools-heading">{plugin.name} · {t('插件工具')}</h4>
                <div className="field">
                  <label htmlFor="plugin-tool-search">{t('搜索插件工具')}</label>
                  <input id="plugin-tool-search" value={toolQuery} onChange={(event) => setToolQuery(event.target.value)} placeholder={t('按名称或描述搜索')} />
                </div>
                <div className="field">
                  <label htmlFor="plugin-tool">{t('插件工具')}</label>
                  <select id="plugin-tool" value={selectedTool?.name ?? ''} onChange={(event) => setToolName(event.target.value)} disabled={matchingTools.length === 0}>
                    {matchingTools.length === 0 && <option value="">{t('无匹配工具')}</option>}
                    {matchingTools.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
                  </select>
                  {selectedTool?.description && <p className="field-hint">{selectedTool.description}</p>}
                </div>
                {schemaProperties.length > 0 && <fieldset className="field fieldset tool-quick-form"><legend>{t('快捷参数表单')}</legend>{schemaProperties.map(([name, field]) => {
                  const value = (() => { try { return (JSON.parse(args) as Record<string, unknown>)[name] } catch { return undefined } })()
                  const label = `${name}${requiredArguments.includes(name) ? ' *' : ''}`
                  const enumValues = Array.isArray(field.enum) ? field.enum : null
                  if (enumValues) return <label key={name}>{label}<select aria-label={label} value={String(value ?? '')} onChange={(event) => updateArgument(name, enumValues.find((item) => String(item) === event.target.value))}>{enumValues.map((item) => <option key={String(item)} value={String(item)}>{String(item)}</option>)}</select></label>
                  if (field.type === 'boolean') return <label key={name} className="scope-check"><input aria-label={label} type="checkbox" checked={Boolean(value)} onChange={(event) => updateArgument(name, event.target.checked)} />{label}</label>
                  if (['string', 'number', 'integer'].includes(String(field.type))) return <label key={name}>{label}<input aria-label={label} type={field.type === 'string' ? 'text' : 'number'} min={field.minimum as number | undefined} max={field.maximum as number | undefined} value={String(value ?? '')} onChange={(event) => updateArgument(name, field.type === 'string' ? event.target.value : event.target.value === '' ? '' : Number(event.target.value))} /></label>
                  return null
                })}</fieldset>}
                <label htmlFor="tool-arguments">{t('调用参数（JSON 对象）')}</label>
                <textarea id="tool-arguments" className="tool-arguments" value={args} onChange={(event) => setArgs(event.target.value)} spellCheck={false} />
                <button className="btn btn-primary" disabled={!plugin.enabled || !selectedTool || busy} onClick={callTool}>{busy ? t('执行中…') : t('调用工具')}</button>
              </>}
            </>}
            {result !== null && <div className="tool-result"><strong>{t('调用结果')}</strong><pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre></div>}
            <details className="plugin-activity-center">
              <summary>{t('插件操作记录')}（{activities.length}）</summary>
              {activities.length > 0 && <button className="btn btn-sm" onClick={() => { localStorage.removeItem(PLUGIN_ACTIVITY_KEY); setActivities([]) }}>{t('清空记录')}</button>}
              {activities.length === 0 ? <div className="empty">{t('暂无插件操作记录。')}</div> : <div className="plugin-activity-list">{activities.map((activity) => {
                const actionLabels: Record<PluginActivityAction, string> = { import: t('导入'), enable: t('启用'), disable: t('停用'), remove: t('删除'), 'check-update': t('检查更新') }
                return <article key={activity.id} className={activity.ok ? 'activity-success' : 'activity-failed'}>
                  <div><strong>{actionLabels[activity.action]} · {activity.pluginName}</strong><time>{new Date(activity.ts).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')}</time></div>
                  <p>{activity.message}</p>
                </article>
              })}</div>}
            </details>
          </>}
        </section>}
      </Modal>
      <Modal
        title={t('发现新版本')}
        open={updateConfirmOpen && !!updateResult}
        onClose={() => { if (!downloadingUpdate) setUpdateConfirmOpen(false) }}
        footer={<>
          <button className="btn" disabled={downloadingUpdate} onClick={() => setUpdateConfirmOpen(false)}>{t('暂不更新')}</button>
          <button className="btn btn-primary" disabled={downloadingUpdate || !api?.updateDownload} onClick={() => void startUpdate()}>{downloadingUpdate ? t('正在下载更新…') : t('立即更新')}</button>
        </>}
      >
        <p>{language === 'en' ? `MCPWindow v${updateResult?.latestVersion} is available. Download the verified installer and start the system installation now?` : `检测到 MCPWindow v${updateResult?.latestVersion}。是否下载经过校验的安装包并启动系统安装流程？`}</p>
        <p className="field-hint">{t('下载完成后将启动系统安装器并退出 MCPWindow；macOS 会打开 DMG，Windows 会启动安装程序。')}</p>
        {downloadingUpdate && <div role="status">
          <progress max={updateProgress.total || updateResult?.artifacts[api?.platform === 'darwin' ? 'darwin-arm64' : 'win32-x64']?.size || 1} value={updateProgress.received} />
          <p>{t('已下载')} {(updateProgress.received / 1024 / 1024).toFixed(1)} / {(updateProgress.total / 1024 / 1024).toFixed(1)} MB</p>
        </div>}
        {updateError && <div className="settings-error" role="alert">{updateError}</div>}
      </Modal>
    </>
  )
}
