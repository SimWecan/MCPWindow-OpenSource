import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/strings.dart';
import '../../data/mcp_import_parser.dart';
import '../../models/server.dart';
import '../../state/mobile_controller.dart';
import '../../widgets/gradient_button.dart';
import '../../widgets/tf_page.dart';

class AddServerPage extends ConsumerStatefulWidget {
  const AddServerPage({super.key});

  @override
  ConsumerState<AddServerPage> createState() => _AddServerPageState();
}

class _AddServerPageState extends ConsumerState<AddServerPage>
    with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _partitionController = TextEditingController(text: '默认分区');
  final _endpointController = TextEditingController();
  final _jsonController = TextEditingController();
  late final TabController _tabController;
  ServerTransport _transport = ServerTransport.streamableHttp;
  CredentialType _credentialType = CredentialType.none;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _partitionController.dispose();
    _endpointController.dispose();
    _jsonController.dispose();
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TfPage(
      appBar: AppBar(
        title: Text(tr(context, '添加服务器')),
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            Tab(text: tr(context, '手动添加')),
            Tab(text: tr(context, '导入 mcp.json')),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [_buildManualForm(context), _buildImportForm(context)],
      ),
    );
  }

  Widget _buildManualForm(BuildContext context) {
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextFormField(
            controller: _nameController,
            decoration: InputDecoration(
              labelText: tr(context, '服务器名称'),
              border: const OutlineInputBorder(),
            ),
            validator: (value) =>
                value == null || value.trim().isEmpty ? tr(context, '请输入名称') : null,
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _descriptionController,
            decoration: InputDecoration(
              labelText: tr(context, '描述'),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _partitionController,
            decoration: InputDecoration(
              labelText: tr(context, '分区'),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<ServerTransport>(
            initialValue: _transport,
            decoration: InputDecoration(
              labelText: tr(context, '传输方式'),
              border: const OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(
                value: ServerTransport.streamableHttp,
                child: Text('Streamable HTTP'),
              ),
              DropdownMenuItem(
                value: ServerTransport.stdio,
                child: Text('stdio'),
              ),
            ],
            onChanged: (value) => setState(
              () => _transport = value ?? ServerTransport.streamableHttp,
            ),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _endpointController,
            decoration: InputDecoration(
              labelText: _transport == ServerTransport.stdio
                  ? tr(context, '启动命令')
                  : tr(context, '服务器地址'),
              helperText: _transport == ServerTransport.stdio
                  ? tr(context, '实际启动仍由桌面端执行')
                  : tr(context, '例如 https://example.com/mcp'),
              border: const OutlineInputBorder(),
            ),
            minLines: 1,
            maxLines: 3,
            validator: (value) => value == null || value.trim().isEmpty
                ? tr(context, '请输入连接配置')
                : null,
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<CredentialType>(
            initialValue: _credentialType,
            decoration: InputDecoration(
              labelText: tr(context, '认证方式'),
              border: const OutlineInputBorder(),
            ),
            items: [
              DropdownMenuItem(
                value: CredentialType.none,
                child: Text(tr(context, '无')),
              ),
              const DropdownMenuItem(
                value: CredentialType.bearerToken,
                child: Text('Bearer Token'),
              ),
              const DropdownMenuItem(
                value: CredentialType.basicAuth,
                child: Text('Basic Auth'),
              ),
              const DropdownMenuItem(
                value: CredentialType.apiKey,
                child: Text('API Key'),
              ),
            ],
            onChanged: (value) =>
                setState(() => _credentialType = value ?? CredentialType.none),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: _saving ? null : _saveManual,
              label: _saving
                  ? tr(context, '正在保存…')
                  : tr(context, '保存并同步到桌面端'),
              icon: _saving ? null : Icons.save_outlined,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildImportForm(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          tr(context, '粘贴包含 mcpServers 的配置文本，移动端会识别名称、stdio 命令、远程地址、认证请求头和环境变量，然后提交桌面端保存。'),
          style: Theme.of(context).textTheme.bodyMedium
              ?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _jsonController,
          decoration: InputDecoration(
            labelText: tr(context, 'mcp.json 内容'),
            alignLabelWithHint: true,
            border: const OutlineInputBorder(),
          ),
          minLines: 12,
          maxLines: 18,
        ),
        const SizedBox(height: 16),
        SizedBox(
          width: double.infinity,
          child: GradientButton(
            onPressed: _saving ? null : _saveImported,
            label: tr(context, '识别并同步'),
            icon: Icons.playlist_add_check,
          ),
        ),
      ],
    );
  }

  Future<void> _saveManual() async {
    if (!_formKey.currentState!.validate()) return;
    final server = McpServer(
      id: '',
      name: _nameController.text.trim(),
      description: _descriptionController.text.trim(),
      partition: _partitionController.text.trim().isEmpty
          ? '默认分区'
          : _partitionController.text.trim(),
      transport: _transport,
      status: ServerStatus.offline,
      endpoint: _endpointController.text.trim(),
      credentialType: _credentialType,
    );
    await _saveServers([server]);
  }

  Future<void> _saveImported() async {
    List<McpServer> servers;
    try {
      servers = const McpImportParser().parse(_jsonController.text);
    } on FormatException catch (error) {
      _showError('${tr(context, '导入失败：')}${error.message}');
      return;
    }
    await _saveServers(servers);
  }

  Future<void> _saveServers(List<McpServer> servers) async {
    setState(() => _saving = true);
    try {
      final controller = ref.read(mobileControllerProvider.notifier);
      for (final server in servers) {
        await controller.addServer(server);
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              tr(context, '已同步 {n} 台服务器到桌面端', {'n': '${servers.length}'}),
            ),
          ),
        );
        context.go('/servers');
      }
    } catch (error) {
      if (!mounted) return;
      _showError('${tr(context, '保存失败：')}$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}
