(() => {
  if (globalThis.__mcpWindowCompanionPanel) return
  globalThis.__mcpWindowCompanionPanel = true
  let host = null
  let drag = null
  let positionSave = Promise.resolve()

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max))
  async function savePosition() {
    if (!host) return
    const panelPosition = { left: host.offsetLeft, top: host.offsetTop }
    await chrome.storage.local.set({ panelPosition })
  }
  async function createPanel() {
    await positionSave
    const saved = await chrome.storage.local.get('panelPosition')
    const width = Math.min(520, window.innerWidth - 24)
    const height = Math.min(760, window.innerHeight - 24)
    const left = clamp(saved.panelPosition?.left ?? window.innerWidth - width - 20, 0, Math.max(0, window.innerWidth - width))
    const top = clamp(saved.panelPosition?.top ?? 20, 0, Math.max(0, window.innerHeight - height))
    host = document.createElement('div')
    host.id = 'mcpwindow-companion-panel'
    host.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:2147483647;contain:layout style;`
    const shadow = host.attachShadow({ mode: 'closed' })
    const frame = document.createElement('div')
    frame.style.cssText = 'width:100%;height:100%;border:1px solid #8060bd;border-radius:15px;overflow:hidden;background:#100d1c;box-shadow:0 18px 65px #0009;'
    const iframe = document.createElement('iframe')
    iframe.src = chrome.runtime.getURL('popup.html?embedded=1')
    iframe.title = 'MCPWindow MCP 管理面板'
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;'
    frame.append(iframe)
    shadow.append(frame)
    document.documentElement.append(host)
  }

  function closePanel() { host?.remove(); host = null; drag = null }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'mcpwindow-panel-close') { closePanel(); sendResponse({ pinned: false }); return }
    if (message?.type === 'mcpwindow-panel-drag-start' && host) {
      drag = { x: message.x, y: message.y, left: host.offsetLeft, top: host.offsetTop }
      sendResponse({ dragging: true })
      return
    }
    if (message?.type === 'mcpwindow-panel-drag-move' && host && drag) {
      const left = clamp(drag.left + message.x - drag.x, 0, window.innerWidth - host.offsetWidth)
      const top = clamp(drag.top + message.y - drag.y, 0, window.innerHeight - host.offsetHeight)
      host.style.left = `${left}px`
      host.style.top = `${top}px`
      sendResponse({ left, top })
      return
    }
    if (message?.type === 'mcpwindow-panel-drag-end') {
      drag = null
      positionSave = savePosition()
      positionSave.then(() => sendResponse({ dragging: false })).catch(() => sendResponse({ dragging: false }))
      return true
    }
    if (message?.type !== 'mcpwindow-panel-toggle') return
    if (host) { closePanel(); sendResponse({ pinned: false }); return }
    createPanel().then(() => sendResponse({ pinned: true })).catch(error => { closePanel(); sendResponse({ error: error.message }) })
    return true
  })
})()
