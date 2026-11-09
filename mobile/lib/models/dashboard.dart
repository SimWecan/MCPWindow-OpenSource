class DashboardSummary {
  const DashboardSummary({
    required this.online,
    required this.needsCredentials,
    required this.offline,
    required this.crashesToday,
    required this.unreadAlerts,
    required this.pendingApprovals,
  });

  final int online;
  final int needsCredentials;
  final int offline;
  final int crashesToday;
  final int unreadAlerts;
  final int pendingApprovals;

  int get total => online + needsCredentials + offline;
}
