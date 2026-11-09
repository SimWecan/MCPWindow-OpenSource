import 'package:flutter/material.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_theme.dart';
import '../../core/strings.dart';
import '../../core/tf_status.dart';
import '../../core/time_text.dart';
import '../../models/alert.dart';
import '../../models/approval.dart';
import '../../models/mobile_snapshot.dart';
import '../../models/server.dart';
import '../../state/mobile_controller.dart';
import '../../widgets/brand_text.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/metric_card.dart';
import '../../widgets/section_header.dart';
import '../../widgets/status_chip.dart';
import '../../widgets/tf_icon_tile.dart';
import '../../widgets/tf_page.dart';

class OverviewPage extends ConsumerWidget {
  const OverviewPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(mobileControllerProvider);
    return TfPage(
      appBar: AppBar(
        title: const BrandGradientText('MCPWindow'),
        actions: [
          IconButton(
            tooltip: tr(context, '刷新'),
            onPressed: state.isLoading
                ? null
                : () => ref.read(mobileControllerProvider.notifier).refresh(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorBody(message: error.toString()),
        data: (snapshot) => _OverviewContent(snapshot: snapshot),
      ),
    );
  }
}

class _OverviewContent extends ConsumerWidget {
  const _OverviewContent({required this.snapshot});

  final MobileSnapshot snapshot;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final en = isEnOf(context);
    final alerts = snapshot.alerts.where((alert) => !alert.read).toList();
    final approvals = snapshot.approvals
        .where((approval) => approval.status == ApprovalStatus.pending)
        .toList();
    final abnormalServers = snapshot.servers
        .where((server) => server.status != ServerStatus.online)
        .toList(growable: false);

    return RefreshIndicator(
      onRefresh: () => ref.read(mobileControllerProvider.notifier).refresh(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          Text(
            tr(context, '关键状态'),
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.w700,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.55,
            children: [
              MetricCard(
                title: tr(context, '在线服务器'),
                value: '${snapshot.summary.online}',
                icon: Icons.cloud_done_outlined,
                color: TfColors.success,
                subtitle: tr(
                  context,
                  '共 {n} 台',
                  {'n': '${snapshot.summary.total}'},
                ),
                onTap: () => context.go('/servers'),
              ),
              MetricCard(
                title: tr(context, '需凭证'),
                value: '${snapshot.summary.needsCredentials}',
                icon: Icons.key_outlined,
                color: TfColors.warning,
                subtitle: tr(context, '等待有效认证'),
                onTap: () => context.go('/servers'),
              ),
              MetricCard(
                title: tr(context, '离线服务器'),
                value: '${snapshot.summary.offline}',
                icon: Icons.cloud_off_outlined,
                color: TfColors.danger,
                subtitle: tr(
                  context,
                  '今日崩溃 {n} 次',
                  {'n': '${snapshot.summary.crashesToday}'},
                ),
                onTap: () => context.go('/servers'),
              ),
              MetricCard(
                title: tr(context, '待处理'),
                value:
                    '${snapshot.summary.unreadAlerts + snapshot.summary.pendingApprovals}',
                icon: Icons.notifications_outlined,
                color: TfColors.violet,
                subtitle: tr(
                  context,
                  '告警 {a} · 审批 {p}',
                  {
                    'a': '${snapshot.summary.unreadAlerts}',
                    'p': '${snapshot.summary.pendingApprovals}',
                  },
                ),
                onTap: () => context.go('/alerts'),
              ),
            ],
          ),
          if (approvals.isNotEmpty) ...[
            const SizedBox(height: 20),
            SectionHeader(
              title: tr(context, '等待审批'),
              action: tr(context, '查看全部'),
              onTap: () => context.go('/approvals'),
            ),
            ...approvals
                .take(2)
                .map(
                  (approval) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TfCard(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      onTap: () => context.go('/approvals'),
                      child: Row(
                        children: [
                          TfIconTile(
                            icon: Icons.verified_user_outlined,
                            color: theme.colorScheme.secondary,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${approval.serverName} · ${actionLabel(approval.action, en)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  '${approval.requestedBy} · ${relativeTime(approval.createdAt, en: en)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right),
                        ],
                      ),
                    ),
                  ),
                ),
          ],
          if (alerts.isNotEmpty) ...[
            const SizedBox(height: 20),
            SectionHeader(
              title: tr(context, '最新告警'),
              action: tr(context, '查看全部'),
              onTap: () => context.go('/alerts'),
            ),
            ...alerts
                .take(2)
                .map(
                  (alert) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TfCard(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      onTap: () => context.go('/alerts'),
                      child: Row(
                        children: [
                          TfIconTile(
                            icon: alert.severity == AlertSeverity.critical
                                ? Icons.error_outline
                                : Icons.warning_amber_outlined,
                            color: alert.severity == AlertSeverity.critical
                                ? TfColors.danger
                                : TfColors.warning,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  alert.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  alert.message,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            relativeTime(alert.createdAt, en: en),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
          ],
          const SizedBox(height: 20),
          SectionHeader(
            title: tr(context, '异常服务器'),
            action: tr(context, '管理'),
            onTap: () => context.go('/servers'),
          ),
          const SizedBox(height: 10),
          if (abnormalServers.isEmpty)
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: TfColors.success.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: TfColors.success.withValues(alpha: 0.28),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.check_circle_outline,
                    color: TfColors.success,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(tr(context, '当前没有离线或需凭证的服务器')),
                  ),
                ],
              ),
            )
          else
            ...abnormalServers.map(
              (server) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: TfCard(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  onTap: () => context.push('/servers/detail', extra: server),
                  child: Row(
                    children: [
                      TfIconTile(
                        icon: TfStatus.icon(server.status),
                        color: TfStatus.color(server.status),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              server.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              server.partition,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                      StatusChip(status: server.status, compact: true),
                    ],
                  ),
                ),
              ),
            ),
          if (snapshot.servers.isEmpty)
            EmptyState(
              icon: Icons.dns_outlined,
              title: tr(context, '还没有 MCP 服务器'),
              message: tr(context, '点击右下角添加，或在服务器页导入 mcp.json。'),
            ),
        ],
      ),
    );
  }
}

class ErrorBody extends StatelessWidget {
  const ErrorBody({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.cloud_off_outlined,
      title: tr(context, '暂时无法获取状态'),
      message: message,
    );
  }
}

String actionLabel(ApprovalAction action, bool en) => switch (action) {
  ApprovalAction.start => en ? 'Start' : '启动',
  ApprovalAction.stop => en ? 'Stop' : '停止',
  ApprovalAction.restart => en ? 'Restart' : '重启',
  ApprovalAction.delete => en ? 'Delete' : '删除',
};
