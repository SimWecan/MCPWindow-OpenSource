import '../models/alert.dart';
import '../models/approval.dart';
import '../models/dashboard.dart';
import '../models/mobile_snapshot.dart';
import '../models/server.dart';
import 'mobile_repository.dart';

class MockMobileRepository implements MobileRepository {
  MockMobileRepository() {
    final now = DateTime.now();
    _servers = [
      McpServer(
        id: 'demo-files',
        name: '文件检索服务',
        description: '本地文档索引与检索',
        partition: '生产效率',
        transport: ServerTransport.stdio,
        status: ServerStatus.online,
        endpoint: 'node servers/files/dist/index.js',
        lastSeen: now.subtract(const Duration(seconds: 12)),
        favorite: true,
      ),
      McpServer(
        id: 'demo-weather',
        name: '天气查询服务',
        description: '远程 HTTP MCP 示例',
        partition: '外部服务',
        transport: ServerTransport.streamableHttp,
        status: ServerStatus.needsCredentials,
        endpoint: 'https://mcp.example.com/weather',
        credentialType: CredentialType.apiKey,
        lastSeen: now.subtract(const Duration(minutes: 8)),
      ),
      McpServer(
        id: 'demo-database',
        name: '数据库查询服务',
        description: '业务数据库只读查询',
        partition: '基础设施',
        transport: ServerTransport.stdio,
        status: ServerStatus.offline,
        endpoint: 'python database/server.py',
        lastSeen: now.subtract(const Duration(hours: 3)),
      ),
    ];
    _alerts = [
      AlertItem(
        id: 'alert-offline-database',
        title: '服务器离线',
        message: '数据库查询服务已连续 3 小时无心跳。',
        severity: AlertSeverity.critical,
        createdAt: now.subtract(const Duration(hours: 3)),
      ),
      AlertItem(
        id: 'alert-credential-weather',
        title: '凭证即将到期',
        message: '天气查询服务的 API Key 将在 3 天后到期。',
        severity: AlertSeverity.warning,
        createdAt: now.subtract(const Duration(hours: 1)),
      ),
    ];
    _approvals = [
      ApprovalItem(
        id: 'approval-restart-files',
        serverId: 'demo-files',
        serverName: '文件检索服务',
        action: ApprovalAction.restart,
        requestedBy: '运维值班账号',
        reason: '升级索引组件后需要重启服务。',
        createdAt: now.subtract(const Duration(minutes: 18)),
      ),
    ];
  }

  late List<McpServer> _servers;
  late List<AlertItem> _alerts;
  late List<ApprovalItem> _approvals;
  int _nextId = 1;

  @override
  Future<MobileSnapshot> load() async {
    await Future<void>.delayed(const Duration(milliseconds: 220));
    return MobileSnapshot(
      summary: _buildSummary(),
      servers: List.unmodifiable(_servers),
      alerts: List.unmodifiable(_alerts),
      approvals: List.unmodifiable(_approvals),
    );
  }

  @override
  Future<McpServer> addServer(McpServer server) async {
    final saved = server.id.isEmpty
        ? server.copyWith(
            id: 'mobile-${DateTime.now().millisecondsSinceEpoch}-${_nextId++}',
          )
        : server;
    _servers = [..._servers, saved];
    return saved;
  }

  @override
  Future<void> removeServer(String serverId) async {
    _servers = _servers.where((server) => server.id != serverId).toList();
  }

  @override
  Future<void> updateServerStatus(String serverId, ServerStatus status) async {
    _servers = [
      for (final server in _servers)
        if (server.id == serverId)
          server.copyWith(status: status, lastSeen: DateTime.now())
        else
          server,
    ];
  }

  @override
  Future<void> restartServer(String serverId) =>
      updateServerStatus(serverId, ServerStatus.online);

  @override
  Future<void> markAllAlertsRead() async {
    _alerts = [
      for (final alert in _alerts)
        AlertItem(
          id: alert.id,
          title: alert.title,
          message: alert.message,
          severity: alert.severity,
          createdAt: alert.createdAt,
          read: true,
        ),
    ];
  }

  @override
  Future<void> respondToApproval(String approvalId, bool approved) async {
    _approvals = [
      for (final approval in _approvals)
        if (approval.id == approvalId)
          ApprovalItem(
            id: approval.id,
            serverId: approval.serverId,
            serverName: approval.serverName,
            action: approval.action,
            requestedBy: approval.requestedBy,
            reason: approval.reason,
            createdAt: approval.createdAt,
            status: approved
                ? ApprovalStatus.approved
                : ApprovalStatus.rejected,
          )
        else
          approval,
    ];
  }

  DashboardSummary _buildSummary() {
    final online = _servers
        .where((server) => server.status == ServerStatus.online)
        .length;
    final needsCredentials = _servers
        .where((server) => server.status == ServerStatus.needsCredentials)
        .length;
    final offline = _servers
        .where((server) => server.status == ServerStatus.offline)
        .length;
    return DashboardSummary(
      online: online,
      needsCredentials: needsCredentials,
      offline: offline,
      crashesToday: 2,
      unreadAlerts: _alerts.where((alert) => !alert.read).length,
      pendingApprovals: _approvals
          .where((approval) => approval.status == ApprovalStatus.pending)
          .length,
    );
  }
}
