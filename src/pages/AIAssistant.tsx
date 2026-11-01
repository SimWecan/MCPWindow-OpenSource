import { useEffect, useRef, useState } from 'react'
import Modal from '../components/Modal'
import { defaultAIProvider, useStore } from '../store/useStore'
import type { AIProtocol, AIProvider, AIServerAction } from '../types'
import { chat as aiChat, validateKey, type AIChatTool } from '../utils/aiClient'
import { AI_PROTOCOL_LABELS, AI_PROVIDER_PRESETS } from '../utils/aiProviderPresets'
import { AI_ACTION_LABEL, executeAIAction } from '../utils/aiOperations'
import { bridge, isControllable } from '../utils/control'
import { canManage } from '../utils/management'
import { logCount } from '../utils/stats'
import { useTranslation } from '../i18n'

interface PendingAction extends AIServerAction {
  id: string
  status: 'pending' | 'running' | 'done' | 'rejected' | 'error'
  message?: string
}

const ACTION_INTENT = /启动|停止|重启|开启|关闭|\b(start|stop|restart)\b/i
const QUESTION_INTENT = /如何|怎么|什么|为什么|说明|步骤|教程/
const actionId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

/** 只向模型提供实时只读摘要和稳定服务器 ID，不包含任何凭证。 */
function buildContext(): string {
  const { servers, partitions, credentials, accessLogs, crashLogs, liveStatus } = useStore.getState()
  const active = servers.filter((s) => !s.archived)
  const dayAgo = Date.now() - 86400_000
  const lines: string[] = ['当前 MCPWindow 管理台状态：']
  lines.push(`分区：${partitions.filter((p) => !p.archived).map((p) => p.name).join('、') || '无'}`)
  lines.push('服务器：' + active.map((s) => {
    const accesses = accessLogs.filter((l) => l.serverId === s.id && l.ts >= dayAgo).reduce((a, l) => a + logCount(l), 0)
    const crashes = crashLogs.filter((l) => l.serverId === s.id && l.ts >= dayAgo).length
    return `${s.name}(id=${s.id}, 实时状态=${liveStatus[s.id] ?? 'unknown'}, 24h访问${accesses}次, 24h崩溃${crashes}次)`
  }).join('；'))
  const expired = credentials.filter((c) => c.enabled && c.expiresAt && c.expiresAt < Date.now())
  lines.push(`凭证：共 ${credentials.length} 个，过期但仍启用 ${expired.length} 个`)
  if (expired.length) lines.push('需要处理的过期凭证：' + expired.map((c) => c.name).join('、'))
  return lines.join('\n')
}

function buildTools(): AIChatTool[] {
  const servers = useStore.getState().servers.filter((server) =>
    !server.archived && (canManage(server) || (bridge()?.procStart && isControllable(server))),
  )
  if (!servers.length) return []
  return [{
    type: 'function',
    function: {
      name: 'mcp_server_operation',
      description: '提议启动、停止或重启一个 MCP 服务器。仅生成待用户确认的操作，不代表操作已执行。',
      parameters: {
        type: 'object',
        properties: {
          serverId: { type: 'string', enum: servers.map((server) => server.id), description: '实时状态摘要中的服务器 id' },
          action: { type: 'string', enum: ['start', 'stop', 'restart'] },
        },
        required: ['serverId', 'action'],
        additionalProperties: false,
      },
    },
  }]
}

const QUICK_PROMPTS = [
  '帮我诊断当前异常的服务器',
  '哪些凭证存在安全隐患？',
  '给我一个提升稳定性的建议清单',
  '汇总今天各服务器的访问情况',
]

export default function AIAssistant() {
  const { language } = useTranslation()
  const providers = useStore((s) => s.aiProviders)
  const activeProviderId = useStore((s) => s.activeAIProviderId)
  const servers = useStore((s) => s.servers)
  const chat = useStore((s) => s.chat)
  const {
    addAIProvider, updateAIProvider, removeAIProvider, setActiveAIProvider,
    pushChat, clearChat,
  } = useStore()
  const activeProvider = providers.find((provider) => provider.id === activeProviderId)

  const [cfgForm, setCfgForm] = useState<AIProvider>(activeProvider ?? defaultAIProvider())
  const [manualModel, setManualModel] = useState('')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validateResult, setValidateResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [operationAllowed, setOperationAllowed] = useState(false)
  const [permissionRequested, setPermissionRequested] = useState(false)
  const [permissionOpen, setPermissionOpen] = useState(false)
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeProvider) {
      setCfgForm({ ...activeProvider, models: [...activeProvider.models] })
      setValidateResult(null)
    }
  }, [activeProviderId]) // 切换提供方时加载其独立配置，编辑中不被模型目录更新打断

  useEffect(() => {
    if (activeProvider) setCfgForm((current) => ({ ...current, model: activeProvider.model }))
  }, [activeProvider?.model])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [chat, pendingActions, sending])

  const keyReady = Boolean(activeProvider?.apiKey.trim() && activeProvider.model.trim())
  const models = activeProvider ? [...new Set([...activeProvider.models, activeProvider.model].filter(Boolean))] : []

  const addProvider = () => {
    const preset = AI_PROVIDER_PRESETS.find((item) => item.id === 'deepseek')!
    const provider = {
      name: preset.name, baseUrl: preset.baseUrl, apiKey: '', protocol: preset.protocol,
      model: preset.model, models: [preset.model],
    }
    const id = addAIProvider(provider)
    // 同步切换编辑目标，避免快速填写时把新配置写入上一个提供方。
    setCfgForm({ ...provider, id })
    setValidateResult(null)
    setManualModel('')
  }

  const applyPreset = (id: string) => {
    const preset = AI_PROVIDER_PRESETS.find((item) => item.id === id)
    if (!preset) return
    setCfgForm((current) => ({
      ...current,
      name: preset.name,
      baseUrl: preset.baseUrl,
      protocol: preset.protocol,
      model: preset.model,
      models: [preset.model],
    }))
    setValidateResult(null)
  }

  const saveConfig = async () => {
    if (!cfgForm.id || validating) return
    if (!cfgForm.name.trim() || !cfgForm.baseUrl.trim() || !cfgForm.apiKey.trim()) {
      setValidateResult({ ok: false, text: '显示名称、API 地址与 API Key 均不能为空' })
      return
    }
    setValidating(true)
    setValidateResult(null)
    const normalized = { ...cfgForm, name: cfgForm.name.trim(), baseUrl: cfgForm.baseUrl.trim(), apiKey: cfgForm.apiKey.trim() }
    updateAIProvider(cfgForm.id, normalized)
    const result = await validateKey(normalized)
    if (result.ok) {
      const fetched = [...new Set(result.models ?? [])].sort((a, b) => a.localeCompare(b))
      const nextModels = fetched.length ? fetched : normalized.models
      const nextModel = nextModels.includes(normalized.model) ? normalized.model : nextModels[0] ?? normalized.model
      updateAIProvider(cfgForm.id, { models: nextModels, model: nextModel })
      setCfgForm((current) => ({ ...current, models: nextModels, model: nextModel }))
      setValidateResult({
        ok: true,
        text: fetched.length ? `连接正常，已获取 ${fetched.length} 个模型，可在对话区下拉切换` : '连接正常；接口未返回模型目录，可手动添加模型 ID',
      })
    } else {
      setValidateResult({ ok: false, text: `配置已保存，但连接失败：${result.error}` })
    }
    setValidating(false)
  }

  const addManualModel = () => {
    const model = manualModel.trim()
    if (!model || !activeProvider) return
    const nextModels = [...new Set([...activeProvider.models, model])]
    updateAIProvider(activeProvider.id, { models: nextModels, model })
    setCfgForm((current) => ({ ...current, models: nextModels, model }))
    setManualModel('')
  }

  const send = async (text: string) => {
    const content = text.trim()
    if (!content || sending) return
    setInput('')
    pushChat({ role: 'user', content, ts: Date.now() })

    if (ACTION_INTENT.test(content) && !QUESTION_INTENT.test(content) && !operationAllowed) {
      setPermissionRequested(true)
      pushChat({
        role: 'assistant', ts: Date.now(),
        content: '这项请求涉及真实服务器操作。我需要你开放本次会话的进程操作权限；开放后，每一步仍会单独向你确认，不会自动执行。',
      })
      return
    }
    if (!activeProvider || !keyReady) {
      pushChat({ role: 'assistant', ts: Date.now(), content: '请先选择提供方，填写并保存 API Key，然后从模型下拉框选择可用模型。' })
      return
    }

    setSending(true)
    try {
      const permissionPrompt = operationAllowed
        ? language === 'en'
          ? 'Process operations are allowed for this chat. Use mcp_server_operation for every proposed action, never claim it has run, and let the client obtain separate user confirmation.'
          : '用户已开放本次会话的进程操作权限。需要操作时必须调用 mcp_server_operation 工具，只生成建议，不得声称已执行；客户端会要求用户再次确认。'
        : language === 'en'
          ? 'No server operation access is granted. Provide diagnostics and recommendations only, and never claim an operation was performed.'
          : '当前没有服务器操作权限，只提供诊断与操作建议，不要声称执行过任何操作。'
      const sysPrompt = language === 'en'
        ? `You are the MCPWindow AI operations assistant. Answer in concise English bullets using live state. ${permissionPrompt}\n\n${buildContext()}`
        : `你是 MCPWindow 的 AI 管理助手。用简体中文、要点式回答，基于实时状态给出可执行建议。${permissionPrompt}\n\n${buildContext()}`
      const result = await aiChat(activeProvider, chat.filter((m) => m.role !== 'system'), content, operationAllowed ? buildTools() : [])
      if (result.ok) {
        if (result.content && result.content !== '（空回复）') pushChat({ role: 'assistant', content: result.content, ts: Date.now() })
        if (result.actions?.length) {
          setPendingActions((current) => [...current, ...result.actions!.map((action) => ({ ...action, id: actionId(), status: 'pending' as const }))])
          if (!result.content || result.content === '（空回复）') pushChat({ role: 'assistant', content: '已生成操作请求，请核对目标并确认。', ts: Date.now() })
        }
      } else {
        pushChat({ role: 'assistant', ts: Date.now(), content: `请求失败：${result.error}` })
      }
    } catch (error) {
      pushChat({ role: 'assistant', ts: Date.now(), content: `网络请求出错：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setSending(false)
    }
  }

  const confirmAction = async (pending: PendingAction) => {
    if (pending.status !== 'pending' || !operationAllowed) return
    setPendingActions((current) => current.map((item) => item.id === pending.id ? { ...item, status: 'running' } : item))
    try {
      const server = await executeAIAction(pending, operationAllowed)
      const message = `${server.name} ${AI_ACTION_LABEL[pending.action]}成功，已核实真实运行状态`
      setPendingActions((current) => current.map((item) => item.id === pending.id ? { ...item, status: 'done', message } : item))
      pushChat({ role: 'assistant', content: message, ts: Date.now() })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPendingActions((current) => current.map((item) => item.id === pending.id ? { ...item, status: 'error', message } : item))
    }
  }

  const updateAction = (id: string, patch: Partial<PendingAction>) =>
    setPendingActions((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">AI 辅助管理</h2>
          <div className="page-sub">多提供方接入、模型自由选择，以及经你确认的服务器操作</div>
        </div>
        <button className="btn" onClick={() => {
          clearChat(); setPendingActions([]); setOperationAllowed(false); setPermissionRequested(false)
        }} disabled={chat.length === 0 && pendingActions.length === 0}>新建会话</button>
      </div>

      <div className="ai-layout">
        <div className="card ai-config">
          <div className="card-title">模型提供方<button className="btn btn-sm" onClick={addProvider}>+ 添加</button></div>
          <div className="field">
            <label htmlFor="ai-provider">当前提供方（{providers.length}）</label>
            <div className="provider-select">
              <select id="ai-provider" value={activeProviderId} onChange={(e) => setActiveAIProvider(e.target.value)}>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.apiKey ? '' : '（未配置）'}</option>)}
              </select>
              {activeProvider && <button className="btn btn-danger" aria-label="删除当前提供方" onClick={() => setConfirmDelete(true)}>删除</button>}
            </div>
          </div>
          {activeProvider && <>
            <div className="field">
              <label htmlFor="ai-preset">快速配置／服务商</label>
              <select id="ai-preset" value={AI_PROVIDER_PRESETS.find((preset) => preset.baseUrl === cfgForm.baseUrl && preset.protocol === cfgForm.protocol)?.id ?? 'custom'}
                onChange={(e) => applyPreset(e.target.value)}>
                <option value="custom" disabled>自定义服务商</option>
                {AI_PROVIDER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
              <div className="field-hint">选择预设会更新地址、协议和默认模型，保留已填写的 API Key。</div>
            </div>
            <div className="field">
              <label htmlFor="ai-provider-name">显示名称</label>
              <input id="ai-provider-name" value={cfgForm.name} onChange={(e) => setCfgForm({ ...cfgForm, name: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="ai-protocol">API 协议</label>
              <select id="ai-protocol" value={cfgForm.protocol} onChange={(e) => setCfgForm({ ...cfgForm, protocol: e.target.value as AIProtocol })}>
                {Object.entries(AI_PROTOCOL_LABELS).map(([protocol, label]) => <option key={protocol} value={protocol}>{label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ai-base-url">API 地址</label>
              <input id="ai-base-url" value={cfgForm.baseUrl} onChange={(e) => setCfgForm({ ...cfgForm, baseUrl: e.target.value })} placeholder="https://api.deepseek.com/v1" />
            </div>
            <div className="field">
              <label htmlFor="ai-api-key">API Key</label>
              <input id="ai-api-key" type="password" value={cfgForm.apiKey} onChange={(e) => setCfgForm({ ...cfgForm, apiKey: e.target.value })} placeholder="sk-..." autoComplete="off" />
              <div className="field-hint">每个提供方使用独立 Key；桌面版加密保存在本机，浏览器预览使用当前站点存储。</div>
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={saveConfig} disabled={validating}>
              {validating ? '连接并获取模型中…' : '保存并获取模型'}
            </button>
            {validateResult && <div role="status" className={`ai-validation ${validateResult.ok ? 'ok' : 'error'}`}>{validateResult.text}</div>}
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="ai-manual-model">手动添加模型 ID（接口无模型目录时）</label>
              <div className="provider-select">
                <input id="ai-manual-model" value={manualModel} onChange={(e) => setManualModel(e.target.value)} placeholder="deepseek-chat" />
                <button className="btn" onClick={addManualModel} disabled={!manualModel.trim()}>添加</button>
              </div>
            </div>
          </>}
          {!activeProvider && <div className="empty">点击“添加”创建第一个模型提供方</div>}
        </div>

        <div className="card chat-box">
          <div className="chat-toolbar">
            <div>
              <strong>{activeProvider?.name ?? '未选择提供方'}</strong>
              <span className={`ai-connection ${keyReady ? 'ready' : ''}`}>{keyReady ? '已接入' : '待配置'}</span>
            </div>
            <label htmlFor="ai-chat-model">模型</label>
            <select id="ai-chat-model" value={activeProvider?.model ?? ''} disabled={!activeProvider || models.length === 0}
              onChange={(e) => activeProvider && updateAIProvider(activeProvider.id, { model: e.target.value })}>
              {models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </div>

          <div className={`ai-permission ${operationAllowed ? 'granted' : ''}`}>
            <span>{operationAllowed ? '本次会话已开放进程操作；每一步仍需确认' : 'AI 默认只读，不会执行服务器操作'}</span>
            <button className="btn btn-sm" onClick={() => operationAllowed ? setOperationAllowed(false) : setPermissionOpen(true)}>
              {operationAllowed ? '撤销权限' : '开放权限'}
            </button>
          </div>

          <div className="chat-scroll" ref={scrollRef}>
            {chat.length === 0 && <div className="chat-msg system">你好，我会结合实时状态协助诊断。你也可以直接说“重启某服务器”，我会先请求权限，再把操作目标交给你确认。</div>}
            {chat.map((message, index) => <div key={index} className={`chat-msg ${message.role}`}>{message.content}</div>)}
            {permissionRequested && !operationAllowed && <div className="ai-action-card">
              <strong>AI 请求服务器操作权限</strong>
              <p>仅开放启动、停止、重启；不开放分区、凭证或配置修改权限。</p>
              <button className="btn btn-primary btn-sm" onClick={() => setPermissionOpen(true)}>查看并授权</button>
            </div>}
            {pendingActions.map((pending) => {
              const server = servers.find((item) => item.id === pending.serverId)
              return <div className="ai-action-card" key={pending.id}>
                <strong>{pending.status === 'done' ? '✓ ' : ''}{AI_ACTION_LABEL[pending.action]}服务器：{server?.name ?? '未知服务器'}</strong>
                <p>{pending.message ?? (pending.status === 'rejected' ? '已拒绝，不会执行。' : pending.status === 'running' ? '正在执行并等待真实状态回读…' : '请核对目标服务器与操作。此请求由 AI 提议，只有确认后才会执行。')}</p>
                {pending.status === 'pending' && <div className="ai-action-buttons">
                  <button className="btn btn-sm" onClick={() => updateAction(pending.id, { status: 'rejected' })}>拒绝</button>
                  <button className="btn btn-sm btn-primary" disabled={!operationAllowed} onClick={() => void confirmAction(pending)}>确认{AI_ACTION_LABEL[pending.action]}</button>
                </div>}
              </div>
            })}
            {sending && <div className="chat-msg system">正在使用 {activeProvider?.model} 思考…</div>}
          </div>

          <div className="quick-prompts">{QUICK_PROMPTS.map((prompt) => <button key={prompt} className="btn btn-sm" onClick={() => void send(prompt)}>{prompt}</button>)}</div>
          <div className="chat-input">
            <input aria-label="向 AI 管理助手提问" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send(input) }} placeholder="询问状态，或输入“重启某服务器”…" />
            <button className="btn btn-primary" onClick={() => void send(input)} disabled={sending || !input.trim()}>发送</button>
          </div>
        </div>
      </div>

      <Modal title="开放 AI 服务器操作权限" open={permissionOpen} onClose={() => setPermissionOpen(false)}
        footer={<><button className="btn" onClick={() => setPermissionOpen(false)}>取消</button><button className="btn btn-primary" onClick={() => {
          setOperationAllowed(true); setPermissionRequested(false); setPermissionOpen(false)
          pushChat({ role: 'system', content: '已开放本次会话的进程操作权限；每个操作仍需单独确认。', ts: Date.now() })
        }}>仅本次会话开放</button></>}>
        <div className="permission-details">
          <p>允许 AI 提议启动、停止和重启你具有管理权限的 MCP 服务器。</p>
          <ul>
            <li>每次操作都会显示目标服务器，必须再次确认。</li>
            <li>不包括新增／删除分区、发放／吊销凭证或修改配置。</li>
            <li>权限不持久化，撤销或重启应用后立即恢复只读。</li>
          </ul>
        </div>
      </Modal>

      <Modal title="删除模型提供方" open={confirmDelete} onClose={() => setConfirmDelete(false)}
        footer={<><button className="btn" onClick={() => setConfirmDelete(false)}>取消</button><button className="btn btn-danger" onClick={() => {
          if (activeProvider) removeAIProvider(activeProvider.id)
          setConfirmDelete(false)
        }}>确认删除</button></>}>
        <p style={{ color: 'var(--text-2)' }}>将删除“{activeProvider?.name}”及其本机 API Key 和模型目录，不影响其他提供方。</p>
      </Modal>
    </div>
  )
}
