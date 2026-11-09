import 'package:flutter/material.dart';

/// 着色圆角图标块：列表项 / 卡片的统一 leading，
/// 桌面端徽标与图标底色的移动端等价物。
class TfIconTile extends StatelessWidget {
  const TfIconTile({
    super.key,
    required this.icon,
    required this.color,
    this.size = 40,
    this.iconSize = 20,
  });

  final IconData icon;
  final Color color;
  final double size;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.30)),
      ),
      child: Icon(icon, size: iconSize, color: color),
    );
  }
}
