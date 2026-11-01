import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { persistStorage } from '../utils/persistStorage'
import { migrateLegacyManagementUrl } from '../utils/serverConfig'
import { reorderVisible } from '../utils/reorder'
import type {
  AccessLog,
  AIConfig,
  AIProvider,
  ChatMessage,
  CrashLog,
  Credential,
  LiveStatus,
  MCPServer,
  Partition,
  ServerStatus,
  Transport,
} from '../types'
import {
  seedCredentials,
  seedPartitions,
  seedServers,
} from '../data/seed'
import { bundledLocalServers } from '../data/localConfig'

const genId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`

export const defaultAIProvider = (): AIProvider => ({
  id: 'ai-default', name: 'Kimi（Moonshot AI）', baseUrl: 'https://api.moonshot.cn/v1',
  apiKey: '', model: 'kimi-k2.6', models: ['kimi-k2.6'], protocol: 'openai-completions',
})

export interface State {
  partitions: Partition[]
  servers: MCPServer[]
  credentials: Credential[]
  accessLogs: AccessLog[]
  crashLogs: CrashLog[]
  /** 旧版单配置，仅用于迁移 */
  aiConfig: AIConfig
  aiProviders: AIProvider[]
  activeAIProviderId: string
  chat: ChatMessage[]

  // 分区
  addPartition: (p: Omit<Partition, 'id' | 'createdAt' | 'archived'>) => void
  updatePartition: (id: string, patch: Partial<Partition>) => void
  archivePartition: (id: string, archived: boolean) => void
  deletePartition: (id: string) => void
  replaceManagedState: (serverId: string, partitions: Partition[], credentials: Credential[]) => void

  // 服务器
  addServer: (s: Omit<MCPServer, 'id' | 'createdAt' | 'archived'>) => string
  updateServer: (id: string, patch: Partial<MCPServer>) => void
  reorderServers: (orderedVisibleIds: string[]) => void
  setServerStatus: (id: string, status: ServerStatus) => void
  archiveServer: (id: string, archived: boolean) => void
  deleteServer: (id: string) => void
  recordAccess: (log: Omit<AccessLog, 'count'> & { count?: number }) => void
  mergeAccessLogs: (logs: AccessLog[]) => number

  // 凭证
  addCredential: (c: Omit<Credential, 'id' | 'createdAt' | 'keyPrefix' | 'lastUsedAt'>, rawKey: string) => void
  updateCredential: (id: string, patch: Partial<Credential>) => void
  deleteCredential: (id: string) => void
  touchCredential: (id: string) => void

  // AI
  setAIConfig: (cfg: AIConfig) => void
  addAIProvider: (provider: Omit<AIProvider, 'id'>) => string
  updateAIProvider: (id: string, patch: Partial<AIProvider>) => void
  removeAIProvider: (id: string) => void
  setActiveAIProvider: (id: string) => void
  pushChat: (msg: ChatMessage) => void
  clearChat: () => void

  // 本机配置与首次使用引导
  localConfigImported: boolean
  importLocalConfig: () => void
  demoWorkspace: boolean
  clearDemoWorkspace: () => void
  restoreBackup: (partitions: Partition[], servers: MCPServer[]) => void

  // 实时运行探测（不持久化：每次启动重新探测，避免陈旧状态误导）
  liveStatus: Record<string, LiveStatus>
  lastProbeAt: number | null
  lastAccessLogSyncAt: number | null
  probeIssues: Record<string, string>
  setLiveStatus: (id: string, status: LiveStatus) => void
  setLastProbeAt: (ts: number) => void
  setLastAccessLogSyncAt: (ts: number) => void
  setProbeIssue: (id: string, message?: string) => void

  // Electron 托管进程存活状态（不持久化，每次启动与主进程对账）
  proc: Record<string, boolean>
  setProc: (id: string, running: boolean) => void
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      partitions: seedPartitions,
      servers: seedServers,
      credentials: seedCredentials,
      accessLogs: [],
      crashLogs: [],
      aiConfig: { baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', model: 'kimi-k2.6' },
      aiProviders: [defaultAIProvider()],
      activeAIProviderId: 'ai-default',
      chat: [],
      localConfigImported: false,
      demoWorkspace: true,

      addPartition: (p) =>
        set((st) => ({ partitions: [...st.partitions, { ...p, id: genId('p'), createdAt: Date.now(), archived: false }] })),
      updatePartition: (id, patch) =>
        set((st) => ({ partitions: st.partitions.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      archivePartition: (id, archived) =>
        set((st) => ({ partitions: st.partitions.map((p) => (p.id === id ? { ...p, archived } : p)) })),
      deletePartition: (id) =>
        set((st) => ({
          partitions: st.partitions.filter((p) => p.id !== id),
          // 级联归档该分区下的服务器，不物理删除
          servers: st.servers.map((s) => (s.partitionId === id ? { ...s, archived: true } : s)),
          credentials: st.credentials.map((c) => ({ ...c, scopes: c.scopes.filter((s) => s !== id) })),
        })),
      replaceManagedState: (serverId, partitions, credentials) =>
        set((st) => {
          const oldPartitions = st.partitions.filter((p) => p.managedBy === serverId)
          const oldCredentials = st.credentials.filter((c) => c.managedBy === serverId)
          const partitionsUnchanged = JSON.stringify(oldPartitions) === JSON.stringify(partitions)
          const credentialsUnchanged = JSON.stringify(oldCredentials) === JSON.stringify(credentials)
          if (partitionsUnchanged && credentialsUnchanged) return st
          return {
            partitions: partitionsUnchanged ? st.partitions : [...st.partitions.filter((p) => p.managedBy !== serverId), ...partitions],
            credentials: credentialsUnchanged ? st.credentials : [...st.credentials.filter((c) => c.managedBy !== serverId), ...credentials],
          }
        }),

      addServer: (s) => {
        const id = genId('s')
        set((st) => ({ servers: [...st.servers, { ...s, id, createdAt: Date.now(), archived: false }] }))
        return id
      },
      updateServer: (id, patch) =>
        set((st) => ({ servers: st.servers.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
      reorderServers: (orderedVisibleIds) =>
        set((st) => ({ servers: reorderVisible(st.servers, orderedVisibleIds) })),
      setServerStatus: (id, status) =>
        set((st) => {
          if (st.servers.find((s) => s.id === id)?.status === status) return st
          const servers = st.servers.map((s) => (s.id === id ? { ...s, status } : s))
          const crashLogs =
            status === 'crashed'
              ? [...st.crashLogs.slice(-19999), { ts: Date.now(), serverId: id, reason: '手动标记 / 检测到进程异常退出' }]
              : st.crashLogs
          return { servers, crashLogs }
        }),
      archiveServer: (id, archived) =>
        set((st) => ({ servers: st.servers.map((s) => (s.id === id ? { ...s, archived, status: archived ? 'stopped' : s.status } : s)) })),
      deleteServer: (id) =>
        set((st) => {
          // 删除管理来源时同步清理其镜像分区、凭证和瞬时状态，避免残留隐藏数据。
          const removedPartitionIds = new Set(st.partitions.filter((p) => p.managedBy === id).map((p) => p.id))
          return {
            servers: st.servers.filter((s) => s.id !== id).map((s) => removedPartitionIds.has(s.partitionId) ? { ...s, archived: true, status: 'stopped' as const } : s),
            partitions: st.partitions.filter((p) => p.managedBy !== id),
            credentials: st.credentials.filter((c) => c.managedBy !== id).map((c) => ({ ...c, scopes: c.scopes.filter((scope) => !removedPartitionIds.has(scope)) })),
            accessLogs: st.accessLogs.filter((l) => l.serverId !== id),
            crashLogs: st.crashLogs.filter((l) => l.serverId !== id),
            liveStatus: Object.fromEntries(Object.entries(st.liveStatus).filter(([serverId]) => serverId !== id)),
            proc: Object.fromEntries(Object.entries(st.proc).filter(([serverId]) => serverId !== id)),
          }
        }),
      recordAccess: (log) =>
        set((st) => ({ accessLogs: [...st.accessLogs.slice(-19999), { ...log, count: log.count ?? 1 }] })),
      mergeAccessLogs: (logs) => {
        let added = 0
        set((st) => {
          const known = new Set(st.accessLogs.filter((log) => log.sourceKey).map((log) => `${log.serverId}\0${log.sourceKey}`))
          const incoming = logs.filter((log) => {
            if (!log.sourceKey) return true
            const key = `${log.serverId}\0${log.sourceKey}`
            if (known.has(key)) return false
            known.add(key)
            return true
          })
          if (!incoming.length) return st
          added = incoming.length
          return { accessLogs: [...st.accessLogs, ...incoming].sort((a, b) => a.ts - b.ts).slice(-20000) }
        })
        return added
      },

      addCredential: (c, rawKey) =>
        set((st) => ({
          credentials: [
            ...st.credentials,
            { ...c, id: genId('c'), keyPrefix: rawKey.slice(0, 16), createdAt: Date.now(), lastUsedAt: null },
          ],
        })),
      updateCredential: (id, patch) =>
        set((st) => ({ credentials: st.credentials.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      deleteCredential: (id) =>
        set((st) => ({ credentials: st.credentials.filter((c) => c.id !== id) })),
      touchCredential: (id) =>
        set((st) => ({ credentials: st.credentials.map((c) => (c.id === id ? { ...c, lastUsedAt: Date.now() } : c)) })),

      setAIConfig: (cfg) => set({ aiConfig: cfg }),
      addAIProvider: (provider) => {
        const id = genId('ai')
        set((st) => ({ aiProviders: [...st.aiProviders, { ...provider, id }], activeAIProviderId: id }))
        return id
      },
      updateAIProvider: (id, patch) =>
        set((st) => ({ aiProviders: st.aiProviders.map((provider) => provider.id === id ? { ...provider, ...patch, id } : provider) })),
      removeAIProvider: (id) =>
        set((st) => {
          const aiProviders = st.aiProviders.filter((provider) => provider.id !== id)
          return { aiProviders, activeAIProviderId: st.activeAIProviderId === id ? aiProviders[0]?.id ?? '' : st.activeAIProviderId }
        }),
      setActiveAIProvider: (id) =>
        set((st) => st.aiProviders.some((provider) => provider.id === id) ? { activeAIProviderId: id } : st),
      pushChat: (msg) => set((st) => ({ chat: [...st.chat.slice(-99), msg] })),
      clearChat: () => set({ chat: [] }),

      importLocalConfig: () =>
        set((st) => {
          const existing = new Set(st.servers.map((s) => s.id))
          const fresh = bundledLocalServers
            .filter((s) => !existing.has(s.id))
            .map((s) => ({ ...s, createdAt: Date.now(), archived: false }))
          return { servers: [...st.servers, ...fresh], localConfigImported: true }
        }),
      clearDemoWorkspace: () =>
        set((st) => {
          const partitionIds = new Set(seedPartitions.map((item) => item.id))
          const serverIds = new Set(seedServers.map((item) => item.id))
          const credentialIds = new Set(seedCredentials.map((item) => item.id))
          return {
            partitions: st.partitions.filter((item) => !partitionIds.has(item.id)),
            servers: st.servers.filter((item) => !serverIds.has(item.id)),
            credentials: st.credentials.filter((item) => !credentialIds.has(item.id)),
            accessLogs: st.accessLogs.filter((item) => !serverIds.has(item.serverId)),
            crashLogs: st.crashLogs.filter((item) => !serverIds.has(item.serverId)),
            liveStatus: Object.fromEntries(Object.entries(st.liveStatus).filter(([id]) => !serverIds.has(id))),
            proc: Object.fromEntries(Object.entries(st.proc).filter(([id]) => !serverIds.has(id))),
            demoWorkspace: false,
          }
        }),
      restoreBackup: (incomingPartitions, incomingServers) => set((st) => {
        const partitionIds = new Map<string, string>()
        const existingNames = new Set(st.partitions.map((item) => item.name))
        const newPartitions: Partition[] = []
        for (const item of incomingPartitions) {
          const existing = st.partitions.find((partition) => partition.name === item.name)
          if (existing) { partitionIds.set(item.id, existing.id); continue }
          const id = st.partitions.some((partition) => partition.id === item.id) || newPartitions.some((partition) => partition.id === item.id) ? genId('p') : item.id
          partitionIds.set(item.id, id)
          newPartitions.push({ ...item, id, managedBy: undefined, remoteName: undefined })
          existingNames.add(item.name)
        }
        const serverNames = new Set(st.servers.map((item) => item.name))
        const newServers = incomingServers.filter((item) => {
          if (serverNames.has(item.name) || !partitionIds.has(item.partitionId)) return false
          serverNames.add(item.name)
          return true
        }).map((item) => ({ ...item, id: st.servers.some((server) => server.id === item.id) ? genId('s') : item.id, partitionId: partitionIds.get(item.partitionId)!, status: 'stopped' as const, headers: {}, env: {}, managementKey: '', archived: false }))
        return { partitions: [...st.partitions, ...newPartitions], servers: [...st.servers, ...newServers] }
      }),

      liveStatus: {},
      lastProbeAt: null,
      lastAccessLogSyncAt: null,
      probeIssues: {},
      setLiveStatus: (id, status) =>
        set((st) => st.liveStatus[id] === status ? st : { liveStatus: { ...st.liveStatus, [id]: status } }),
      setLastProbeAt: (ts) => set({ lastProbeAt: ts }),
      setLastAccessLogSyncAt: (ts) => set({ lastAccessLogSyncAt: ts }),
      setProbeIssue: (id, message) =>
        set((st) => {
          const probeIssues = { ...st.probeIssues }
          if (message) probeIssues[id] = message
          else delete probeIssues[id]
          return { probeIssues }
        }),

      proc: {},
      setProc: (id, running) =>
        set((st) => st.proc[id] === running ? st : { proc: { ...st.proc, [id]: running } }),
    }),
    {
      name: 'mcpwindow-store-v1',
      version: 7,
      storage: createJSONStorage(() => persistStorage),
      migrate: (persisted, version) => {
        const st = (persisted ?? {}) as Partial<State>
        // v1 -> v2：分区补充 kind 字段，并补齐工程维度种子分区
        const partitions = (st.partitions ?? []).map((p) => ({ ...p, kind: (p.kind ?? 'business') as Partition['kind'] }))
        const have = new Set(partitions.map((p) => p.id))
        for (const p of seedPartitions) {
          if (p.kind === 'project' && !have.has(p.id)) partitions.push(p)
        }
        const existingProviders = st.aiProviders?.length ? st.aiProviders : [{
          ...defaultAIProvider(),
          ...(st.aiConfig ?? {}),
          models: st.aiConfig?.model ? [st.aiConfig.model] : defaultAIProvider().models,
        }]
        // v5 前仅有 OpenAI Chat Completions，迁移时保留所有既有连接行为。
        const aiProviders: AIProvider[] = existingProviders.map((provider) => ({
          ...provider,
          protocol: provider.protocol ?? 'openai-completions',
        }))
        return {
          partitions,
          // v6：修正 TerraFin 早期误存为 8090/mcp 的管理地址，保留 admin 凭证。
          servers: (st.servers ?? seedServers).map(migrateLegacyManagementUrl),
          credentials: st.credentials ?? seedCredentials,
          // v3 前的访问记录全部是种子数据；崩溃记录仅移除明确的演示原因，保留真实进程事件。
          accessLogs: version < 3 ? [] : st.accessLogs ?? [],
          crashLogs: version < 3
            ? (st.crashLogs ?? []).filter((log) => !['进程退出码 1', '端口占用 EADDRINUSE', 'JSON-RPC 解析失败', '内存超限 OOM', '凭证校验失败连续 5 次'].includes(log.reason))
            : st.crashLogs ?? [],
          aiConfig: st.aiConfig ?? { baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', model: 'kimi-k2.6' },
          aiProviders,
          activeAIProviderId: aiProviders.some((provider) => provider.id === st.activeAIProviderId) ? st.activeAIProviderId : aiProviders[0].id,
          chat: st.chat ?? [],
          localConfigImported: false,
          demoWorkspace: st.demoWorkspace ?? (st.servers ?? seedServers).some((server) => seedServers.some((seed) => seed.id === server.id)),
        }
      },
      partialize: (st) => ({
        partitions: st.partitions,
        servers: st.servers,
        credentials: st.credentials,
        accessLogs: st.accessLogs.slice(-20000),
        crashLogs: st.crashLogs.slice(-20000),
        aiConfig: st.aiConfig,
        aiProviders: st.aiProviders,
        activeAIProviderId: st.activeAIProviderId,
        chat: st.chat.slice(-100),
        localConfigImported: st.localConfigImported,
        demoWorkspace: st.demoWorkspace,
      }),
    },
  ),
)

/** 便捷选择器 */
export const activePartitions = (st: State) => st.partitions.filter((p) => !p.archived)
export const activeServers = (st: State) => st.servers.filter((s) => !s.archived)

export const TRANSPORTS: Transport[] = ['stdio', 'sse', 'streamable-http']
export const STATUS_META: Record<ServerStatus, { label: string; color: string }> = {
  running: { label: '运行中', color: '#22c993' },
  stopped: { label: '已停止', color: '#8a93a6' },
  crashed: { label: '崩溃', color: '#f4586a' },
}
