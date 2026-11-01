import { useEffect } from 'react'
import { useLanguage, type Language } from '../store/useLanguage'
import { ENGLISH } from './en'

const DYNAMIC: Array<[RegExp, (...values: string[]) => string]> = [
  [/^运行中 (\d+) · 异常 (\d+)$/, (running, issues) => `Running ${running} · Issues ${issues}`],
  [/^MCP 集群运行状态一览 · (\d+) 个分区$/, (count) => `MCP cluster status · ${count} partitions`],
  [/^崩溃 (\d+) · 停止 (\d+) · 未确认 (\d+)$/, (crashed, stopped, unknown) => `Crashed ${crashed} · Stopped ${stopped} · Unconfirmed ${unknown}`],
  [/^近 7 天 (.+) 次$/, (count) => `${count} in the last 7 days`],
  [/^共 (\d+) 个 · 已过期未停用 (\d+) · 平均延迟 (\d+)ms$/, (total, expired, latency) => `${total} total · ${expired} expired but enabled · Avg ${latency} ms`],
  [/^服务器 (.+) 崩溃：(.+)$/, (server, reason) => `${server} crashed: ${reason}`],
  [/^共 (\d+) 个分区$/, (count) => `${count} partitions`],
  [/^服务器 (\d+)$/, (count) => `Servers ${count}`],
  [/^关联凭证 (\d+)$/, (count) => `Credentials ${count}`],
  [/^创建 (.+)$/, (date) => `Created ${date}`],
  [/^共 (\d+) 个 · 点击进入详情$/, (count) => `${count} total · Select a server for details`],
  [/^24h 访问 (.+)$/, (count) => `24h requests ${count}`],
  [/^近 14 天总访问 (.+) 次$/, (count) => `${count} requests in 14 days`],
  [/^崩溃记录（(\d+) 条近期）$/, (count) => `Crash records (${count} recent)`],
  [/^可访问凭证（(\d+)）$/, (count) => `Accessible credentials (${count})`],
  [/^当前提供方（(\d+)）$/, (count) => `Current provider (${count})`],
  [/^接入于 (.+)$/, (date) => `Added ${date}`],
  [/^成功 ×(\d+)$/, (count) => `Success ×${count}`],
  [/^远程管理：(.+)，操作结果以服务器响应和状态回读为准$/, (url) => `Management: ${url}. Results are verified against server responses and status.`],
  [/^(.+)(启动|停止|重启)成功，已核实真实运行状态$/, (server, action) => `${server} ${{ 启动: 'start', 停止: 'stop', 重启: 'restart' }[action]} succeeded; actual state verified`],
  [/^已导入 (\d+) 个服务器(?:（跳过重复 (\d+) 个）)?$/, (added, skipped) => `Imported ${added} servers${skipped ? ` · Skipped ${skipped} duplicates` : ''}`],
  [/^已(启用|停用)凭证 (.+)$/, (action, name) => `${action === '启用' ? 'Enabled' : 'Disabled'} credential ${name}`],
  [/^服务器 (.+) 已确认(创建分区|删除分区|更新凭证|发放凭证|吊销凭证) (.+)$/, (server, action, name) => `${server} confirmed ${{ 创建分区: 'created partition', 删除分区: 'deleted partition', 更新凭证: 'updated credential', 发放凭证: 'issued credential', 吊销凭证: 'revoked credential' }[action]} ${name}`],
  [/^已删除本地凭证 (.+)$/, (name) => `Deleted local credential ${name}`],
  [/^(操作失败|删除失败|解析失败|请求失败|网络请求出错)：(.+)$/s, (label, detail) => `${{ 操作失败: 'Operation failed', 删除失败: 'Deletion failed', 解析失败: 'Parsing failed', 请求失败: 'Request failed', 网络请求出错: 'Network error' }[label]}: ${detail}`],
  [/^连接正常，已获取 (\d+) 个模型，可在对话区下拉切换$/, (count) => `Connected. Loaded ${count} models; select one above the chat.`],
  [/^配置已保存，但连接失败：(.+)$/s, (detail) => `Configuration saved, but connection failed: ${detail}`],
  [/^正在使用 (.+) 思考…$/, (model) => `Thinking with ${model}…`],
  [/^将删除“(.+)”及其本机 API Key 和模型目录，不影响其他提供方。$/, (name) => `Delete “${name}”, its local API key and model list. Other providers are unaffected.`],
  [/^共 (\d+) 台，正常 (\d+) 台，异常 (\d+) 台$/, (total, online, issues) => `${total} total · ${online} healthy · ${issues} issues`],
  [/^备份合并完成：新增 (\d+) 个分区、(\d+) 台服务器，跳过 (\d+) 项冲突$/, (partitions, servers, skipped) => `Backup merged: ${partitions} partitions and ${servers} servers added; ${skipped} conflicts skipped`],
  [/^(导出失败|导入失败|权限验证失败)：(.+)$/s, (label, detail) => `${{ 导出失败: 'Export failed', 导入失败: 'Import failed', 权限验证失败: 'Access verification failed' }[label]}: ${detail}`],
  [/^第 (\d+) \/ (\d+) 页$/, (page, count) => `Page ${page} of ${count}`],
]

export function translateText(value: string, language: Language): string {
  if (language === 'zh' || !value) return value
  const leading = value.match(/^\s*/)?.[0] ?? ''
  const trailing = value.match(/\s*$/)?.[0] ?? ''
  const source = value.slice(leading.length, value.length - trailing.length)
  if (!source) return value
  if (ENGLISH[source]) return `${leading}${ENGLISH[source]}${trailing}`
  for (const [pattern, format] of DYNAMIC) {
    const match = source.match(pattern)
    if (match) return `${leading}${format(...match.slice(1))}${trailing}`
  }
  return value
}

export function useTranslation() {
  const language = useLanguage((state) => state.language)
  return { language, t: (value: string) => translateText(value, language) }
}

interface LocalizedValue { source: string; applied: string }
const textValues = new WeakMap<Text, LocalizedValue>()
const attributeValues = new WeakMap<Element, Map<string, LocalizedValue>>()
const TRANSLATED_ATTRIBUTES = ['placeholder', 'aria-label', 'title']

function shouldSkip(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement
  return Boolean(element?.closest('code, pre, .mono, .server-cmd, .chat-msg.user, .tool-result, script, style'))
}

function localized(source: string, previous: LocalizedValue | undefined, current: string, language: Language): LocalizedValue {
  const original = previous && previous.applied === current ? previous.source : current
  return { source: original, applied: language === 'zh' ? original : translateText(original, language) }
}

function localizeTree(root: Node, language: Language): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const nodes: Node[] = [root]
  let current = walker.nextNode()
  while (current) {
    nodes.push(current)
    current = walker.nextNode()
  }
  for (const node of nodes) {
    if (shouldSkip(node)) continue
    if (node instanceof Text) {
      const previous = textValues.get(node)
      const currentValue = node.nodeValue ?? ''
      const next = localized(currentValue, previous, currentValue, language)
      textValues.set(node, next)
      if (currentValue !== next.applied) node.nodeValue = next.applied
    } else if (node instanceof Element) {
      let values = attributeValues.get(node)
      if (!values) {
        values = new Map()
        attributeValues.set(node, values)
      }
      for (const attribute of TRANSLATED_ATTRIBUTES) {
        if (!node.hasAttribute(attribute)) continue
        const currentValue = node.getAttribute(attribute) ?? ''
        const next = localized(currentValue, values.get(attribute), currentValue, language)
        values.set(attribute, next)
        if (currentValue !== next.applied) node.setAttribute(attribute, next.applied)
      }
    }
  }
}

/** Localizes legacy static views without touching user data or MCP payloads. */
export function I18nRuntime() {
  const language = useLanguage((state) => state.language)
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
    document.title = language === 'en' ? 'MCPWindow · MCP Server Console' : 'MCPWindow · MCP 服务器可视化管理台'
    // Portal 弹窗挂在 body 下，必须与主界面一起即时翻译。
    const root = document.body
    localizeTree(root, language)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') localizeTree(record.target, language)
        else if (record.type === 'attributes') localizeTree(record.target, language)
        else record.addedNodes.forEach((node) => localizeTree(node, language))
      }
    })
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: TRANSLATED_ATTRIBUTES })
    return () => observer.disconnect()
  }, [language])
  return null
}
