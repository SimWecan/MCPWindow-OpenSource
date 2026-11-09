import 'package:flutter/material.dart';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_theme.dart';
import '../../core/strings.dart';
import '../../core/tf_status.dart';
import '../../models/server.dart';
import '../../state/mobile_controller.dart';
import '../../widgets/empty_state.dart';
import '../../widgets/status_chip.dart';
import '../../widgets/tf_icon_tile.dart';
import '../../widgets/tf_page.dart';
import '../overview/overview_page.dart';

class ServersPage extends ConsumerStatefulWidget {
  const ServersPage({super.key});

  @override
  ConsumerState<ServersPage> createState() => _ServersPageState();
}

class _ServersPageState extends ConsumerState<ServersPage> {
  String _keyword = '';
  ServerStatus? _status;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(mobileControllerProvider);
    return TfPage(
      appBar: AppBar(title: Text(tr(context, '服务器'))),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/servers/add'),
        icon: const Icon(Icons.add),
        label: Text(tr(context, '添加')),
      ),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorBody(message: error.toString()),
        data: (snapshot) {
          final servers = _filter(snapshot.servers);
          return RefreshIndicator(
            onRefresh: () =>
                ref.read(mobileControllerProvider.notifier).refresh(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
              children: [
                SearchBar(
                  hintText: tr(context, '搜索名称、描述、地址或分区'),
                  leading: const Icon(Icons.search),
                  trailing: _keyword.isEmpty
                      ? null
                      : [
                          IconButton(
                            tooltip: tr(context, '清除'),
                            onPressed: () => setState(() => _keyword = ''),
                            icon: const Icon(Icons.clear),
                          ),
                        ],
                  onChanged: (value) => setState(() => _keyword = value.trim()),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 42,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      _StatusFilter(
                        label: tr(context, '全部'),
                        selected: _status == null,
                        onSelected: () => setState(() => _status = null),
                      ),
                      ...ServerStatus.values.map(
                        (status) => _StatusFilter(
                          label: TfStatus.label(status, en: isEnOf(context)),
                          selected: _status == status,
                          onSelected: () => setState(() => _status = status),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                if (servers.isEmpty)
                  EmptyState(
                    icon: Icons.dns_outlined,
                    title: tr(context, '没有匹配的服务器'),
                    message: tr(context, '调整搜索或状态筛选，也可以添加新的 MCP 服务器。'),
                  )
                else
                  ...servers.map((server) => ServerListTile(server: server)),
              ],
            ),
          );
        },
      ),
    );
  }

  List<McpServer> _filter(List<McpServer> servers) {
    final keyword = _keyword.toLowerCase();
    return servers
        .where((server) {
          if (_status != null && server.status != _status) return false;
          if (keyword.isEmpty) return true;
          return server.name.toLowerCase().contains(keyword) ||
              server.description.toLowerCase().contains(keyword) ||
              server.partition.toLowerCase().contains(keyword) ||
              server.endpoint.toLowerCase().contains(keyword);
        })
        .toList(growable: false)
      ..sort((a, b) {
        final statusCompare = a.status.index.compareTo(b.status.index);
        if (statusCompare != 0) return statusCompare;
        return a.name.compareTo(b.name);
      });
  }
}

class _StatusFilter extends StatelessWidget {
  const _StatusFilter({
    required this.label,
    required this.selected,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onSelected(),
      ),
    );
  }
}

class ServerListTile extends ConsumerWidget {
  const ServerListTile({super.key, required this.server});

  final McpServer server;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: ListTile(
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 6,
          ),
          leading: TfIconTile(
            icon: TfStatus.icon(server.status),
            color: TfStatus.color(server.status),
          ),
          title: Text(server.name, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(
              '${server.partition} · ${_transportLabel(server.transport)}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              StatusChip(status: server.status, compact: true),
              _ServerMenu(server: server),
            ],
          ),
          onTap: () => context.push('/servers/detail', extra: server),
        ),
      ),
    );
  }
}

class _ServerMenu extends ConsumerWidget {
  const _ServerMenu({required this.server});

  final McpServer server;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(mobileControllerProvider.notifier);
    return PopupMenuButton<String>(
      tooltip: tr(context, '服务器操作'),
      icon: const Icon(Icons.more_vert),
      onSelected: (value) async {
        Future<void> run(Future<void> Function() action, String message) async {
          try {
            await action();
          } catch (error) {
            if (context.mounted) {
              _showSnack(context, '${tr(context, '操作失败：')}$error', isError: true);
            }
            return;
          }
          if (context.mounted) _showSnack(context, message);
        }

        switch (value) {
          case 'start':
            await run(
              () => controller.startServer(server.id),
              tr(context, '已请求启动 {name}', {'name': server.name}),
            );
          case 'stop':
            await run(
              () => controller.stopServer(server.id),
              tr(context, '已请求停止 {name}', {'name': server.name}),
            );
          case 'restart':
            await run(
              () => controller.restartServer(server.id),
              tr(context, '已请求重启 {name}', {'name': server.name}),
            );
          case 'delete':
            final confirmed = await _confirmDelete(context, server.name);
            if (confirmed ?? false) {
              if (!context.mounted) return;
              await run(
                () => controller.removeServer(server.id),
                tr(context, '已删除 {name}', {'name': server.name}),
              );
            }
        }
      },
      itemBuilder: (context) => [
        PopupMenuItem(
          value: 'start',
          child: ListTile(
            leading: const Icon(Icons.play_arrow),
            title: Text(tr(context, '启动')),
          ),
        ),
        PopupMenuItem(
          value: 'stop',
          child: ListTile(
            leading: const Icon(Icons.stop),
            title: Text(tr(context, '停止')),
          ),
        ),
        PopupMenuItem(
          value: 'restart',
          child: ListTile(
            leading: const Icon(Icons.restart_alt),
            title: Text(tr(context, '重启')),
          ),
        ),
        PopupMenuItem(
          value: 'delete',
          child: ListTile(
            leading: const Icon(Icons.delete_outline, color: TfColors.danger),
            title: Text(
              tr(context, '删除'),
              style: const TextStyle(color: TfColors.danger),
            ),
          ),
        ),
      ],
    );
  }
}

Future<bool?> _confirmDelete(BuildContext context, String name) {
  return showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      icon: const Icon(Icons.delete_outline, color: TfColors.danger),
      title: Text(tr(context, '删除服务器')),
      content: Text(
        tr(context, '将从 MCPWindow 移除“{name}”。如果该服务正在运行，桌面端会先执行受控停止。', {'name': name}),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(tr(context, '取消')),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: TfColors.danger),
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(tr(context, '删除')),
        ),
      ],
    ),
  );
}

void _showSnack(BuildContext context, String message, {bool isError = false}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: isError ? TfColors.danger : null,
    ),
  );
}

String _transportLabel(ServerTransport transport) => switch (transport) {
  ServerTransport.stdio => 'stdio',
  ServerTransport.streamableHttp => 'HTTP',
};
