import type {
  AccessLog,
  CrashLog,
  Credential,
  MCPServer,
  Partition,
} from '../types'

/** 确定性伪随机，保证种子数据稳定 */
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rnd = mulberry32(20261024)
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]

const HOUR = 3600_000
const DAY = 24 * HOUR
const now = Date.now()

export const seedPartitions: Partition[] = [
  // 业务维度分区
  { id: 'p-dev', name: '开发工具', description: '本地研发常用工具类 MCP 服务', color: '#4f8dff', kind: 'business', archived: false, createdAt: now - 90 * DAY },
  { id: 'p-data', name: '数据服务', description: '数据库 / 数据查询类服务', color: '#22c993', kind: 'business', archived: false, createdAt: now - 88 * DAY },
  { id: 'p-ext', name: '外部集成', description: '第三方 API 集成服务', color: '#f6a04d', kind: 'business', archived: false, createdAt: now - 60 * DAY },
  { id: 'p-legacy', name: '旧版归档', description: '已下线的历史服务分区', color: '#8a93a6', kind: 'business', archived: true, createdAt: now - 200 * DAY },
  // 工程维度分区（按仓库 / 工程划分）
  { id: 'p-proj-ark', name: 'arknightsclub 工程', description: '明日方舟俱乐部工程专属 MCP 服务', color: '#38bdf8', kind: 'project', archived: false, createdAt: now - 70 * DAY },
  { id: 'p-proj-cdf', name: 'CDFProject 工程', description: 'CDF 工程专属 MCP 服务', color: '#eab308', kind: 'project', archived: false, createdAt: now - 65 * DAY },
  { id: 'p-proj-nfc', name: 'NFCTakeFriends 枢纽', description: 'NFC 枢纽仓工程（Hub + 多凭证鉴权）', color: '#fb7185', kind: 'project', archived: false, createdAt: now - 62 * DAY },
  { id: 'p-proj-skill', name: 'SkillLibrary 工程', description: '技能库工程专属 MCP 服务', color: '#34d399', kind: 'project', archived: false, createdAt: now - 58 * DAY },
]

export const seedServers: MCPServer[] = [
  { id: 's-filesystem', name: 'filesystem', description: '本地文件系统读写', command: 'npx -y @modelcontextprotocol/server-filesystem', args: 'E:\\\\MCPShare', version: '1.2.0', transport: 'stdio', partitionId: 'p-dev', status: 'running', archived: false, createdAt: now - 80 * DAY },
  { id: 's-git', name: 'git-tools', description: 'Git 仓库操作与提交分析', command: 'npx -y @modelcontextprotocol/server-git', args: '--repo .', version: '0.9.3', transport: 'stdio', partitionId: 'p-dev', status: 'running', archived: false, createdAt: now - 75 * DAY },
  { id: 's-sqlite', name: 'sqlite', description: 'SQLite 数据库查询', command: 'npx -y @modelcontextprotocol/server-sqlite', args: '--db ./data/app.db', version: '1.1.1', transport: 'stdio', partitionId: 'p-data', status: 'running', archived: false, createdAt: now - 70 * DAY },
  { id: 's-fetch', name: 'fetch', description: '网页抓取与内容提取', command: 'uvx mcp-server-fetch', args: '', version: '2.0.4', transport: 'stdio', partitionId: 'p-ext', status: 'running', archived: false, createdAt: now - 55 * DAY },
  { id: 's-brave', name: 'brave-search', description: 'Brave 网页搜索', command: 'npx -y @modelcontextprotocol/server-brave-search', args: '', version: '1.0.2', transport: 'stdio', partitionId: 'p-ext', status: 'stopped', archived: false, createdAt: now - 50 * DAY },
  { id: 's-github', name: 'github', description: 'GitHub Issue / PR 管理', command: 'npx -y @modelcontextprotocol/server-github', args: '', version: '3.4.0', transport: 'streamable-http', partitionId: 'p-ext', status: 'running', archived: false, createdAt: now - 40 * DAY },
  { id: 's-memory', name: 'memory', description: '知识图谱记忆服务', command: 'npx -y @modelcontextprotocol/server-memory', args: '', version: '1.3.0', transport: 'stdio', partitionId: 'p-data', status: 'crashed', archived: false, createdAt: now - 30 * DAY },
  { id: 's-puppeteer', name: 'puppeteer', description: '浏览器自动化（旧）', command: 'npx -y @modelcontextprotocol/server-puppeteer', args: '', version: '0.5.0', transport: 'stdio', partitionId: 'p-legacy', status: 'stopped', archived: true, createdAt: now - 180 * DAY },
]

const ENDPOINTS = ['tools/list', 'tools/call', 'resources/read', 'prompts/get', 'resources/list']
const TOOLS: Record<string, string[]> = {
  's-filesystem': ['read_file', 'write_file', 'list_directory', 'move_file'],
  's-git': ['git_log', 'git_diff', 'git_commit', 'git_branch'],
  's-sqlite': ['query', 'list_tables', 'schema'],
  's-fetch': ['fetch', 'fetch_raw'],
  's-brave': ['brave_web_search', 'brave_news_search'],
  's-github': ['create_issue', 'list_issues', 'create_pull_request', 'search_code'],
  's-memory': ['create_entities', 'add_observations', 'search_nodes'],
  's-puppeteer': ['navigate', 'screenshot', 'click'],
}
const CLIENTS = ['Kimi Desktop', 'Claude Desktop', 'Cursor', 'VS Code', 'Cline', '自研 Agent']

/** 生成过去 14 天、按小时聚合的访问日志 */
export function seedAccessLogs(): AccessLog[] {
  const logs: AccessLog[] = []
  const activeServers = seedServers.filter((s) => !s.archived)
  for (let d = 14; d >= 1; d--) {
    for (let h = 0; h < 24; h++) {
      const ts = now - d * DAY + h * HOUR + Math.floor(rnd() * HOUR)
      // 工作时间权重更高
      const workBoost = h >= 9 && h <= 21 ? 1.8 : 0.5
      for (const s of activeServers) {
        if (s.status === 'stopped' && rnd() < 0.85) continue
        if (s.status === 'crashed' && rnd() < 0.6) continue
        const base = s.status === 'running' ? 6 : 2
        const count = Math.max(0, Math.round(base * workBoost * rnd()))
        if (count === 0) continue
        logs.push({
          ts,
          serverId: s.id,
          endpoint: pick(ENDPOINTS),
          client: pick(CLIENTS),
          tool: pick(TOOLS[s.id] ?? ['unknown']),
          ok: rnd() > 0.04,
          latencyMs: Math.round(20 + rnd() * 480),
          count,
        } as AccessLog)
      }
    }
  }
  return logs.sort((a, b) => a.ts - b.ts)
}

const CRASH_REASONS = ['进程退出码 1', '端口占用 EADDRINUSE', 'JSON-RPC 解析失败', '内存超限 OOM', '凭证校验失败连续 5 次']

export function seedCrashLogs(): CrashLog[] {
  const logs: CrashLog[] = []
  const crashy = ['s-memory', 's-sqlite', 's-github']
  for (let d = 14; d >= 1; d--) {
    const n = Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      logs.push({
        ts: now - d * DAY + Math.floor(rnd() * DAY),
        serverId: pick(crashy),
        reason: pick(CRASH_REASONS),
      })
    }
  }
  return logs.sort((a, b) => a.ts - b.ts)
}

export const seedCredentials: Credential[] = [
  { id: 'c-1', name: 'Kimi 桌面端', keyPrefix: 'mcpsk_live_7f3a', scopes: ['p-dev', 'p-data'], rateLimitPerMin: 600, enabled: true, createdAt: now - 70 * DAY, expiresAt: null, lastUsedAt: now - 3600_000 },
  { id: 'c-2', name: 'CI 流水线', keyPrefix: 'mcpsk_live_11bd', scopes: ['p-dev'], rateLimitPerMin: 120, enabled: true, createdAt: now - 60 * DAY, expiresAt: now + 30 * DAY, lastUsedAt: now - 86400_000 },
  { id: 'c-3', name: '数据组只读', keyPrefix: 'mcpsk_live_9c21', scopes: ['p-data'], rateLimitPerMin: 300, enabled: true, createdAt: now - 45 * DAY, expiresAt: null, lastUsedAt: now - 7200_000 },
  { id: 'c-4', name: '外部合作方 A', keyPrefix: 'mcpsk_test_3e77', scopes: ['p-ext'], rateLimitPerMin: 60, enabled: false, createdAt: now - 30 * DAY, expiresAt: now - 10 * DAY, lastUsedAt: now - 20 * DAY },
  { id: 'c-5', name: '内部管理台', keyPrefix: 'mcpsk_live_d402', scopes: ['p-dev', 'p-data', 'p-ext'], rateLimitPerMin: 1200, enabled: true, createdAt: now - 20 * DAY, expiresAt: null, lastUsedAt: now - 600_000 },
]

// AccessLog.count 为聚合次数字段（种子数据按小时桶聚合）
