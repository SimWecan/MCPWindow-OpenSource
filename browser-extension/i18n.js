const messages = {
  '远程 MCP 状态中心': 'Remote MCP Status Center',
  '联系开发者': 'Contact developer',
  '钉在当前网页': 'Pin to this page',
  '取消钉住': 'Unpin panel',
  '刷新全部': 'Refresh all',
  '拖动标题区移动窗口': 'Drag the title bar to move',
  '正在读取服务器…': 'Loading servers…',
  '尚未添加远程 MCP 服务器': 'No remote MCP servers yet',
  '搜索名称或地址': 'Search name or URL',
  '搜索服务器': 'Search servers',
  '按状态筛选': 'Filter by status',
  '全部状态': 'All statuses',
  '在线': 'Online',
  '需凭证': 'Credentials required',
  '离线': 'Offline',
  '待探测': 'Not probed',
  '服务器排序': 'Sort servers',
  '自定义顺序': 'Custom order',
  '按名称': 'By name',
  '按状态': 'By status',
  '按最近探测': 'By latest probe',
  '点击卡片查看详情 · 自定义顺序且无筛选时长按拖动排序': 'Open a card for details · Long-press to reorder in unfiltered custom order',
  '没有符合条件的服务器': 'No matching servers',
  '服务器操作记录': 'Server activity',
  '清空记录': 'Clear history',
  '暂无操作记录': 'No activity yet',
  '添加': 'Add',
  '删除': 'Delete',
  '探测': 'Probe',
  '日志设置': 'Log settings',
  '✦ 智能识别 mcp.json': '✦ Smart mcp.json import',
  '粘贴 JSON 配置，仅在本地识别并填写': 'Paste JSON to parse and fill locally',
  '智能识别并填写': 'Parse and fill',
  '＋ 添加远程 MCP': '＋ Add remote MCP',
  '名称': 'Name',
  '我的 MCP': 'My MCP',
  '服务器地址': 'Server URL',
  '认证方式': 'Authentication',
  '无需认证': 'No authentication',
  '用户名': 'Username',
  'API Key 请求头': 'API Key header',
  '凭证': 'Credential',
  '访问日志同步（可选）': 'Access log sync (optional)',
  '日志管理接口': 'Log management URL',
  '管理 admin 凭证': 'Management admin credential',
  '留空则使用普通访问凭证': 'Leave blank to use the access credential',
  '保存并探测': 'Save and probe',
  '仅支持 HTTP(S) MCP。识别过程不会联网；凭证仅保存在当前浏览器扩展存储中。': 'HTTP(S) MCP only. Parsing is offline; credentials stay in this browser extension’s local storage.',
  '← 返回服务器列表': '← Back to servers',
  '最近探测结果': 'Latest probe result',
  '最近探测时间': 'Latest probe time',
  '访问日志': 'Access logs',
  '每 30 分钟同步': 'Sync every 30 minutes',
  '24 小时访问': '24-hour requests',
  '14 天访问': '14-day requests',
  '24 小时成功率': '24-hour success rate',
  '14 天访问趋势': '14-day request trend',
  '24 小时访问分布': '24-hour request distribution',
  '热门访问端点': 'Top endpoints',
  '日志接口设置': 'Log endpoint settings',
  '留空保持当前凭证配置': 'Leave blank to keep current credentials',
  '保存日志设置并同步': 'Save log settings and sync',
  '重新探测并同步日志': 'Probe again and sync logs',
  '详情不会展示已保存的凭证。长按列表卡片可调整顺序。': 'Saved credentials are never shown. Long-press a card to reorder.',
  '尚未探测': 'Not probed yet',
  '查看安装方式': 'Installation',
}

export function translate(text, language = 'zh') {
  return language === 'en' ? messages[text] || text : text
}

export function applyTranslations(root, language = 'zh') {
  const doc = root.ownerDocument || root
  doc.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
  const walker = doc.createTreeWalker(root, 4)
  const textNodes = []
  while (walker.nextNode()) textNodes.push(walker.currentNode)
  textNodes.forEach(node => {
    if (!node.originalZh) node.originalZh = node.nodeValue
    const leading = node.originalZh.match(/^\s*/)[0]
    const trailing = node.originalZh.match(/\s*$/)[0]
    const core = node.originalZh.trim()
    node.nodeValue = core ? `${leading}${translate(core, language)}${trailing}` : node.originalZh
  })
  root.querySelectorAll('[placeholder], [title], [aria-label]').forEach(element => {
    for (const attribute of ['placeholder', 'title', 'aria-label']) {
      if (!element.hasAttribute(attribute)) continue
      const originalKey = `originalZh-${attribute}`
      if (!element[originalKey]) element[originalKey] = element.getAttribute(attribute)
      element.setAttribute(attribute, translate(element[originalKey], language))
    }
  })
}
