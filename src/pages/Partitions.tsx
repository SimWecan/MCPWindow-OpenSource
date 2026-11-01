import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import { useStore } from '../store/useStore'
import type { PartitionKind } from '../types'
import { fmtTime } from '../utils/stats'
import { canManage, manageRequest, syncManagedServer } from '../utils/management'

const COLORS = ['#4f8dff', '#22c993', '#f6a04d', '#a78bfa', '#f4586a', '#38bdf8', '#eab308', '#8a93a6']

export const KIND_META: Record<PartitionKind, { label: string; color: string }> = {
  business: { label: '业务分区', color: '#4f8dff' },
  project: { label: '工程分区', color: '#a78bfa' },
}

interface FormState {
  name: string
  description: string
  color: string
  kind: PartitionKind
  rootPath: string
}

export default function Partitions() {
  const partitions = useStore((s) => s.partitions)
  const servers = useStore((s) => s.servers)
  const credentials = useStore((s) => s.credentials)
  const { addPartition, updatePartition, archivePartition, deletePartition } = useStore()
  const managers = servers.filter((s) => !s.archived && canManage(s))

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [kindFilter, setKindFilter] = useState<'all' | PartitionKind>('all')
  const [form, setForm] = useState<FormState>({ name: '', description: '', color: COLORS[0], kind: 'business', rootPath: '' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [managerId, setManagerId] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const manager = managers.find((s) => s.id === managerId)
  useEffect(() => { setPage(1) }, [query, kindFilter, managerId])

  const serverCount = (pid: string) => servers.filter((s) => s.partitionId === pid).length
  const credCount = (pid: string) => credentials.filter((c) => c.scopes.includes(pid)).length

  const openCreate = (kind: PartitionKind = 'business') => {
    setEditing(null)
    setForm({ name: '', description: '', color: COLORS[partitions.length % COLORS.length], kind, rootPath: '' })
    setModalOpen(true)
  }
  const openEdit = (id: string) => {
    const p = partitions.find((x) => x.id === id)
    if (!p) return
    setEditing(id)
    setForm({ name: p.name, description: p.description, color: p.color, kind: p.kind, rootPath: p.rootPath ?? '' })
    setModalOpen(true)
  }
  const save = async () => {
    if (!form.name.trim() || (manager && !editing && !form.rootPath.trim())) return
    setBusy(true)
    setMessage(null)
    try {
      if (editing) {
        updatePartition(editing, { name: form.name, description: form.description, color: form.color, kind: form.kind })
      } else if (manager) {
        await manageRequest(manager, '/partitions', 'POST', { name: form.name.trim(), path: form.rootPath.trim() })
        await syncManagedServer(manager)
        setMessage(`服务器 ${manager.name} 已确认创建分区 ${form.name}`)
      } else {
        addPartition({ name: form.name, description: form.description, color: form.color, kind: form.kind })
      }
      setModalOpen(false)
    } catch (error) {
      setMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    const partition = partitions.find((p) => p.id === id)
    setConfirmDelete(null)
    if (!partition) return
    setBusy(true)
    try {
      if (manager && partition.managedBy === manager.id) {
        await manageRequest(manager, `/partitions/${encodeURIComponent(partition.remoteName ?? partition.name)}`, 'DELETE')
        await syncManagedServer(manager)
        setMessage(`服务器 ${manager.name} 已确认删除分区 ${partition.name}`)
      } else {
        deletePartition(id)
      }
    } catch (error) {
      setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const list = [...partitions]
    .filter((p) => manager ? p.managedBy === manager.id : !p.managedBy)
    .filter((p) => kindFilter === 'all' || p.kind === kindFilter)
    .filter((p) => `${p.name} ${p.description} ${p.rootPath ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.createdAt - b.createdAt)
  const pageCount = Math.max(1, Math.ceil(list.length / 9))
  const pageList = list.slice((Math.min(page, pageCount) - 1) * 9, Math.min(page, pageCount) * 9)

  const TABS: { key: 'all' | PartitionKind; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'business', label: '业务分区' },
    { key: 'project', label: '工程分区' },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">分区管理</h2>
          <div className="page-sub">业务维度（按业务域）+ 工程维度（按工程 / 仓库）双视角划分，凭证按分区授权访问</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {managers.length > 0 && <label className="inline-label">管理目标<select aria-label="分区管理目标" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">本地配置 · 分区</option>
            {managers.map((s) => <option key={s.id} value={s.id}>远程服务器 · {s.name}</option>)}
          </select></label>}
          <button className="btn btn-primary" onClick={() => openCreate('business')}>+ 新建分区</button>
        </div>
      </div>

      {message && <div className="card" style={{ marginBottom: 12, padding: 12 }}>{message}<button className="btn btn-sm" style={{ float: 'right' }} onClick={() => setMessage(null)}>关闭</button></div>}

      <div className="toolbar">
        <input aria-label="搜索分区" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、描述或路径" />
        {TABS.map((t) => (
          <button key={t.key} className={`btn btn-sm ${kindFilter === t.key ? 'btn-primary' : ''}`} onClick={() => setKindFilter(t.key)}>{t.label}</button>
        ))}
        <div className="spacer" />
        <span style={{ color: 'var(--text-3)', fontSize: 12.5 }}>共 {list.length} 个分区</span>
      </div>

      <div className="grid grid-3">
        {pageList.map((p) => (
          <div key={p.id} className="card partition-card" style={{ opacity: p.archived ? 0.55 : 1, ['--pc' as string]: p.color }}>
            <div className="partition-head">
              <span className="partition-name">
                <span className="dot" style={{ background: p.color, marginRight: 8 }} />
                {p.name}
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <span className="badge" style={{ color: KIND_META[p.kind].color, borderColor: KIND_META[p.kind].color }}>{KIND_META[p.kind].label}</span>
                {p.archived && <span className="badge">已归档</span>}
              </span>
            </div>
            <div className="partition-desc">{p.description || '—'}</div>
            <div className="partition-meta">
              <span>服务器 {serverCount(p.id)}</span>
              <span>关联凭证 {credCount(p.id)}</span>
              <span>创建 {fmtTime(p.createdAt).slice(0, 10)}</span>
            </div>
            <div className="partition-actions">
              <button className="btn btn-sm" onClick={() => openEdit(p.id)}>编辑</button>
              {!p.managedBy && <button className="btn btn-sm" onClick={() => archivePartition(p.id, !p.archived)}>
                {p.archived ? '恢复' : '归档'}
              </button>}
              <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirmDelete(p.id)}>删除</button>
            </div>
          </div>
        ))}
      </div>
      {list.length === 0 && <div className="empty">没有符合搜索条件的分区</div>}
      {pageCount > 1 && <div className="pagination"><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {Math.min(page, pageCount)} / {pageCount} 页</span><button className="btn btn-sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button></div>}

      <Modal
        title={editing && manager ? '编辑分区本地展示' : editing ? '编辑分区' : '新建分区'}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" onClick={save} disabled={busy || !form.name.trim() || Boolean(manager && !editing && !form.rootPath.trim())}>{busy ? '提交中…' : '保存'}</button>
          </>
        }
      >
        {manager && editing && <div className="form-notice">此处仅修改 MCPWindow 中的描述、颜色和分类，不会变更远程服务器配置。</div>}
        <div className="field">
          <label htmlFor="partition-name">分区名称{manager && '（小写字母、数字或连字符）'}</label>
          <input id="partition-name" value={form.name} disabled={Boolean(manager && editing)} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={manager ? '例如：project-api' : '例如：开发工具'} />
        </div>
        {manager && !editing && <div className="field">
          <label htmlFor="partition-root">服务器上的分区绝对路径</label>
          <input id="partition-root" value={form.rootPath} onChange={(e) => setForm({ ...form, rootPath: e.target.value })} placeholder="E:\\MCPServer\\repo\\project 或 /srv/project" />
        </div>}
        <div className="field">
          <label id="partition-kind-label">分区维度</label>
          <div role="group" aria-labelledby="partition-kind-label" style={{ display: 'flex', gap: 8 }}>
            {(Object.keys(KIND_META) as PartitionKind[]).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={form.kind === k}
                className={`btn btn-sm ${form.kind === k ? 'btn-primary' : ''}`}
                onClick={() => setForm({ ...form, kind: k })}
              >
                {KIND_META[k].label}
              </button>
            ))}
          </div>
          <div className="field-hint">
            {form.kind === 'business' ? '按业务域划分，如“开发工具 / 数据服务”' : '按工程 / 仓库划分，如“NFCTakeFriends 枢纽”'}
          </div>
        </div>
        <div className="field">
          <label htmlFor="partition-description">描述</label>
          <input id="partition-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="分区的用途说明" />
        </div>
        <div className="field">
          <label id="partition-color-label">标识色</label>
          <div role="group" aria-labelledby="partition-color-label" style={{ display: 'flex', gap: 8 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`标识色 ${c}`}
                aria-pressed={form.color === c}
                onClick={() => setForm({ ...form, color: c })}
                style={{
                  width: 24, height: 24, padding: 0, border: 0, borderRadius: 6, background: c, cursor: 'pointer',
                  outline: form.color === c ? '2px solid #fff' : 'none', outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        title="删除分区"
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <button className="btn" onClick={() => setConfirmDelete(null)}>取消</button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => { if (confirmDelete) void remove(confirmDelete) }}
            >
              确认删除
            </button>
          </>
        }
      >
        <p style={{ color: 'var(--text-2)', lineHeight: 1.7, margin: 0 }}>
          删除后该分区下的服务器将被自动归档（不会丢失），关联凭证的该分区授权将被移除。此操作不可撤销。
        </p>
      </Modal>
    </div>
  )
}
