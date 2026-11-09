import 'package:flutter/material.dart';

import '../core/app_theme.dart';

/// 页面骨架：在 Scaffold 之上叠加主题氛围光晕，
/// 对应桌面端 `body::before` 的右上主色光 + 左下辅助色光。
class TfPage extends StatelessWidget {
  const TfPage({
    super.key,
    required this.body,
    this.appBar,
    this.floatingActionButton,
    this.resizeToAvoidBottomInset,
  });

  final Widget body;
  final PreferredSizeWidget? appBar;
  final Widget? floatingActionButton;
  final bool? resizeToAvoidBottomInset;

  @override
  Widget build(BuildContext context) {
    final decor = TfDecor.of(context);
    return Scaffold(
      appBar: appBar,
      floatingActionButton: floatingActionButton,
      resizeToAvoidBottomInset: resizeToAvoidBottomInset,
      body: Stack(
        children: [
          Positioned(
            top: -120,
            right: -90,
            child: _glow(size: 340, color: decor.glowA),
          ),
          Positioned(
            bottom: -80,
            left: -100,
            child: _glow(size: 320, color: decor.glowB),
          ),
          Positioned.fill(child: body),
        ],
      ),
    );
  }

  Widget _glow({required double size, required Color color}) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [color, color.withValues(alpha: 0)],
          ),
        ),
      ),
    );
  }
}
