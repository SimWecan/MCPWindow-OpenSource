import 'package:flutter/material.dart';

import '../core/app_theme.dart';

/// 渐变主按钮：等价于桌面端 `.btn-primary` 的
/// `linear-gradient(135deg, accent, accent-2)` + 柔和投影。
class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.onPressed,
    required this.label,
    this.icon,
    this.gradient,
  });

  final VoidCallback? onPressed;
  final String label;
  final IconData? icon;
  final Gradient? gradient;

  bool get _enabled => onPressed != null;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(12);
    final scheme = Theme.of(context).colorScheme;
    final effective = gradient ?? TfDecor.of(context).accentGradient;
    return Opacity(
      opacity: _enabled ? 1 : 0.5,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: effective,
          borderRadius: radius,
          boxShadow: [
            BoxShadow(
              color: scheme.primary.withValues(alpha: _enabled ? 0.35 : 0),
              blurRadius: 18,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onPressed,
            borderRadius: radius,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 64, minHeight: 44),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    if (icon != null) ...[
                      Icon(icon, size: 18, color: const Color(0xFFFFF7F3)),
                      const SizedBox(width: 8),
                    ],
                    Text(
                      label,
                      style: const TextStyle(
                        color: Color(0xFFFFF7F3),
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
