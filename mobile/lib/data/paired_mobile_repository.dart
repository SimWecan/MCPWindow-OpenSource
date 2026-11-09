import '../models/alert.dart';
import '../models/approval.dart';
import '../models/dashboard.dart';
import '../models/mobile_snapshot.dart';
import '../models/server.dart';
import 'mobile_api_client.dart';
import 'mobile_repository.dart';

/// 通过局域网配对服务连接桌面端的仓库实现。
///
/// 所有数据来自 MCPWindow 桌面端实时状态；写操作转发到桌面端执行后重新拉取快照。
class PairedMobileRepository implements MobileRepository {
  PairedMobileRepository(this._client);

  final MobileApiClient _client;

  @override
  Future<MobileSnapshot> load() async {
    final snapshot = await _client.fetchSnapshot();
    return parseSnapshot(snapshot);
  }

  /// 把桌面端快照 JSON（HTTP 或 WS 推送）解析为移动端模型。
  static MobileSnapshot parseSnapshot(Map<String, dynamic> snapshot) {
    return MobileSnapshot(
      summary: _parseSummary(snapshot['summary']),
      servers: _parseList(snapshot['servers'], _parseServer),
      alerts: _parseList(snapshot['alerts'], _parseAlert),
      approvals: _parseList(snapshot['approvals'], _parseApproval),
    );
  }

  @override
  Future<McpServer> addServer(McpServer server) async {
    final payload = <String, dynamic>{
      'name': server.name,
      'description': server.description,
      'transport': server.transport == ServerTransport.stdio
          ? 'stdio'
          : 'streamableHttp',
      // stdio 的“启动命令”存放在 endpoint 字段。
      'endpoint': server.endpoint,
      'command': server.transport == ServerTransport.stdio ? server.endpoint : '',
      'partition': server.partition,
    };
    await _client.addServer(payload);
    // 桌面端会分配新 id；重新加载获取权威数据。
    final fresh = await load();
    return fresh.servers.firstWhere(
      (item) => item.name == server.name,
      orElse: () => server,
    );
  }

  @override
  Future<void> removeServer(String serverId) => _client.deleteServer(serverId);

  @override
  Future<void> updateServerStatus(String serverId, ServerStatus status) async {
    switch (status) {
      case ServerStatus.online:
        await _client.startServer(serverId);
      case ServerStatus.offline:
        await _client.stopServer(serverId);
      case ServerStatus.needsCredentials:
        throw Exception('该状态由桌面端根据探测结果更新');
    }
  }

  @override
  Future<void> restartServer(String serverId) => _client.restartServer(serverId);

  @override
  Future<void> markAllAlertsRead() => _client.markAlertsRead();

  @override
  Future<void> respondToApproval(String approvalId, bool approved) =>
      _client.respondToApproval(approvalId, approved);

  static DashboardSummary _parseSummary(Object? raw) {
    final map = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    int count(String key) => map[key] is num ? (map[key] as num).toInt() : 0;
    return DashboardSummary(
      online: count('online'),
      needsCredentials: count('needsCredentials'),
      offline: count('offline'),
      crashesToday: count('crashesToday'),
      unreadAlerts: count('unreadAlerts'),
      pendingApprovals: count('pendingApprovals'),
    );
  }

  static List<T> _parseList<T>(Object? raw, T Function(Map<String, dynamic>) parse) {
    if (raw is! List) return const [];
    return [
      for (final item in raw)
        if (item is Map<String, dynamic>) parse(item),
    ];
  }

  static McpServer _parseServer(Map<String, dynamic> map) {
    return McpServer(
      id: (map['id'] ?? '').toString(),
      name: (map['name'] ?? '').toString(),
      description: (map['description'] ?? '').toString(),
      partition: (map['partition'] ?? '').toString(),
      transport: map['transport'] == 'stdio'
          ? ServerTransport.stdio
          : ServerTransport.streamableHttp,
      status: switch (map['status']) {
        'online' => ServerStatus.online,
        'needsCredentials' => ServerStatus.needsCredentials,
        _ => ServerStatus.offline,
      },
      endpoint: (map['endpoint'] ?? '').toString(),
      credentialType: switch (map['credentialType']) {
        'bearerToken' => CredentialType.bearerToken,
        'basicAuth' => CredentialType.basicAuth,
        'apiKey' => CredentialType.apiKey,
        _ => CredentialType.none,
      },
      lastSeen: map['lastSeen'] is num
          ? DateTime.fromMillisecondsSinceEpoch((map['lastSeen'] as num).toInt())
          : null,
      favorite: map['favorite'] == true,
    );
  }

  static AlertItem _parseAlert(Map<String, dynamic> map) {
    return AlertItem(
      id: (map['id'] ?? '').toString(),
      title: (map['title'] ?? '').toString(),
      message: (map['message'] ?? '').toString(),
      severity: switch (map['severity']) {
        'critical' => AlertSeverity.critical,
        'warning' => AlertSeverity.warning,
        _ => AlertSeverity.info,
      },
      createdAt: map['createdAt'] is num
          ? DateTime.fromMillisecondsSinceEpoch((map['createdAt'] as num).toInt())
          : DateTime.now(),
      read: map['read'] == true,
    );
  }

  static ApprovalItem _parseApproval(Map<String, dynamic> map) {
    return ApprovalItem(
      id: (map['id'] ?? '').toString(),
      serverId: (map['serverId'] ?? '').toString(),
      serverName: (map['serverName'] ?? '').toString(),
      action: switch (map['action']) {
        'start' => ApprovalAction.start,
        'stop' => ApprovalAction.stop,
        'delete' => ApprovalAction.delete,
        _ => ApprovalAction.restart,
      },
      requestedBy: (map['requestedBy'] ?? '').toString(),
      reason: (map['reason'] ?? '').toString(),
      createdAt: map['createdAt'] is num
          ? DateTime.fromMillisecondsSinceEpoch((map['createdAt'] as num).toInt())
          : DateTime.now(),
      status: switch (map['status']) {
        'approved' => ApprovalStatus.approved,
        'rejected' => ApprovalStatus.rejected,
        _ => ApprovalStatus.pending,
      },
    );
  }
}
