import 'package:flutter/material.dart';

import '../core/app_theme.dart';

/// 品牌渐变文字：用于首页标题等位置，主题强调渐变色。
class BrandGradientText extends StatelessWidget {
  const BrandGradientText(this.text, {super.key, this.style});

  final String text;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final base = style ?? Theme.of(context).appBarTheme.titleTextStyle;
    return ShaderMask(
      shaderCallback: (bounds) => TfDecor.of(context)
          .accentGradient
          .createShader(Offset.zero & bounds.size),
      child: Text(
        text,
        style: base?.copyWith(color: Colors.white) ??
            const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.3,
            ),
      ),
    );
  }
}
