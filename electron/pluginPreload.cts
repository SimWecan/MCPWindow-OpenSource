import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('mcpPluginHost', {
  invoke: (action: string, args: unknown) => ipcRenderer.invoke('mcpwindow:plugin-host-invoke', action, args),
})
