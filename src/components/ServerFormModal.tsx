import { useEffect, useState } from 'react'
import Modal from './Modal'
import { TRANSPORTS, useStore } from '../store/useStore'
import type { MCPServer, Transport } from '../types'
import { decodeBasicCredential, getBearerCredential, validateHeaderName, withAccessCredential, type AccessAuthType } from '../utils/accessCredential'
import { validateServerConfig } from '../utils/serverConfig'
import { refreshServerStatuses } from '../utils/status'
import { probeServer } from '../utils/probe'
import { syncManagedServer } from '../utils/management'

export interface ServerFormState {
  name: string
  partitionId: string
  description: string
  command: string
  args: string
  version: string
  transport: Transport
  accessKey: string
  accessType: AccessAuthType
  accessUsername: string
  apiHeader: string
  managementUrl: string
  managementKey: string
  tagsText: string
}

interface Props {
  open: boolean
  initial: MCPServer | null // null = 新建
  clone?: boolean
  defaultPartitionId?: string
  onClose: () => void
  onAdded?: (serverId: string) => void
}

const emptyForm: ServerFormState = {
  name: '', partitionId: '', description: '', command: '', args: '', version: '1.0.0',
  transport: 'stdio', accessKey: '', accessType: 'bearer', accessUsername: '', apiHeader: 'X-API-Key', managementUrl: '', managementKey: '', tagsText: '',
}

function accessFields(server: MCPServer) {
  const type = server.accessAuthType ?? 'bearer'
  const authorization = Object.entries(server.headers ?? {}).find(([name]) => name.toLowerCase() === 'authorization')?.[1] ?? ''
  const basic = decodeBasicCredential(authorization.replace(/^Basic\s+/i, ''))
  const apiHeader = server.accessHeaderName ?? 'X-API-Key'
  return {
    accessType: type, accessUsername: type === 'basic' ? basic.username : '',
    accessKey: type === 'bearer' ? getBearerCredential(server.headers) : type === 'basic' ? basic.credential : server.headers?.[apiHeader] ?? '',
    apiHeader,
  }
}

export default function ServerFormModal({ open, initial, clone = false, defaultPartitionId, onClose, onAdded }: Props) {
  const partitions = useStore((s) => s.partitions)
  const servers = useStore((s) => s.servers)
  const { addServer, updateServer, addPartition } = useStore()
  const activeParts = partitions.filter((p) => !p.archived)
  const [form, setForm] = useState<ServerFormState>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [testing, setTesting] = useState<'connection' | 'admin' | null>(null)
  const [testMessage, setTestMessage] = useState('')
  const [creatingPartition, setCreatingPartition] = useState(false)
  const [partitionName, setPartitionName] = useState('')

  const createPartition = () => {
    const name = partitionName.trim()
    if (!name) return
    if (partitions.some((partition) => !partition.managedBy && partition.name.toLowerCase() === name.toLowerCase())) {
      setFormError(`分区“${name}”已存在，请直接选择或更换名称`)
      return
    }
    addPartition({ name, description: '接入服务器时创建', color: '#a78bfa', kind: 'project' })
    const created = useStore.getState().partitions.find((partition) => !partition.managedBy && partition.name === name)
    if (created) setForm({ ...form, partitionId: created.id })
    setPartitionName('')
    setCreatingPartition(false)
    setFormError(null)
  }

  const candidate = (): MCPServer => ({
    ...form, id: initial?.id ?? 'connection-test', name: form.name || 'connection-test',
    accessAuthType: form.accessType, accessHeaderName: form.accessType === 'api-key' ? form.apiHeader : undefined,
    headers: withAccessCredential(initial?.headers, { type: form.accessType, credential: form.accessKey, username: form.accessUsername, headerName: form.apiHeader }),
    status: initial?.status ?? 'stopped', createdAt: initial?.createdAt ?? Date.now(), archived: false,
  })
  const testConnection = async () => {
    if (!/^https?:\/\//i.test(form.command.trim())) { setTestMessage('本地 stdio 服务器请保存后通过“启动”验证真实握手'); return }
    setTesting('connection'); setTestMessage('')
    const status = await probeServer(candidate())
    setTestMessage(status === 'online' ? 'MCP 连接与 initialize 握手成功' : status === 'auth' ? '服务器可连接，但需要有效的 Bearer 凭证' : '连接失败或 MCP 握手未通过')
    setTesting(null)
  }
  const testAdmin = async () => {
    setTesting('admin'); setTestMessage('')
    try { await syncManagedServer(candidate()); setTestMessage('admin 权限验证成功，已读取服务器真实状态') }
    catch (error) { setTestMessage(`权限验证失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setTesting(null) }
  }

  useEffect(() => {
    if (!open) return
    setFormError(null)
    setTestMessage('')
    setCreatingPartition(false)
    setPartitionName('')
    if (initial) {
      setForm({
        name: initial.name, partitionId: initial.partitionId, description: initial.description,
        command: initial.command, args: initial.args, version: initial.version, transport: initial.transport,
        ...accessFields(initial),
        managementUrl: initial.managementUrl ?? '', managementKey: initial.managementKey ?? '', tagsText: (initial.tags ?? []).join(', '),
      })
    } else {
      setForm({ ...emptyForm, partitionId: defaultPartitionId || activeParts[0]?.id || '' })
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || initial || form.partitionId || !activeParts[0]) return
    const partitionId = activeParts.some((partition) => partition.id === defaultPartitionId) ? defaultPartitionId! : activeParts[0].id
    setForm((current) => current.partitionId ? current : { ...current, partitionId })
  }, [open, initial, form.partitionId, defaultPartitionId, partitions]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const partitionId = form.partitionId || activeParts[0]?.id || ''
    const error = validateServerConfig({ ...form, partitionId })
      ?? (servers.some((server) => (clone || server.id !== initial?.id) && !server.archived && server.partitionId === partitionId && server.name.trim().toLowerCase() === form.name.trim().toLowerCase()) ? '该分区已存在同名服务器，请更换名称或分区' : null)
      ?? (form.accessType === 'basic' && !form.accessUsername.trim() ? '使用 Basic Auth 时请填写用户名' : null)
      ?? (form.accessType === 'api-key' && !validateHeaderName(form.apiHeader) ? 'API Key 请求头名称无效' : null)
    setFormError(error)
    if (error) return
    const { accessKey: _accessKey, accessType: _accessType, accessUsername: _accessUsername, apiHeader: _apiHeader, tagsText: _tagsText, ...connection } = form
    const normalized = {
      ...connection, partitionId,
      name: form.name.trim(), command: form.command.trim(),
      managementUrl: form.managementUrl.trim(), managementKey: form.managementKey.trim(),
      accessAuthType: form.accessType, accessHeaderName: form.accessType === 'api-key' ? form.apiHeader.trim() : undefined,
      headers: withAccessCredential(initial?.headers, { type: form.accessType, credential: form.accessKey, username: form.accessUsername.trim(), headerName: form.apiHeader }),
      tags: [...new Set(form.tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))],
      favorite: clone ? false : initial?.favorite,
      accessLogSync: initial && !clone ? initial.accessLogSync : 'pending' as const,
      accessLogSince: initial && !clone ? initial.accessLogSince : undefined,
    }
    if (initial && !clone) {
      updateServer(initial.id, { ...normalized, ...(form.args !== initial.args ? { argList: undefined } : {}) })
    } else {
      const id = addServer({ ...normalized, status: 'stopped' })
      onAdded?.(id)
    }
    onClose()
    void refreshServerStatuses()
  }

  return (
    <Modal
      title={clone && initial ? `克隆服务器：${initial.name}` : initial ? `编辑服务器：${initial.name}` : '接入 MCP 服务器'}
      className="server-form-modal"
      open={open}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => void testConnection()} disabled={testing !== null}>{testing === 'connection' ? '测试中…' : '测试 MCP 连接'}</button>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={!form.name.trim() || !(form.partitionId || activeParts[0]?.id) || testing !== null}>保存</button>
        </>
      }
    >
      {formError && <div role="alert" style={{ color: 'var(--red)', marginBottom: 12, fontSize: 13 }}>{formError}</div>}
      <details className="config-section" open>
        <summary>基础连接</summary>
        <div className="field">
          <label htmlFor="server-name">服务器名称 <span className="required-mark">*</span></label>
          <input id="server-name" aria-label="服务器名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="输入服务器名称，例如：filesystem" />
        </div>
        <div className="field">
          <label htmlFor="server-description">描述</label>
          <textarea id="server-description" className="server-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="输入服务器描述（可选）" />
        </div>
        <div className="field">
          <label htmlFor="server-command">启动命令 / 服务地址 <span className="required-mark">*</span></label>
          <input id="server-command" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="npx -y @modelcontextprotocol/server-xxx 或 https://example.com/mcp" />
          <div className="field-hint">本地 stdio 填写启动命令；远程 MCP 填写 http(s) 服务地址。</div>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="server-partition">所属分区</label>
            <div className="partition-select-row">
              <select id="server-partition" value={form.partitionId || activeParts[0]?.id || ''} onChange={(e) => setForm({ ...form, partitionId: e.target.value })}>
                {activeParts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" className="btn partition-create-trigger" aria-label="新建所属分区" title="新建分区" onClick={() => { setCreatingPartition(!creatingPartition); setFormError(null) }}>＋</button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="server-transport">传输方式</label>
            <select id="server-transport" value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as Transport })}>
              {TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        {creatingPartition && <div className="inline-partition-create">
          <div className="field">
            <label htmlFor="new-partition-name">新分区名称</label>
            <input id="new-partition-name" value={partitionName} onChange={(event) => setPartitionName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createPartition() } }} placeholder="例如：我的 MCP 项目" autoFocus />
            <div className="field-hint">创建后自动选中，可在分区管理中继续编辑描述、分类和标识色。</div>
          </div>
          <div className="inline-partition-actions">
            <button type="button" className="btn btn-sm" onClick={() => { setCreatingPartition(false); setPartitionName(''); setFormError(null) }}>取消新建</button>
            <button type="button" className="btn btn-sm btn-primary" disabled={!partitionName.trim()} onClick={createPartition}>创建并选择</button>
          </div>
        </div>}
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="server-args">启动参数</label>
            <input id="server-args" value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="--db ./data/app.db" />
          </div>
          <div className="field"><label htmlFor="server-version">版本</label><input id="server-version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></div>
        </div>
        <div className="field">
          <label htmlFor="server-tags">服务器 Tags（逗号分隔）</label>
          <input id="server-tags" value={form.tagsText} onChange={(event) => setForm({ ...form, tagsText: event.target.value })} placeholder="生产, 核心服务, 团队 A" />
          <div className="field-hint">用于搜索、标签筛选和自定义视图，不会发送给 MCP 服务器。</div>
        </div>
      </details>
      {form.transport !== 'stdio' && <details className="config-section" open>
        <summary>访问凭证</summary>
        <div className="field">
          <label htmlFor="server-access-type">连接认证方式</label>
          <select id="server-access-type" value={form.accessType} onChange={(event) => setForm({ ...form, accessType: event.target.value as AccessAuthType })}>
            <option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option><option value="api-key">API Key</option>
          </select>
        </div>
        {form.accessType === 'basic' && <div className="field"><label htmlFor="server-access-username">Basic Auth 用户名</label><input id="server-access-username" value={form.accessUsername} onChange={(event) => setForm({ ...form, accessUsername: event.target.value })} autoComplete="off" /></div>}
        {form.accessType === 'api-key' && <div className="field"><label htmlFor="server-api-header">API Key 请求头</label><input id="server-api-header" value={form.apiHeader} onChange={(event) => setForm({ ...form, apiHeader: event.target.value })} placeholder="X-API-Key" /></div>}
        <div className="field">
          <label htmlFor="server-access-key">{form.accessType === 'basic' ? 'Basic Auth 密码' : form.accessType === 'api-key' ? 'API Key' : 'MCP 访问凭证（Bearer，可选）'}</label>
          <input id="server-access-key" type="password" value={form.accessKey} onChange={(e) => setForm({ ...form, accessKey: e.target.value })} placeholder="粘贴凭证发放页生成的完整凭证" autoComplete="off" />
          <div className="field-hint">用于 MCP initialize 和状态探测，不是管理用的 admin 凭证；保存后立即按所选方式生成真实请求头。</div>
        </div>
      </details>}
      <details className="config-section">
        <summary>远程管理（可选）</summary>
        <div className="field">
          <label htmlFor="server-management-url">管理接口</label>
          <input id="server-management-url" value={form.managementUrl} onChange={(e) => setForm({ ...form, managementUrl: e.target.value })} placeholder="服务器需提供 /manage 管理接口" />
        </div>
        <div className="field">
          <label htmlFor="server-management-key">全局 admin 凭证（仅保存在本机）</label>
          <input id="server-management-key" type="password" value={form.managementKey} onChange={(e) => setForm({ ...form, managementKey: e.target.value })} placeholder="tf_..." autoComplete="off" />
          <div className="field-hint">地址与凭证同时填写后，启停、分区与凭证操作才会下发到该服务器；失败时不会修改界面状态。</div>
        </div>
        <button className="btn" onClick={() => void testAdmin()} disabled={testing !== null || !form.managementUrl.trim() || !form.managementKey.trim()}>{testing === 'admin' ? '验证中…' : '验证 admin 权限'}</button>
      </details>
      {testMessage && <div className="form-notice" role="status">{testMessage}</div>}
    </Modal>
  )
}
