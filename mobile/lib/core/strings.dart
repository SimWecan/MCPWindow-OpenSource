import 'package:flutter/widgets.dart';

/// 轻量中英双语文案：跟随应用语言设置（可在设置页强制中/英），默认中文。
/// 动态文案用 {key} 占位符，例如 tr(context, '共 {n} 台', {'n': '3'})。
class S {
  S(this._locale);

  final Locale _locale;

  static S of(BuildContext context) =>
      S(Localizations.localeOf(context));

  bool get isEn => _locale.languageCode.toLowerCase().startsWith('en');

  /// zh → en 文案表；未收录时回退中文。
  static const Map<String, String> _en = {
    // 导航
    '总览': 'Overview',
    '服务器': 'Servers',
    '告警': 'Alerts',
    '审批': 'Approvals',
    '设置': 'Settings',
    // 总览
    '刷新': 'Refresh',
    '关键状态': 'Key status',
    '在线服务器': 'Online servers',
    '需凭证': 'Credentials',
    '离线服务器': 'Offline',
    '待处理': 'Pending',
    '共 {n} 台': '{n} in total',
    '等待有效认证': 'Awaiting valid auth',
    '今日崩溃 {n} 次': '{n} crashes today',
    '告警 {a} · 审批 {p}': 'Alerts {a} · Approvals {p}',
    '等待审批': 'Pending approvals',
    '最新告警': 'Latest alerts',
    '查看全部': 'View all',
    '异常服务器': 'Abnormal servers',
    '管理': 'Manage',
    '当前没有离线或需凭证的服务器':
        'No offline or credential-pending servers',
    '还没有 MCP 服务器': 'No MCP servers yet',
    '点击右下角添加，或在服务器页导入 mcp.json。':
        'Add one via the button, or import mcp.json on the Servers page.',
    '暂时无法获取状态': 'Status temporarily unavailable',
    // 状态与操作
    '在线': 'Online',
    '离线': 'Offline',
    '启动': 'Start',
    '停止': 'Stop',
    '重启': 'Restart',
    '删除': 'Delete',
    '提示': 'Info',
    '警告': 'Warning',
    '严重': 'Critical',
    '已读': 'read',
    '待审批': 'Pending',
    '已批准': 'Approved',
    '已拒绝': 'Rejected',
    // 服务器页
    '添加': 'Add',
    '搜索名称、描述、地址或分区':
        'Search name, description, address or partition',
    '清除': 'Clear',
    '全部': 'All',
    '没有匹配的服务器': 'No matching servers',
    '调整搜索或状态筛选，也可以添加新的 MCP 服务器。':
        'Adjust search or filters, or add a new MCP server.',
    '服务器操作': 'Server actions',
    '已请求启动 {name}': 'Start requested for {name}',
    '已请求停止 {name}': 'Stop requested for {name}',
    '已请求重启 {name}': 'Restart requested for {name}',
    '已删除 {name}': '{name} deleted',
    '删除服务器': 'Delete server',
    '将从 MCPWindow 移除“{name}”。如果该服务正在运行，桌面端会先执行受控停止。':
        'This removes “{name}” from MCPWindow. If running, the desktop stops it gracefully first.',
    '取消': 'Cancel',
    '操作失败：': 'Operation failed: ',
    // 告警页
    '全部已读': 'Mark all read',
    '暂无告警': 'No alerts',
    '服务器离线、凭证到期和高风险操作会在这里提醒。':
        'Offline servers, expiring credentials and high-risk actions appear here.',
    // 审批页
    '暂无审批请求': 'No pending approvals',
    '桌面端发起高风险操作时会在这里等待确认。':
        'High-risk operations from the desktop wait for confirmation here.',
    '拒绝': 'Reject',
    '批准': 'Approve',
    '批准操作': 'Approve action',
    '拒绝操作': 'Reject action',
    '将批准对“{name}”的{action}请求。':
        'Approve the {action} request for “{name}”.',
    '将拒绝对“{name}”的{action}请求。':
        'Reject the {action} request for “{name}”.',
    '确认': 'Confirm',
    // 设置页
    '桌面端连接': 'Desktop connection',
    '尚未连接': 'Not connected',
    '已保存桌面端地址': 'Desktop address saved',
    '已连接桌面端': 'Connected to desktop',
    '连接桌面端': 'Connect desktop',
    '桌面端管理地址': 'Desktop address',
    '例如 http://192.168.1.20:42101': 'e.g. http://192.168.1.20:42101',
    '配对访问令牌': 'Pairing token',
    '令牌仅保存在本机安全存储中':
        'The token is stored only in local secure storage',
    '从剪贴板智能识别': 'Smart-parse clipboard',
    '已识别并填入配对信息': 'Pairing info detected and filled in',
    '剪贴板中没有可识别的配对信息': 'No recognizable pairing info in clipboard',
    '测试连接': 'Test connection',
    '连接成功': 'Connection succeeded',
    '连接失败': 'Connection failed',
    '连接失败：地址为空': 'Connection failed: address is empty',
    '保存连接': 'Save connection',
    '断开连接': 'Disconnect',
    '已清除桌面端连接，当前使用演示数据。':
        'Desktop connection cleared; demo data in use.',
    '连接信息已保存': 'Connection info saved',
    '使用演示数据': 'Demo data',
    '桌面端': 'Desktop',
    '在 MCPWindow 桌面端打开“移动端配对”并开启配对服务，然后扫码或粘贴配对信息到此处。':
        'Open “Mobile pairing” in the MCPWindow desktop app, enable the service, then paste the pairing info here.',
    '当前数据来自': 'Current data source',
    '主题': 'Theme',
    '语言': 'Language',
    '跟随系统': 'System default',
    '中文': '中文',
    // 服务器详情
    '远程操作': 'Remote actions',
    '同步状态': 'Sync status',
    '分区': 'Partition',
    '传输方式': 'Transport',
    '连接配置': 'Endpoint',
    '认证方式': 'Auth',
    '最近心跳': 'Last heartbeat',
    '暂无描述': 'No description',
    '未配置': 'Not configured',
    '暂无记录': 'No records',
    '远程操作会提交到桌面端执行；实际生产环境会按服务器策略执行审批、审计和失败回执。':
        'Remote actions are submitted to the desktop; production policies apply approval, audit and failure receipts.',
    '无': 'None',
    // 添加服务器
    '添加服务器': 'Add server',
    '手动添加': 'Manual',
    '导入 mcp.json': 'Import mcp.json',
    '服务器名称': 'Server name',
    '请输入名称': 'Please enter a name',
    '描述': 'Description',
    '启动命令': 'Startup command',
    '服务器地址': 'Server URL',
    '实际启动仍由桌面端执行': 'Startup is still executed by the desktop',
    '例如 https://example.com/mcp': 'e.g. https://example.com/mcp',
    '请输入连接配置': 'Please enter the connection config',
    '保存并同步到桌面端': 'Save & sync to desktop',
    '正在保存…': 'Saving…',
    '粘贴包含 mcpServers 的配置文本，移动端会识别名称、stdio 命令、远程地址、认证请求头和环境变量，然后提交桌面端保存。':
        'Paste config text containing mcpServers. Names, stdio commands, remote URLs, auth headers and env vars are recognized, then synced to the desktop.',
    'mcp.json 内容': 'mcp.json content',
    '识别并同步': 'Detect & sync',
    '导入失败：': 'Import failed: ',
    '保存失败：': 'Save failed: ',
    '已同步 {n} 台服务器到桌面端': 'Synced {n} server(s) to the desktop',
    // 相对时间
    '刚刚': 'Just now',
    '{n} 分钟前': '{n} min ago',
    '{n} 小时前': '{n} h ago',
    '{n} 天前': '{n} d ago',
    // 扫码配对
    '扫码配对': 'Scan QR code',
    '对准桌面端“移动端配对”中显示的二维码':
        'Align the QR code shown in “Mobile pairing” on the desktop',
    '无法识别该二维码，请扫描桌面端的配对二维码':
        'Unrecognized QR code. Please scan the desktop pairing QR.',
    '请在系统设置中允许 MCPWindow 使用相机后再试。':
        'Allow MCPWindow to use the camera in system settings, then try again.',
    '未能打开相机': 'Could not start the camera',
    '切换镜头': 'Switch camera',
    '开灯': 'Torch on',
    '关灯': 'Torch off',
    '重试': 'Retry',
  };

  String call(String zh, [Map<String, String> params = const {}]) {
    final template = isEn ? (_en[zh] ?? zh) : zh;
    return _fill(template, params);
  }

  static String _fill(String template, Map<String, String> params) {
    if (params.isEmpty) return template;
    var result = template;
    params.forEach((key, value) {
      result = result.replaceAll('{$key}', value);
    });
    return result;
  }
}

/// 页面文案快捷入口：tr(context, '中文模板', {'n': '3'})。
String tr(BuildContext context, String zh, [Map<String, String> params = const {}]) =>
    S.of(context)(zh, params);

/// 当前界面是否英文。
bool isEnOf(BuildContext context) => S.of(context).isEn;
