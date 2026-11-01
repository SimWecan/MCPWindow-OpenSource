// MCPWindow 核心数据模型

export type ServerStatus = 'running' | 'stopped' | 'crashed'

export type Transport = 'stdio' | 'sse' | 'streamable-http'

/** 分区维度：业务划分（按业务域）或工程划分（按工程/仓库） */
export type PartitionKind = 'business' | 'project'

/**
 * 真实运行探测状态（每次启动实时探测，不持久化）：
 * online=MCP 握手成功；auth=服务在线但需凭证；offline=不可达；unknown=浏览器模式无法探测本地进程
 */
export type LiveStatus = 'online' | 'auth' | 'offline' | 'unknown'

/** MCP 分区：服务器按分区隔离管理 */
export interface Partition {
  id: string
  name: string
  description: string
  color: string
  kind: PartitionKind
  archived: boolean
  createdAt: number
  /** 远程管理来源；本地演示分区为空 */
  managedBy?: string
  remoteName?: string
  rootPath?: string
}

/** MCP 服务器 */
export interface MCPServer {
  id: string
  name: string
  partitionId: string
  description: string
  command: string
  args: string
  /** 导入时的原始参数数组，避免带空格参数被二次拆分 */
  argList?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  version: string
  transport: Transport
  status: ServerStatus
  archived: boolean
  createdAt: number
  /** 管理接口地址与全局 admin 凭证，仅保存在本机 */
  managementUrl?: string
  managementKey?: string
  /** 普通 MCP 连接认证方式，凭证本身仅保存在 headers 中 */
  accessAuthType?: 'bearer' | 'basic' | 'api-key'
  accessHeaderName?: string
  /** 用户自定义标签与收藏，仅影响本地组织和筛选 */
  tags?: string[]
  favorite?: boolean
  /** 新增服务器在历史导入确认前为 pending；拒绝历史后只同步 accessLogSince 之后的记录。 */
  accessLogSync?: 'pending' | 'enabled' | 'disabled'
  accessLogSince?: number
}

export interface ServerResourceMetric {
  id: string
  pid: number
  cpuPercent: number | null
  memoryMB: number
  uptimeSeconds: number
  sampledAt: number
}

/** 访问日志：一次工具调用 / 连接 */
export interface AccessLog {
  ts: number
  serverId: string
  endpoint: string
  client: string
  tool: string
  ok: boolean
  /** 历史日志未记录耗时的时候为 null，界面显示“—”而非伪造 0ms。 */
  latencyMs: number | null
  /** 外部历史记录来源键，用于重复导入时保持幂等。 */
  sourceKey?: string
  /** 聚合次数字段：种子数据按小时桶聚合时使用 */
  count?: number
}

export interface LocalAccessLogFile {
  path: string
  count: number
  skipped: number
}

export interface LocalAccessLogResult {
  files: LocalAccessLogFile[]
  total: number
  skipped: number
  logs: Omit<AccessLog, 'serverId' | 'count'>[]
}

/** 崩溃日志 */
export interface CrashLog {
  ts: number
  serverId: string
  reason: string
}

/** 凭证：可访问指定分区的凭据 */
export interface Credential {
  id: string
  name: string
  keyPrefix: string
  scopes: string[] // partition id 列表
  rateLimitPerMin: number
  enabled: boolean
  createdAt: number
  expiresAt: number | null
  lastUsedAt: number | null
  managedBy?: string
  role?: 'read' | 'write' | 'admin'
  authType?: 'bearer' | 'basic' | 'api-key'
  apiHeader?: string
  basicUsername?: string
}

export interface ToolPluginTool {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
}

export interface ToolPlugin {
  id: string
  name: string
  version: string
  description: string
  entry: string
  permissions: string[]
  tools: ToolPluginTool[]
  publisher?: string
  homepage?: string
  updateUrl?: string
  signature?: string
  enabled: boolean
  installedAt: number
  signatureStatus: 'unsigned' | 'valid' | 'invalid'
  sourceDirectory?: string
  trustedSource: boolean
}

export interface PluginUpdateResult {
  id: string
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  signatureStatus: 'unsigned' | 'valid' | 'invalid'
}

export type AIProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

/** AI 辅助配置；缺省协议为 OpenAI Chat Completions，兼容旧版配置。 */
export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
  protocol?: AIProtocol
}

/** 独立的模型提供方；每组凭证维护自己的协议、模型目录与当前模型。 */
export interface AIProvider extends AIConfig {
  id: string
  name: string
  models: string[]
  protocol: AIProtocol
}

export type AIActionName = 'start' | 'stop' | 'restart'
export interface AIServerAction {
  serverId: string
  action: AIActionName
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
}
