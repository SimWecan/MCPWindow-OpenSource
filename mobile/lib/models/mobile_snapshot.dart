import 'alert.dart';
import 'approval.dart';
import 'dashboard.dart';
import 'server.dart';

class MobileSnapshot {
  const MobileSnapshot({
    required this.summary,
    required this.servers,
    required this.alerts,
    required this.approvals,
  });

  final DashboardSummary summary;
  final List<McpServer> servers;
  final List<AlertItem> alerts;
  final List<ApprovalItem> approvals;

  MobileSnapshot copyWith({
    DashboardSummary? summary,
    List<McpServer>? servers,
    List<AlertItem>? alerts,
    List<ApprovalItem>? approvals,
  }) {
    return MobileSnapshot(
      summary: summary ?? this.summary,
      servers: servers ?? this.servers,
      alerts: alerts ?? this.alerts,
      approvals: approvals ?? this.approvals,
    );
  }
}
