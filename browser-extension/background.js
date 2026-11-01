import { ACCESS_LOG_ALARM, ensureAccessLogAlarm, syncAccessLogs } from './logs.js'

async function toggleInActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('未找到可钉住的当前标签页')
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  } catch {
    throw new Error('当前页面不支持钉住，请打开普通 HTTP(S) 网页')
  }
  return chrome.tabs.sendMessage(tab.id, { type: 'mcpwindow-panel-toggle' })
}

// MV3 后台使用 alarms，弹窗关闭或 Service Worker 休眠后仍按 30 分钟周期唤醒。
void ensureAccessLogAlarm()
chrome.runtime.onInstalled.addListener(() => { void ensureAccessLogAlarm(); void syncAccessLogs() })
chrome.runtime.onStartup.addListener(() => { void ensureAccessLogAlarm(); void syncAccessLogs() })
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ACCESS_LOG_ALARM) void syncAccessLogs() })

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = message?.type === 'mcpwindow-access-logs-sync'
    ? syncAccessLogs()
    : message?.type === 'mcpwindow-panel-toggle'
      ? toggleInActiveTab()
      : message?.type === 'mcpwindow-panel-close' && sender.tab?.id
        ? chrome.tabs.sendMessage(sender.tab.id, { type: 'mcpwindow-panel-close' })
        : message?.type?.startsWith('mcpwindow-panel-drag-') && sender.tab?.id
          ? chrome.tabs.sendMessage(sender.tab.id, message)
          : null
  if (!task) return false
  task.then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: error.message || '扩展后台操作失败' }))
  return true
})
