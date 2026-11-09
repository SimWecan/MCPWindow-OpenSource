enum AlertSeverity { info, warning, critical }

class AlertItem {
  const AlertItem({
    required this.id,
    required this.title,
    required this.message,
    required this.severity,
    required this.createdAt,
    this.read = false,
  });

  final String id;
  final String title;
  final String message;
  final AlertSeverity severity;
  final DateTime createdAt;
  final bool read;
}
