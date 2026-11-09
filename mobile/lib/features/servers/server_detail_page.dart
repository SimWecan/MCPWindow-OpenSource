import 'package:flutter/material.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_theme.dart';
import '../../core/strings.dart';
import '../../core/tf_status.dart';
import '../../models/server.dart';
import '../../state/mobile_controller.dart';
import '../../widgets/status_chip.dart';
import '../../widgets/tf_icon_tile.dart';
import '../../widgets/tf_page.dart';

class ServerDetailPage extends ConsumerWidget {
  const ServerDetailPage({super.key, required this.server});

  final McpServer server;

  static ServerDetailPage fromState(GoRouterState state) {
    final extra = state.extra;
    if (extra is McpServer) return ServerDetailPage(server: extra);
    throw StateError('缺少服务器详情参数');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    // 详情页路由参数里的服务器对象可能是旧快照；优先使用控制器里的最新数据。
    final snapshot = ref.watch(mobileControllerProvider).value;
    final current =
        snapshot?.servers.where((s) => s.id == server.id).firstOrNull ??
        server;
    final statusColor = TfStatus.color(current.status);
    return TfPage(
      appBar: AppBar(title: Text(current.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 顶部品牌渐变条，呼应桌面端分区卡片的顶部强调线
                Container(
                  height: 4,
                  decoration: BoxDecoration(
                    gradient: TfDecor.of(context).accentGradient,
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          TfIconTile(
                            icon: TfStatus.icon(current.status),
                            color: statusColor,
                            size: 48,
                            iconSize: 24,
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  current.name,
                                  style: theme.textTheme.titleLarge?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: -0.3,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  current.description.isEmpty
                                      ? tr(context, '暂无描述')
                                      : current.description,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      StatusChip(status: current.status),
                      const SizedBox(height: 14),
                      const Divider(),
                      const SizedBox(height: 6),
                      _InfoRow(label: tr(context, '分区'), value: current.partition),
                      _InfoRow(
                        label: tr(context, '传输方式'),
                        value: current.transport == ServerTransport.stdio
                            ? 'stdio'
                            : 'Streamable HTTP',
                      ),
                      _InfoRow(
                        label: tr(context, '连接配置'),
                        value: current.endpoint.isEmpty
                            ? tr(context, '未配置')
                            : current.endpoint,
                        mono: true,
                      ),
                      _InfoRow(
                        label: tr(context, '认证方式'),
                        value: switch (current.credentialType) {
                          CredentialType.none => tr(context, '无'),
                          CredentialType.bearerToken => 'Bearer Token',
                          CredentialType.basicAuth => 'Basic Auth',
                          CredentialType.apiKey => 'API Key',
                        },
                      ),
                      _InfoRow(
                        label: tr(context, '最近心跳'),
                        value: server.lastSeen?.toLocal().toString() ??
                            tr(context, '暂无记录'),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Text(
            tr(context, '远程操作'),
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
              letterSpacing: -0.2,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              FilledButton.tonalIcon(
                onPressed: () => _runRemote(
                  context,
                  ref,
                  () => ref
                      .read(mobileControllerProvider.notifier)
                      .startServer(current.id),
                  tr(context, '已请求启动 {name}', {'name': current.name}),
                ),
                icon: const Icon(Icons.play_arrow),
                label: Text(tr(context, '启动')),
              ),
              FilledButton.tonalIcon(
                onPressed: () => _runRemote(
                  context,
                  ref,
                  () => ref
                      .read(mobileControllerProvider.notifier)
                      .stopServer(current.id),
                  tr(context, '已请求停止 {name}', {'name': current.name}),
                ),
                icon: const Icon(Icons.stop),
                label: Text(tr(context, '停止')),
              ),
              FilledButton.tonalIcon(
                onPressed: () => _runRemote(
                  context,
                  ref,
                  () => ref
                      .read(mobileControllerProvider.notifier)
                      .restartServer(current.id),
                  tr(context, '已请求重启 {name}', {'name': current.name}),
                ),
                icon: const Icon(Icons.restart_alt),
                label: Text(tr(context, '重启')),
              ),
              OutlinedButton.icon(
                onPressed: () => context.pop(),
                icon: const Icon(Icons.sync),
                label: Text(tr(context, '同步状态')),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                tr(context, '远程操作会提交到桌面端执行；实际生产环境会按服务器策略执行审批、审计和失败回执。'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  height: 1.6,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 执行远程操作并给出回执；失败时把桌面端错误信息展示出来。
Future<void> _runRemote(
  BuildContext context,
  WidgetRef ref,
  Future<void> Function() action,
  String successMessage,
) async {
  try {
    await action();
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text('${tr(context, '操作失败：')}$error'),
            backgroundColor: TfColors.danger,
          ),
        );
    }
    return;
  }
  if (context.mounted) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(successMessage)));
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value, this.mono = false});

  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 82,
            child: Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: mono
                  ? const TextStyle(fontFamily: 'monospace', fontSize: 13)
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}
