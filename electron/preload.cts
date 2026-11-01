import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// 预加载脚本：暴露给渲染进程的最小安全 API
contextBridge.exposeInMainWorld('mcpwindow', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // 探测本地 stdio MCP 可执行文件是否存在
  probeLocal: (id: string, command: string) => ipcRenderer.invoke('mcpwindow:probe-local', id, command),
  probeHttp: (url: string, headers: Record<string, string>, timeoutMs: number) =>
    ipcRenderer.invoke('mcpwindow:probe-http', url, headers, timeoutMs),
  // 本地 MCP 进程托管
  procStart: (id: string, command: string, args: string | string[], env?: Record<string, string>) =>
    ipcRenderer.invoke('mcpwindow:proc-start', id, command, args, env),
  procStop: (id: string) => ipcRenderer.invoke('mcpwindow:proc-stop', id),
  procRestart: (id: string, command: string, args: string | string[], env?: Record<string, string>) =>
    ipcRenderer.invoke('mcpwindow:proc-restart', id, command, args, env),
  procList: () => ipcRenderer.invoke('mcpwindow:proc-list'),
  procMetrics: (ids: string[]) => ipcRenderer.invoke('mcpwindow:proc-metrics', ids),
  manageRequest: (url: string, key: string, method: string, body?: unknown) =>
    ipcRenderer.invoke('mcpwindow:manage-request', url, key, method, body),
  selectDirectory: () => ipcRenderer.invoke('mcpwindow:select-directory'),
  saveTextFile: (defaultName: string, content: string) => ipcRenderer.invoke('mcpwindow:save-text-file', defaultName, content),
  accessLogsDiscover: (server: { id: string; name: string; command: string; args: string; argList?: string[] }) =>
    ipcRenderer.invoke('mcpwindow:access-logs-discover', server),
  accessLogsRead: (server: { id: string; name: string; command: string; args: string; argList?: string[] }) =>
    ipcRenderer.invoke('mcpwindow:access-logs-read', server),
  pluginList: () => ipcRenderer.invoke('mcpwindow:plugin-list'),
  pluginImport: (sourceDirectory: string) => ipcRenderer.invoke('mcpwindow:plugin-import', sourceDirectory),
  pluginRemove: (id: string) => ipcRenderer.invoke('mcpwindow:plugin-remove', id),
  pluginSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('mcpwindow:plugin-set-enabled', id, enabled),
  pluginCall: (id: string, tool: string, args: unknown) => ipcRenderer.invoke('mcpwindow:plugin-call', id, tool, args),
  pluginCheckUpdate: (id: string) => ipcRenderer.invoke('mcpwindow:plugin-check-update', id),
  pluginTrustList: () => ipcRenderer.invoke('mcpwindow:plugin-trust-list'),
  pluginTrustAdd: (directory: string) => ipcRenderer.invoke('mcpwindow:plugin-trust-add', directory),
  pluginTrustRemove: (directory: string) => ipcRenderer.invoke('mcpwindow:plugin-trust-remove', directory),
  pluginHostResult: (id: string, ok: boolean, result?: unknown, error?: string) =>
    ipcRenderer.send('mcpwindow:plugin-host-result', id, ok, result, error),
  onPluginHostCall: (cb: (id: string, action: string, args: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, id: string, action: string, args: unknown) => cb(id, action, args)
    ipcRenderer.on('mcpwindow:plugin-host-call', listener)
    return () => ipcRenderer.removeListener('mcpwindow:plugin-host-call', listener)
  },
  // 使用 Windows DPAPI / macOS Keychain / Linux Secret Service 加密本机持久化数据
  secureStorage: {
    isAvailable: () => ipcRenderer.invoke('mcpwindow:secure-storage-available'),
    encrypt: (value: string) => ipcRenderer.invoke('mcpwindow:secure-storage-encrypt', value),
    decrypt: (value: string) => ipcRenderer.invoke('mcpwindow:secure-storage-decrypt', value),
  },
  onProcExit: (cb: (id: string, code: number | null) => void) => {
    const listener = (_e: IpcRendererEvent, id: string, code: number | null) => cb(id, code)
    ipcRenderer.on('mcpwindow:proc-exit', listener)
    return () => ipcRenderer.removeListener('mcpwindow:proc-exit', listener)
  },
})
