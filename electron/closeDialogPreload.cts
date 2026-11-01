import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('closeDialog', {
  choose: (choice: 'apply' | 'cancel') => {
    const selected = (document.querySelector('input[name="close-action"]:checked') as HTMLInputElement | null)?.value
    ipcRenderer.send('mcpwindow:close-choice', choice === 'apply' ? selected : 'cancel')
  },
})
