import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import { useStore } from '../store/useStore'
import { fmtTime } from '../utils/stats'
import { canManage, manageRequest, syncManagedServer } from '../utils/management'
import { buildManagedCredentialPayload, generateLocalKey } from '../utils/credential'
import { validateHeaderName, type AccessAuthType } from '../utils/accessCredential'

const emptyForm: FormState = { name: '', key: '', scopes: [], rateLimitPerMin: 120, expiresDays: 0, enabled: true, role: 'read', authType: 'bearer', basicUsername: '', apiHeader: 'X-API-Key' }
const AUTH_LABELS: Record<AccessAuthType, string> = { bearer: 'Bearer Token', basic: 'Basic Auth', 'api-key': 'API Key' }

interface FormState {
  name: string
  key: string
  authType: AccessAuthType
  basicUsername: string
  apiHeader: string
  scopes: string[]
  rateLimitPerMin: number
  expiresDays: number // 0 = 永不过期
  enabled: boolean
  role: 'read' | 'write' | 'admin'
}

export default function Credentials() {
  const credentials = useStore((s) => s.credentials)
  const partitions = useStore((s) => s.partitions)
  const servers = useStore((s) => s.servers)
  const { addCredential, updateCredential, deleteCredential } = useStore()
  const managers = servers.filter((s) => !s.archived && canManage(s))

  const [modalOpen, setModalOpen] = useState(false)
  const [issuedKey, setIssuedKey] = useState<string | null>(null)
  const [issuedAuth, setIssuedAuth] = useState<Pick<FormState, 'authType' | 'basicUsername' | 'apiHeader'>>(emptyForm)
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [expiryTouched, setExpiryTouched] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [managerId, setManagerId] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const manager = managers.find((s) => s.id === managerId)
  useEffect(() => { setPage(1) }, [query, statusFilter, managerId])
  const editingCredential = editing ? credentials.find((c) => c.id === editing) : undefined
  const preserveGlobalRole = Boolean(manager && editingCredential?.role)

  const activeParts = partitions.filter((p) => !p.archived && (manager ? p.managedBy === manager.id : !p.managedBy))
  const visibleCredentials = credentials.filter((c) => manager ? c.managedBy === manager.id : !c.managedBy)
    .filter((c) => statusFilter === 'all' || (statusFilter === 'enabled' ? c.enabled : !c.enabled))
    .filter((c) => `${c.name} ${c.keyPrefix}`.toLowerCase().includes(query.trim().toLowerCase()))
  const pageCount = Math.max(1, Math.ceil(visibleCredentials.length / 10))
  const pageCredentials = visibleCredentials.slice((Math.min(page, pageCount) - 1) * 10, Math.min(page, pageCount) * 10)
  const partMap = new Map(partitions.map((p) => [p.id, p]))

  const genKey = () => setForm((f) => ({ ...f, key: generateLocalKey() }))

  const openCreate = () => {
    setEditing(null)
    setExpiryTouched(false)
    setForm({ ...emptyForm })
    setModalOpen(true)
  }
  const openEdit = (id: string) => {
    const c = credentials.find((x) => x.id === id)
    if (!c) return
    setEditing(id)
    setExpiryTouched(false)
    setForm({
      name: c.name, key: '', scopes: c.scopes, rateLimitPerMin: c.rateLimitPerMin,
      expiresDays: c.expiresAt ? Math.max(1, Math.ceil((c.expiresAt - Date.now()) / 86400_000)) : 0,
      enabled: c.enabled, role: c.role ?? 'read', authType: c.authType ?? 'bearer',
      basicUsername: c.basicUsername ?? '', apiHeader: c.apiHeader ?? 'X-API-Key',
    })
    setModalOpen(true)
  }
  const nextExpiry = () => form.expiresDays > 0 ? Date.now() + form.expiresDays * 86400_000 : null
  const payload = () => buildManagedCredentialPayload(
    { ...form, name: form.name.trim() },
    (id) => partMap.get(id)?.remoteName ?? partMap.get(id)?.name,
    { editing: Boolean(editing), expiryTouched, preserveGlobalRole },
  )
  const save = async () => {
    if (busy || !form.name.trim() || form.scopes.length === 0) return
    if (!manager && form.authType === 'basic' && !form.basicUsername.trim()) { setMessage('操作失败：使用 Basic Auth 时必须填写用户名'); return }
    if (!manager && form.authType === 'api-key' && !validateHeaderName(form.apiHeader)) { setMessage('操作失败：API Key 请求头名称无效'); return }
    setBusy(true)
    setMessage(null)
    try {
      if (editing) {
        const credential = credentials.find((c) => c.id === editing)
        if (manager && credential?.managedBy === manager.id) {
          await manageRequest(manager, `/credentials/${encodeURIComponent(credential.keyPrefix)}`, 'PATCH', payload())
          await syncManagedServer(manager)
          setMessage(`服务器 ${manager.name} 已确认更新凭证 ${form.name.trim()}`)
        } else {
          updateCredential(editing, {
            name: form.name.trim(), scopes: form.scopes,
            rateLimitPerMin: form.rateLimitPerMin, enabled: form.enabled,
            ...(expiryTouched ? { expiresAt: nextExpiry() } : {}),
          })
        }
        setModalOpen(false)
      } else if (manager) {
        const result = await manageRequest<{ key: string }>(manager, '/credentials', 'POST', payload())
        await syncManagedServer(manager)
        setModalOpen(false)
        setCopyError(null)
        setIssuedAuth({ authType: 'bearer', basicUsername: '', apiHeader: 'X-API-Key' })
        setIssuedKey(result.key)
        setMessage(`服务器 ${manager.name} 已确认发放 Bearer Token 凭证 ${form.name.trim()}`)
      } else {
        const rawKey = form.key || generateLocalKey()
        addCredential({
          name: form.name.trim(), scopes: form.scopes, rateLimitPerMin: form.rateLimitPerMin,
          enabled: form.enabled, expiresAt: nextExpiry(), authType: form.authType,
          basicUsername: form.authType === 'basic' ? form.basicUsername.trim() : undefined,
          apiHeader: form.authType === 'api-key' ? form.apiHeader.trim() : undefined,
        }, rawKey)
        setModalOpen(false)
        setCopyError(null)
        setIssuedAuth({ authType: form.authType, basicUsername: form.basicUsername.trim(), apiHeader: form.apiHeader.trim() })
        setIssuedKey(rawKey)
      }
    } catch (error) {
      setMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const toggleCredential = async (id: string) => {
    const credential = credentials.find((c) => c.id === id)
    if (!credential || actionBusyId) return
    setActionBusyId(id)
    try {
      if (manager && credential.managedBy === manager.id) {
        await manageRequest(manager, `/credentials/${encodeURIComponent(credential.keyPrefix)}`, 'PATCH', { enabled: !credential.enabled })
        await syncManagedServer(manager)
      } else updateCredential(id, { enabled: !credential.enabled })
      setMessage(`已${credential.enabled ? '停用' : '启用'}凭证 ${credential.name}`)
    } catch (error) { setMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setActionBusyId(null) }
  }

  const remove = async (id: string) => {
    const credential = credentials.find((c) => c.id === id)
    setConfirmDelete(null)
    if (!credential || actionBusyId) return
    setActionBusyId(id)
    try {
      if (manager && credential.managedBy === manager.id) {
        await manageRequest(manager, `/credentials/${encodeURIComponent(credential.keyPrefix)}`, 'DELETE')
        await syncManagedServer(manager)
        setMessage(`服务器 ${manager.name} 已确认吊销凭证 ${credential.name}`)
      } else {
        deleteCredential(id)
        setMessage(`已删除本地凭证 ${credential.name}`)
      }
    } catch (error) { setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setActionBusyId(null) }
  }

  const copyIssuedKey = async () => {
    if (!issuedKey || copying) return
    if (!navigator.clipboard?.writeText) {
      setCopyError('当前环境不支持自动复制，请手动选中上方凭证复制。')
      return
    }
    setCopying(true)
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(issuedKey)
      setIssuedKey(null)
    } catch {
      setCopyError('复制失败，请手动选中上方凭证复制；窗口未关闭，凭证仍可查看。')
    } finally {
      setCopying(false)
    }
  }

  const toggleScope = (pid: string) =>
    setForm((f) => ({ ...f, scopes: f.scopes.includes(pid) ? f.scopes.filter((x) => x !== pid) : [...f.scopes, pid] }))

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">凭证发放</h2>
          <div className="page-sub">向客户端发放访问凭证，并可视化配置其可访问的分区范围</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {managers.length > 0 && <label className="inline-label">管理目标<select aria-label="凭证管理目标" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">本地配置 · 凭证</option>
            {managers.map((s) => <option key={s.id} value={s.id}>远程服务器 · {s.name}</option>)}
          </select></label>}
          <button className="btn btn-primary" onClick={openCreate}>+ 发放凭证</button>
        </div>
      </div>

      {message && <div className="card" style={{ marginBottom: 12, padding: 12 }}>{message}<button className="btn btn-sm" style={{ float: 'right' }} onClick={() => setMessage(null)}>关闭</button></div>}

      <div className="toolbar">
        <input aria-label="搜索凭证" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或标识" />
        <select aria-label="按状态筛选凭证" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">全部状态</option><option value="enabled">仅启用</option><option value="disabled">仅停用</option></select>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>凭证标识</th>
              <th>可访问分区</th>
              <th>限流 (次/分)</th>
              <th>状态</th>
              <th>最近使用</th>
              <th>到期时间</th>
              <th style={{ width: 190 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageCredentials.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}<div><span className="badge">{AUTH_LABELS[c.authType ?? 'bearer']}</span></div></td>
                <td className="mono">{c.keyPrefix}…</td>
                <td>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {c.scopes.map((pid) => {
                      const p = partMap.get(pid)
                      return (
                        <span key={pid} className="badge">
                          <span className="dot" style={{ background: p?.color ?? '#666' }} />
                          {p?.name ?? '已删除分区'}
                        </span>
                      )
                    })}
                    {c.scopes.length === 0 && <span style={{ color: 'var(--text-3)' }}>无授权</span>}
                  </div>
                </td>
                <td>{c.rateLimitPerMin}</td>
                <td>
                  <span className="badge">
                    <span className="dot" style={{ background: c.enabled ? '#22c993' : '#8a93a6' }} />
                    {c.enabled ? '启用' : '停用'}
                  </span>
                </td>
                <td style={{ color: 'var(--text-2)' }}>{c.lastUsedAt ? fmtTime(c.lastUsedAt) : '从未使用'}</td>
                <td style={{ color: c.expiresAt && c.expiresAt < Date.now() ? 'var(--red)' : 'var(--text-2)' }}>
                  {c.expiresAt ? fmtTime(c.expiresAt).slice(0, 10) : '永不过期'}
                </td>
                <td>
                  <button className="btn btn-sm" disabled={actionBusyId !== null} onClick={() => openEdit(c.id)}>配置</button>{' '}
                  <button className="btn btn-sm" disabled={actionBusyId !== null} onClick={() => void toggleCredential(c.id)}>
                    {actionBusyId === c.id ? '提交中…' : c.enabled ? '停用' : '启用'}
                  </button>{' '}
                  <button className="btn btn-sm btn-danger" disabled={actionBusyId !== null} onClick={() => setConfirmDelete(c.id)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleCredentials.length === 0 && <div className="empty">{query || statusFilter !== 'all' ? '没有符合搜索条件的凭证' : '暂无凭证'}</div>}
      </div>
      {pageCount > 1 && <div className="pagination"><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {Math.min(page, pageCount)} / {pageCount} 页</span><button className="btn btn-sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button></div>}

      <Modal
        title={editing ? '配置凭证权限' : '发放新凭证'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !form.name.trim() || form.scopes.length === 0}>
              {busy ? '提交中…' : editing ? '保存' : '发放'}
            </button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="credential-name">凭证名称</label>
          <input id="credential-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：Kimi 桌面端" />
        </div>
        <div className="field">
          <label htmlFor="credential-auth-type">第三方认证方式</label>
          <select id="credential-auth-type" value={manager ? 'bearer' : form.authType} disabled={Boolean(editing || manager)} onChange={(event) => setForm({ ...form, authType: event.target.value as AccessAuthType })}>
            <option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option><option value="api-key">API Key</option>
          </select>
          {manager && <div className="field-hint">远程管理接口当前按 Bearer Token 发放，认证类型以服务器响应为准。</div>}
        </div>
        {!editing && !manager && form.authType === 'basic' && <div className="field"><label htmlFor="credential-basic-username">Basic Auth 用户名</label><input id="credential-basic-username" value={form.basicUsername} onChange={(event) => setForm({ ...form, basicUsername: event.target.value })} autoComplete="off" /></div>}
        {!editing && !manager && form.authType === 'api-key' && <div className="field"><label htmlFor="credential-api-header">API Key 请求头</label><input id="credential-api-header" value={form.apiHeader} onChange={(event) => setForm({ ...form, apiHeader: event.target.value })} placeholder="X-API-Key" /></div>}
        {!editing && !manager && (
          <div className="field">
            <label htmlFor="credential-key">{form.authType === 'basic' ? 'Basic Auth 密码（留空自动生成）' : '凭证 Key（留空自动生成）'}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="credential-key" className="mono" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="mcpsk_live_..." />
              <button className="btn" onClick={genKey}>生成</button>
            </div>
          </div>
        )}
        {manager && <div className="field">
          <label htmlFor="credential-role">{preserveGlobalRole ? '全局角色（保持不变）' : '分区权限'}</label>
          <select id="credential-role" value={form.role} disabled={preserveGlobalRole} onChange={(e) => setForm({ ...form, role: e.target.value as FormState['role'] })}>
            <option value="read">只读（read）</option>
            <option value="write">读写（write）</option>
            {preserveGlobalRole && form.role === 'admin' && <option value="admin">全局管理（admin）</option>}
          </select>
        </div>}
        <fieldset className="field fieldset">
          <legend>{preserveGlobalRole ? '可访问分区（全局角色自动覆盖全部，保持不变）' : '可访问分区（凭证发放的核心授权范围）'}</legend>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
            {activeParts.map((p) => (
              <label key={p.id} className="scope-check">
                <input type="checkbox" checked={form.scopes.includes(p.id)} disabled={preserveGlobalRole} onChange={() => toggleScope(p.id)} />
                <span className="dot" style={{ background: p.color }} />
                {p.name}
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{p.description}</span>
              </label>
            ))}
            {activeParts.length === 0 && <div className="empty">暂无可用分区</div>}
          </div>
        </fieldset>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="credential-rate-limit">限流（次/分钟）</label>
            <input id="credential-rate-limit" type="number" min={1} step={1} value={form.rateLimitPerMin} onChange={(e) => setForm({ ...form, rateLimitPerMin: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </div>
          <div className="field">
            <label htmlFor="credential-expiry">有效期（天，0 = 永不过期）</label>
            <input id="credential-expiry" type="number" min={0} step={1} value={form.expiresDays} onChange={(e) => { setExpiryTouched(true); setForm({ ...form, expiresDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) }) }} />
            {editing && !expiryTouched && <div className="field-hint">未修改时保留原到期时间</div>}
          </div>
        </div>
      </Modal>

      <Modal
        title="凭证已发放"
        open={!!issuedKey}
        onClose={() => { setIssuedKey(null); setCopyError(null) }}
        footer={<button className="btn btn-primary" disabled={copying} onClick={() => void copyIssuedKey()}>{copying ? '复制中…' : '复制并关闭'}</button>}
      >
        <p style={{ color: 'var(--text-2)', lineHeight: 1.7, marginTop: 0 }}>
          请立即复制保存，该凭证完整 Key 仅此一次展示：
        </p>
        <div className="server-cmd mono" style={{ userSelect: 'all' }}>{issuedKey}</div>
        <p className="field-hint">第三方使用方式：{issuedAuth.authType === 'bearer' ? '请求头 Authorization: Bearer <上方凭证>' : issuedAuth.authType === 'basic' ? `用户名 ${issuedAuth.basicUsername}，密码为上方凭证；请求头 Authorization: Basic Base64(用户名:密码)` : `请求头 ${issuedAuth.apiHeader}: <上方凭证>`}</p>
        {copyError && <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{copyError}</div>}
      </Modal>

      <Modal
        title="删除凭证"
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDelete(null)}>取消</button>
            <button className="btn btn-danger" onClick={() => { if (confirmDelete) void remove(confirmDelete) }}>确认删除</button>
          </>
        }
      >
        <p style={{ color: 'var(--text-2)', lineHeight: 1.7, margin: 0 }}>
          使用该凭证的客户端将立即失去访问能力，不可恢复。
        </p>
      </Modal>
    </div>
  )
}
