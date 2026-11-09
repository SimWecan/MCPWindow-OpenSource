import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/app_theme.dart';
import '../../core/strings.dart';
import '../../data/pairing_link_parser.dart';
import '../../state/mobile_controller.dart';

/// 扫码配对页：扫描桌面端“移动端配对”弹窗中的二维码，
/// 识别成功后直接保存连接并返回。
class ScanPairingPage extends ConsumerStatefulWidget {
  const ScanPairingPage({super.key});

  @override
  ConsumerState<ScanPairingPage> createState() => _ScanPairingPageState();
}

class _ScanPairingPageState extends ConsumerState<ScanPairingPage> {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
  );
  final _storage = const FlutterSecureStorage();
  String? _errorHint;
  bool _handled = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handled) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;
    final info = PairingLinkParser.parse(raw);
    if (info == null) {
      setState(() => _errorHint = tr(context, '无法识别该二维码，请扫描桌面端的配对二维码'));
      return;
    }
    _handled = true;
    await _storage.write(key: 'desktop_endpoint', value: info.endpoint);
    await _storage.write(key: 'access_token', value: info.token);
    await ref.read(pairingConfigProvider.notifier).reload();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(tr(context, '连接信息已保存'))),
    );
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        title: Text(tr(context, '扫码配对')),
        actions: [
          IconButton(
            tooltip: tr(context, '切换镜头'),
            onPressed: () => _controller.switchCamera(),
            icon: const Icon(Icons.cameraswitch_outlined),
          ),
          ValueListenableBuilder<MobileScannerState>(
            valueListenable: _controller,
            builder: (context, state, _) {
              final on = state.torchState == TorchState.on;
              return IconButton(
                tooltip: on ? tr(context, '关灯') : tr(context, '开灯'),
                onPressed: () => _controller.toggleTorch(),
                icon: Icon(on ? Icons.flash_on : Icons.flash_off),
              );
            },
          ),
        ],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            errorBuilder: (context, error) => _ScannerError(
              error: error,
              onRetry: () => _controller.start(),
            ),
          ),
          // 中央取景框
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white54, width: 1.5),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.35),
                    blurRadius: 24,
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 48,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Column(
                children: [
                  if (_errorHint != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 9,
                        ),
                        decoration: BoxDecoration(
                          color: TfColors.danger.withValues(alpha: 0.85),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          _errorHint!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white),
                        ),
                      ),
                    ),
                  Text(
                    tr(context, '对准桌面端“移动端配对”中显示的二维码'),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: Colors.white.withValues(alpha: 0.85),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ScannerError extends StatelessWidget {
  const _ScannerError({required this.error, required this.onRetry});

  final MobileScannerException error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final denied = error.errorCode == MobileScannerErrorCode.permissionDenied;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              denied ? Icons.no_photography_outlined : Icons.error_outline,
              size: 48,
              color: Colors.white70,
            ),
            const SizedBox(height: 16),
            Text(
              denied
                  ? tr(context, '请在系统设置中允许 MCPWindow 使用相机后再试。')
                  : '${tr(context, '未能打开相机')}: ${error.errorDetails?.message ?? ''}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 16),
            if (!denied)
              OutlinedButton(
                onPressed: onRetry,
                child: Text(tr(context, '重试')),
              ),
          ],
        ),
      ),
    );
  }
}
