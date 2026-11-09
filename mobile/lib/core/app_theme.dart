import 'package:flutter/material.dart';

/// Terrafin 系列色卡（状态语义色与品牌色）。
class TfColors {
  TfColors._();

  static const ink = Color(0xFFFFF7F3); // 主文字（深底）
  static const night = Color(0xFF15082F); // 品牌夜空底
  static const nightDeep = Color(0xFF100522); // 页面底色（比 night 再沉一档）
  static const nightCard = Color(0xFF1E0F3F); // 深色卡片
  static const purple = Color(0xFF65289A); // 品牌紫
  static const violet = Color(0xFF7E39EE); // 亮紫（辅助强调）
  static const sun = Color(0xFFFF714D); // 品牌日珥橙（官网 terrafin.css）
  static const sunsetRed = Color(0xFFE4572E); // 落日红（桌面端 terrafin 主色）
  static const peach = Color(0xFFFFBEA1); // 蜜桃高光
  static const paper = Color(0xFFF3DDD7); // 浅色底（暖纸）
  static const paperCard = Color(0xFFFFFBF8); // 浅色卡片
  static const inkDark = Color(0xFF29152E); // 浅底主文字
  static const mutedDark = Color(0xFF725865); // 浅底次要文字
  static const mutedLight = Color(0xFFC9B8D4); // 深底次要文字
  static const twilight = Color(0xFF4A6FA5); // 暮光蓝（桌面端 terrafin accent-2）

  /// 状态语义色：在色卡基调上微调，保证可读性。
  static const success = Color(0xFF3ECF8E);
  static const warning = sun;
  static const danger = Color(0xFFFF5C7A);
}

/// Terrafin 渐变：与桌面端 `.btn-primary` / `.stat-card::before` 同一思路。
class TfGradients {
  TfGradients._();

  /// 落日红主渐变：日珥橙 → 亮紫。
  static const LinearGradient sunset = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [TfColors.sun, TfColors.violet],
  );

  /// 暮光渐变：亮紫 → 暮光蓝，用于次级强调面。
  static const LinearGradient twilight = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [TfColors.violet, TfColors.twilight],
  );
}

/// 与桌面端一一对应的四个主题；terrafin（落日红）为默认主题。
enum TfThemeVariant {
  terrafin,
  aurora,
  midnight,
  daylight;

  String label({bool en = false}) => switch (this) {
    TfThemeVariant.terrafin => en ? 'Terrafin Sunset' : '落日红',
    TfThemeVariant.aurora => en ? 'Aurora' : '极光紫',
    TfThemeVariant.midnight => en ? 'Midnight' : '午夜蓝',
    TfThemeVariant.daylight => en ? 'Daylight' : '白昼',
  };

  /// 主题预览点颜色（设置页主题选择器用）。
  Color get previewColor => switch (this) {
    TfThemeVariant.terrafin => TfColors.sunsetRed,
    TfThemeVariant.aurora => const Color(0xFFA855F7),
    TfThemeVariant.midnight => const Color(0xFF4F8DFF),
    TfThemeVariant.daylight => const Color(0xFF8B5CF6),
  };

  bool get isLight => this == TfThemeVariant.daylight;
}

/// 主题级装饰：强调渐变 + 氛围光晕色，各主题不同（对齐桌面端
/// `.btn-primary` 渐变与 `body::before` 光晕）。
@immutable
class TfDecor extends ThemeExtension<TfDecor> {
  const TfDecor({
    required this.accentGradient,
    required this.glowA,
    required this.glowB,
  });

  /// 主强调渐变（对应桌面端 accent → accent-2）。
  final Gradient accentGradient;

  /// 右上氛围光颜色。
  final Color glowA;

  /// 左下氛围光颜色。
  final Color glowB;

  static TfDecor of(BuildContext context) =>
      Theme.of(context).extension<TfDecor>()!;

  @override
  TfDecor copyWith({Gradient? accentGradient, Color? glowA, Color? glowB}) {
    return TfDecor(
      accentGradient: accentGradient ?? this.accentGradient,
      glowA: glowA ?? this.glowA,
      glowB: glowB ?? this.glowB,
    );
  }

  @override
  TfDecor lerp(ThemeExtension<TfDecor>? other, double t) =>
      other is TfDecor ? other : this;
}

class AppTheme {
  AppTheme._();

  static ThemeData build(TfThemeVariant variant) => switch (variant) {
    TfThemeVariant.terrafin => _dark(
      // 落日红主体：主色 E4572E，渐变 落日红 → 暮光蓝
      primary: TfColors.sunsetRed,
      onPrimary: const Color(0xFFFFF6F0),
      secondary: TfColors.twilight,
      onSecondary: const Color(0xFFF2EFEA),
      surfaceLowest: const Color(0xFF1C1A24),
      surfaceLow: const Color(0xFF232031),
      surface: const Color(0xFF2E2942),
      surfaceHigh: const Color(0xFF3B2A5A),
      surfaceHighest: const Color(0xFF453366),
      onSurface: const Color(0xFFF2EFEA),
      onSurfaceVariant: const Color(0xFFB9B3C6),
      border: const Color(0xFF3B3352),
      borderStrong: const Color(0xFF574C78),
      glowA: TfColors.sunsetRed,
      glowB: TfColors.twilight,
    ),
    TfThemeVariant.aurora => _dark(
      primary: const Color(0xFFA855F7),
      onPrimary: Colors.white,
      secondary: const Color(0xFF6366F1),
      onSecondary: Colors.white,
      surfaceLowest: const Color(0xFF100D1C),
      surfaceLow: const Color(0xFF191426),
      surface: const Color(0xFF251C37),
      surfaceHigh: const Color(0xFF2C2141),
      surfaceHighest: const Color(0xFF362a4e),
      onSurface: const Color(0xFFF4F0FA),
      onSurfaceVariant: const Color(0xFFB8ACCB),
      border: const Color(0xFF382A4E),
      borderStrong: const Color(0xFF55406F),
      glowA: const Color(0xFFA855F7),
      glowB: const Color(0xFF6366F1),
    ),
    TfThemeVariant.midnight => _dark(
      primary: const Color(0xFF4F8DFF),
      onPrimary: Colors.white,
      secondary: const Color(0xFF38BDF8),
      onSecondary: const Color(0xFF0D1420),
      surfaceLowest: const Color(0xFF0D1420),
      surfaceLow: const Color(0xFF151E2D),
      surface: const Color(0xFF1D293C),
      surfaceHigh: const Color(0xFF24334A),
      surfaceHighest: const Color(0xFF2d3f5a),
      onSurface: const Color(0xFFEDF3FC),
      onSurfaceVariant: const Color(0xFFA4B2C8),
      border: const Color(0xFF2A3850),
      borderStrong: const Color(0xFF405574),
      glowA: const Color(0xFF4F8DFF),
      glowB: const Color(0xFF38BDF8),
    ),
    TfThemeVariant.daylight => _light(
      primary: const Color(0xFF8B5CF6),
      onPrimary: Colors.white,
      secondary: const Color(0xFF6366F1),
      onSecondary: Colors.white,
      surfaceLowest: const Color(0xFFF4F5FA),
      surfaceLow: const Color(0xFFFFFFFF),
      surface: const Color(0xFFF0EEF7),
      surfaceHigh: const Color(0xFFFFFFFF),
      surfaceHighest: const Color(0xFFFFFFFF),
      onSurface: const Color(0xFF292536),
      onSurfaceVariant: const Color(0xFF6F677E),
      border: const Color(0xFFE0DDEA),
      borderStrong: const Color(0xFFC8C0D8),
      glowA: const Color(0xFF8B5CF6),
      glowB: const Color(0xFF6366F1),
    ),
  };

  static ThemeData _dark({
    required Color primary,
    required Color onPrimary,
    required Color secondary,
    required Color onSecondary,
    required Color surfaceLowest,
    required Color surfaceLow,
    required Color surface,
    required Color surfaceHigh,
    required Color surfaceHighest,
    required Color onSurface,
    required Color onSurfaceVariant,
    required Color border,
    required Color borderStrong,
    required Color glowA,
    required Color glowB,
  }) {
    final scheme = ColorScheme.dark(
      primary: primary,
      onPrimary: onPrimary,
      secondary: secondary,
      onSecondary: onSecondary,
      tertiary: TfColors.peach,
      onTertiary: const Color(0xFF3A1500),
      surface: surface,
      onSurface: onSurface,
      surfaceContainerLowest: surfaceLowest,
      surfaceContainerLow: surfaceLow,
      surfaceContainer: surface,
      surfaceContainerHigh: surfaceHigh,
      surfaceContainerHighest: surfaceHighest,
      onSurfaceVariant: onSurfaceVariant,
      outline: borderStrong.withValues(alpha: 0.55),
      outlineVariant: border.withValues(alpha: 0.85),
      error: TfColors.danger,
      onError: onSurface,
    );
    return _base(
      scheme,
      isDark: true,
      glowA: glowA,
      glowB: glowB,
    );
  }

  static ThemeData _light({
    required Color primary,
    required Color onPrimary,
    required Color secondary,
    required Color onSecondary,
    required Color surfaceLowest,
    required Color surfaceLow,
    required Color surface,
    required Color surfaceHigh,
    required Color surfaceHighest,
    required Color onSurface,
    required Color onSurfaceVariant,
    required Color border,
    required Color borderStrong,
    required Color glowA,
    required Color glowB,
  }) {
    final scheme = ColorScheme.light(
      primary: primary,
      onPrimary: onPrimary,
      secondary: secondary,
      onSecondary: onSecondary,
      tertiary: const Color(0xFFA6406A),
      onTertiary: Colors.white,
      surface: surface,
      onSurface: onSurface,
      surfaceContainerLowest: surfaceLowest,
      surfaceContainerLow: surfaceLow,
      surfaceContainer: surface,
      surfaceContainerHigh: surfaceHigh,
      surfaceContainerHighest: surfaceHighest,
      onSurfaceVariant: onSurfaceVariant,
      outline: borderStrong.withValues(alpha: 0.7),
      outlineVariant: border.withValues(alpha: 0.8),
      error: const Color(0xFFD93A55),
      onError: Colors.white,
    );
    return _base(
      scheme,
      isDark: false,
      glowA: glowA,
      glowB: glowB,
    );
  }

  static ThemeData _base(
    ColorScheme scheme, {
    required bool isDark,
    required Color glowA,
    required Color glowB,
  }) {
    final radius = BorderRadius.circular(16);
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      scaffoldBackgroundColor: scheme.surfaceContainerLowest,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        backgroundColor: Colors.transparent,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        titleTextStyle: TextStyle(
          color: scheme.onSurface,
          fontSize: 20,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
        ),
      ),
      cardTheme: CardThemeData(
        color: scheme.surfaceContainer,
        elevation: 0,
        margin: EdgeInsets.zero,
        shadowColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        elevation: 0,
        indicatorColor: scheme.primary.withValues(alpha: 0.16),
        indicatorShape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.onSurfaceVariant,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w400,
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : scheme.onSurfaceVariant,
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(44, 44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(44, 44),
          side: BorderSide(color: scheme.outline),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      chipTheme: ChipThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(color: scheme.outlineVariant),
        ),
        backgroundColor: scheme.surfaceContainerHigh,
        selectedColor: scheme.primary.withValues(alpha: 0.18),
        labelStyle: TextStyle(color: scheme.onSurface, fontSize: 13),
        side: BorderSide(color: scheme.outlineVariant),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        insetPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        backgroundColor: scheme.surfaceContainerHighest,
        contentTextStyle: TextStyle(color: scheme.onSurface),
        actionTextColor: scheme.primary,
      ),
      dialogTheme: DialogThemeData(
        shape: RoundedRectangleBorder(borderRadius: radius),
        backgroundColor: scheme.surfaceContainerHigh,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        backgroundColor: scheme.surfaceContainer,
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant,
        thickness: 1,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHigh,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: scheme.primary, width: 1.6),
        ),
      ),
      tabBarTheme: TabBarThemeData(
        labelColor: scheme.primary,
        unselectedLabelColor: scheme.onSurfaceVariant,
        indicatorColor: scheme.primary,
        dividerColor: scheme.outlineVariant,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        elevation: 2,
        highlightElevation: 4,
      ),
      extensions: [
        TfDecor(
          accentGradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [scheme.primary, scheme.secondary],
          ),
          glowA: glowA.withValues(alpha: isDark ? 0.14 : 0.10),
          glowB: glowB.withValues(alpha: isDark ? 0.12 : 0.08),
        ),
      ],
    );
  }
}

/// 需要浮起阴影的卡片：等价于桌面端带 `--shadow` 的 `.card`。
class TfCard extends StatelessWidget {
  const TfCard({super.key, required this.child, this.padding, this.onTap});

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final radius = BorderRadius.circular(16);
    return Container(
      decoration: BoxDecoration(
        color: scheme.surfaceContainer,
        borderRadius: radius,
        border: Border.all(color: scheme.outlineVariant),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF05030C).withValues(
              alpha: isDark ? 0.28 : 0.08,
            ),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: radius,
          child: padding == null
              ? child
              : Padding(padding: padding!, child: child),
        ),
      ),
    );
  }
}
