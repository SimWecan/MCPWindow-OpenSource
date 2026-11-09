import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_theme.dart';
import '../../core/strings.dart';
import '../../data/mobile_api_client.dart';
import '../../data/pairing_link_parser.dart';
import '../../state/mobile_controller.dart';
import '../../state/settings_controller.dart';
import '../../widgets/gradient_button.dart';
import '../../widgets/tf_icon_tile.dart';
import '../../widgets/tf_page.dart';

class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  final _endpointController = TextEditingController();
  final _tokenController = TextEditingController();
  final _storage = const FlutterSecureStorage();
  bool _saving = false;
  bool _testing = false;
  String _connectionState = '尚未连接';

  @override
  void initState() {
    super.initState();
    _loadConnection();
  }

  @override
  void dispose() {
    _endpointController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _loadConnection() async {
    final endpoint = await _storage.read(key: 'desktop_endpoint');
    final token = await _storage.read(key: 'access_token');
    if (!mounted) return;
    setState(() {
      _endpointController.text = endpoint ?? '';
      _tokenController.text = token ?? '';
      _connectionState = endpoint?.isNotEmpty == true ? '已保存桌面端地址' : '尚未连接';
    });
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(pairingConfigProvider).value;
    final paired = config?.isConfigured ?? false;
    final settings = ref.watch(settingsProvider).value;
    final theme = Theme.of(context);

    return TfPage(
      appBar: AppBar(title: Text(tr(context, '设置'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 6,
              ),
              leading: TfIconTile(
                icon: paired
                    ? Icons.cloud_done_outlined
                    : Icons.cloud_off_outlined,
                color: paired ? TfColors.success : TfColors.warning,
              ),
              title: Text(tr(context, '桌面端连接')),
              subtitle: Text(tr(context, _connectionState)),
              trailing: Chip(
                label: Text(
                  tr(context, paired ? '桌面端' : '使用演示数据'),
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            tr(context, '连接桌面端'),
            style: theme.textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.2),
          ),
          const SizedBox(height: 6),
          Text(
            tr(context, '在 MCPWindow 桌面端打开“移动端配对”并开启配对服务，然后扫码或粘贴配对信息到此处。'),
            style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _endpointController,
            decoration: InputDecoration(
              labelText: tr(context, '桌面端管理地址'),
              helperText: tr(context, '例如 http://192.168.1.20:42101'),
              border: const OutlineInputBorder(),
            ),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _tokenController,
            decoration: InputDecoration(
              labelText: tr(context, '配对访问令牌'),
              helperText: tr(context, '令牌仅保存在本机安全存储中'),
              border: const OutlineInputBorder(),
            ),
            obscureText: true,
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: _pasteSmart,
              icon: const Icon(Icons.content_paste_go_outlined),
              label: Text(tr(context, '从剪贴板智能识别')),
            ),
          ),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => context.push('/pairing/scan'),
              icon: const Icon(Icons.qr_code_scanner_outlined),
              label: Text(tr(context, '扫码配对')),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _testing ? null : _testConnection,
                  icon: _testing
                      ? const SizedBox(
                          width: 16, height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.wifi_tethering_outlined),
                  label: Text(tr(context, '测试连接')),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: GradientButton(
                  onPressed: _saving ? null : _saveConnection,
                  label: tr(context, '保存连接'),
                  icon: Icons.save_outlined,
                ),
              ),
            ],
          ),
          if (paired) ...[
            const SizedBox(height: 10),
            TextButton.icon(
              onPressed: _saving ? null : _disconnect,
              icon: const Icon(Icons.link_off_outlined),
              label: Text(tr(context, '断开连接')),
            ),
          ],
          const SizedBox(height: 20),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                '${tr(context, '当前数据来自')}${tr(context, paired ? '桌面端' : '使用演示数据')}。',
                style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
              ),
            ),
          ),
          const SizedBox(height: 24),
          // 主题切换：与桌面端一致的四套主题
          _SettingsSectionHeader(title: tr(context, '主题')),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final variant in TfThemeVariant.values)
                _ThemeChoice(
                  variant: variant,
                  selected: (settings?.theme ?? TfThemeVariant.terrafin) ==
                      variant,
                  en: isEnOf(context),
                  onTap: () => ref
                      .read(settingsProvider.notifier)
                      .setTheme(variant),
                ),
            ],
          ),
          const SizedBox(height: 24),
          // 语言切换
          _SettingsSectionHeader(title: tr(context, '语言')),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _LanguageChoice(
                label: tr(context, '跟随系统'),
                selected: settings?.locale == null,
                onTap: () =>
                    ref.read(settingsProvider.notifier).setLanguage('system'),
              ),
              _LanguageChoice(
                label: '中文',
                selected: settings?.locale?.languageCode == 'zh',
                onTap: () =>
                    ref.read(settingsProvider.notifier).setLanguage('zh'),
              ),
              _LanguageChoice(
                label: 'English',
                selected: settings?.locale?.languageCode == 'en',
                onTap: () =>
                    ref.read(settingsProvider.notifier).setLanguage('en'),
              ),
            ],
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  /// 从剪贴板智能识别配对信息：支持 mcpwindow:// 二维码内容、URL 和 token 文本。
  Future<void> _pasteSmart() async {
    final clipboard = await Clipboard.getData(Clipboard.kTextPlain);
    if (!mounted) return;
    final info = PairingLinkParser.parse(clipboard?.text ?? '');
    if (info == null) {
      _toast(tr(context, '剪贴板中没有可识别的配对信息'));
      return;
    }
    setState(() {
      _endpointController.text = info.endpoint;
      _tokenController.text = info.token;
    });
    _toast(tr(context, '已识别并填入配对信息'));
  }

  Future<void> _testConnection() async {
    final endpoint = _endpointController.text.trim();
    if (endpoint.isEmpty) {
      _toast(tr(context, '连接失败：地址为空'));
      return;
    }
    setState(() => _testing = true);
    try {
      final ok = await MobileApiClient.ping(endpoint);
      if (!mounted) return;
      setState(() => _connectionState = ok ? '已连接桌面端' : '连接失败');
      _toast(tr(context, ok ? '连接成功' : '连接失败'));
    } on Exception catch (error) {
      if (!mounted) return;
      setState(() => _connectionState = '连接失败');
      _toast('${tr(context, '连接失败')}：$error');
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  Future<void> _saveConnection() async {
    setState(() => _saving = true);
    try {
      await _storage.write(
        key: 'desktop_endpoint',
        value: _endpointController.text.trim(),
      );
      await _storage.write(
        key: 'access_token',
        value: _tokenController.text.trim(),
      );
      await ref.read(pairingConfigProvider.notifier).reload();
      if (mounted) {
        setState(() => _connectionState = '已保存桌面端地址');
        _toast(tr(context, '连接信息已保存'));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _disconnect() async {
    setState(() => _saving = true);
    try {
      await _storage.delete(key: 'desktop_endpoint');
      await _storage.delete(key: 'access_token');
      _endpointController.clear();
      _tokenController.clear();
      await ref.read(pairingConfigProvider.notifier).reload();
      if (mounted) {
        setState(() => _connectionState = '尚未连接');
        _toast(tr(context, '已清除桌面端连接，当前使用演示数据。'));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _SettingsSectionHeader extends StatelessWidget {
  const _SettingsSectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Container(
          width: 4,
          height: 16,
          decoration: BoxDecoration(
            gradient: TfDecor.of(context).accentGradient,
            borderRadius: const BorderRadius.all(Radius.circular(2)),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          title,
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w700,
            letterSpacing: -0.2,
          ),
        ),
      ],
    );
  }
}

/// 主题选项：色点预览 + 名称，对齐桌面端主题选择器。
class _ThemeChoice extends StatelessWidget {
  const _ThemeChoice({
    required this.variant,
    required this.selected,
    required this.en,
    required this.onTap,
  });

  final TfThemeVariant variant;
  final bool selected;
  final bool en;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: selected
              ? scheme.primary.withValues(alpha: 0.14)
              : scheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 1.4 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [variant.previewColor, scheme.secondary],
                ),
                border: Border.all(color: scheme.outline),
              ),
            ),
            const SizedBox(width: 8),
            Text(
              variant.label(en: en),
              style: TextStyle(
                fontSize: 13,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                color: selected ? scheme.primary : scheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LanguageChoice extends StatelessWidget {
  const _LanguageChoice({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: selected
              ? scheme.primary.withValues(alpha: 0.14)
              : scheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 1.4 : 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
            color: selected ? scheme.primary : scheme.onSurface,
          ),
        ),
      ),
    );
  }
}
