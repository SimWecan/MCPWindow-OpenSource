enum ApprovalAction { start, stop, restart, delete }

enum ApprovalStatus { pending, approved, rejected }

class ApprovalItem {
  const ApprovalItem({
    required this.id,
    required this.serverId,
    required this.serverName,
    required this.action,
    required this.requestedBy,
    required this.reason,
    required this.createdAt,
    this.status = ApprovalStatus.pending,
  });

  final String id;
  final String serverId;
  final String serverName;
  final ApprovalAction action;
  final String requestedBy;
  final String reason;
  final DateTime createdAt;
  final ApprovalStatus status;
}
