import 'package:flutter/material.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_theme.dart';
import '../../core/strings.dart';
import '../../core/time_text.dart';
import '../../models/alert.dart';
import '../../state/mobile_controller.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/tf_icon_tile.dart';
import '../../widgets/tf_page.dart';
import '../overview/overview_page.dart';

class AlertsPage extends ConsumerWidget {
  const AlertsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(mobileControllerProvider);
    final en = isEnOf(context);
    return TfPage(
      appBar: AppBar(
        title: Text(tr(context, '告警')),
        actions: [
          TextButton(
            onPressed: () =>
                ref.read(mobileControllerProvider.notifier).markAllAlertsRead(),
            child: Text(tr(context, '全部已读')),
          ),
        ],
      ),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorBody(message: error.toString()),
        data: (snapshot) {
          final alerts = snapshot.alerts;
          if (alerts.isEmpty) {
            return EmptyState(
              icon: Icons.notifications_none,
              title: tr(context, '暂无告警'),
              message: tr(context, '服务器离线、凭证到期和高风险操作会在这里提醒。'),
            );
          }
          return RefreshIndicator(
            onRefresh: () =>
                ref.read(mobileControllerProvider.notifier).refresh(),
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: alerts.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, index) {
                final alert = alerts[index];
                final isCritical = alert.severity == AlertSeverity.critical;
                final color = isCritical ? TfColors.danger : TfColors.warning;
                return Card(
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 6,
                    ),
                    leading: TfIconTile(
                      icon: isCritical
                          ? Icons.error_outline
                          : Icons.warning_amber_outlined,
                      color: color,
                    ),
                    title: Text(
                      alert.title,
                      style: TextStyle(
                        fontWeight: alert.read
                            ? FontWeight.w400
                            : FontWeight.w700,
                      ),
                    ),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(alert.message),
                          const SizedBox(height: 6),
                          Text(
                            '${_severityLabel(alert.severity, en)} · ${relativeTime(alert.createdAt, en: en)}${alert.read ? ' · ${tr(context, '已读')}' : ''}',
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  color: Theme.of(context)
                                      .colorScheme
                                      .onSurfaceVariant,
                                ),
                          ),
                        ],
                      ),
                    ),
                    isThreeLine: true,
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

String _severityLabel(AlertSeverity severity, bool en) => switch (severity) {
  AlertSeverity.info => en ? 'Info' : '提示',
  AlertSeverity.warning => en ? 'Warning' : '警告',
  AlertSeverity.critical => en ? 'Critical' : '严重',
};
