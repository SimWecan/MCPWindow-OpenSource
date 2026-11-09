import type { LiveStatus } from '../types'

export interface BridgeApi {
  platform?: string
  updateDownload?: (artifact: import('./updateCheck').UpdateArtifact) => Promise<boolean>
  onUpdateProgress?: (cb: (progress: { received: number; total: number }) => void) => () => void
  probeLocal?: (id: string, command: string) => Promise<LiveStatus>
  probeHttp?: (url: string, headers: Record<string, string>, timeoutMs: number) => Promise<{ status: number; body: string }>
  procStart?: (id: string, command: string, args: string | string[], env?: Record<string, string>) => Promise<boolean>
  procStop?: (id: string) => Promise<boolean>
  procRestart?: (id: string, command: string, args: string | string[], env?: Record<string, string>) => Promise<boolean>
  procList?: () => Promise<string[]>
  procMetrics?: (ids: string[]) => Promise<import('../types').ServerResourceMetric[]>
  manageRequest?: (url: string, key: string, method: string, body?: unknown) => Promise<{ status: number; body: unknown }>
  selectDirectory?: () => Promise<string | null>
  saveTextFile?: (defaultName: string, content: string) => Promise<boolean>
  accessLogsDiscover?: (server: Pick<import('../types').MCPServer, 'id' | 'name' | 'command' | 'args' | 'argList'>) => Promise<import('../types').LocalAccessLogResult>
  accessLogsRead?: (server: Pick<import('../types').MCPServer, 'id' | 'name' | 'command' | 'args' | 'argList'>) => Promise<import('../types').LocalAccessLogResult>
  pluginList?: () => Promise<import('../types').ToolPlugin[]>
  pluginImport?: (sourceDirectory: string) => Promise<import('../types').ToolPlugin>
  pluginRemove?: (id: string) => Promise<boolean>
  pluginSetEnabled?: (id: string, enabled: boolean) => Promise<import('../types').ToolPlugin>
  pluginCall?: (id: string, tool: string, args: unknown) => Promise<unknown>
  pluginCheckUpdate?: (id: string) => Promise<import('../types').PluginUpdateResult>
  pluginTrustList?: () => Promise<string[]>
  pluginTrustAdd?: (directory: string) => Promise<string[]>
  pluginTrustRemove?: (directory: string) => Promise<string[]>
  pluginHostResult?: (id: string, ok: boolean, result?: unknown, error?: string) => void
  onPluginHostCall?: (cb: (id: string, action: string, args: unknown) => void) => () => void
  onProcExit?: (cb: (id: string, code: number | null) => void) => () => void
  pairingStatus?: () => Promise<import('./pairing').PairingStatus>
  pairingSetEnabled?: (enabled: boolean) => Promise<import('./pairing').PairingStatus>
  pairingRegenerateToken?: () => Promise<import('./pairing').PairingStatus>
  pairingSync?: (snapshot: unknown) => Promise<{ ok: boolean; devices: number }>
  pairingCommandResult?: (id: string, result: { ok: boolean; error?: string }) => void
  onPairingCommand?: (cb: (id: string, method: string, params: Record<string, unknown>) => void) => () => void
  tunnelStatus?: () => Promise<TunnelStatus>
  tunnelStart?: (port: number) => Promise<TunnelStatus>
  tunnelStop?: () => Promise<TunnelStatus>
}

/** cloudflared quick tunnel 状态（远程访问链接）。 */
export interface TunnelStatus {
  running: boolean
  url?: string
  error?: string
}

/** Electron 预加载桥；浏览器预览和非浏览器测试环境返回 undefined。 */
export const bridge = (): BridgeApi | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { mcpwindow?: BridgeApi }).mcpwindow
