import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/app_theme.dart';

/// 应用设置：主题与中英语言，持久化在本机安全存储。
class AppSettings {
  const AppSettings({required this.theme, required this.locale});

  final TfThemeVariant theme;

  /// null 表示跟随系统；否则强制 zh / en。
  final Locale? locale;

  bool get isEn => locale?.languageCode == 'en';
}

class SettingsController extends AsyncNotifier<AppSettings> {
  static const _storage = FlutterSecureStorage();

  @override
  Future<AppSettings> build() => _read();

  Future<AppSettings> _read() async {
    final themeName = await _storage.read(key: 'app_theme');
    final lang = await _storage.read(key: 'app_language');
    return AppSettings(
      theme: TfThemeVariant.values.asNameMap()[themeName] ??
          TfThemeVariant.terrafin,
      locale: lang == 'zh'
          ? const Locale('zh')
          : lang == 'en'
          ? const Locale('en')
          : null,
    );
  }

  Future<void> setTheme(TfThemeVariant variant) async {
    await _storage.write(key: 'app_theme', value: variant.name);
    state = AsyncData(
      AppSettings(theme: variant, locale: state.value?.locale),
    );
  }

  /// [lang] 传 'system' 恢复跟随系统。
  Future<void> setLanguage(String lang) async {
    final normalized = switch (lang) {
      'zh' => 'zh',
      'en' => 'en',
      _ => null,
    };
    if (normalized == null) {
      await _storage.delete(key: 'app_language');
    } else {
      await _storage.write(key: 'app_language', value: normalized);
    }
    state = AsyncData(
      AppSettings(
        theme: state.value?.theme ?? TfThemeVariant.terrafin,
        locale: normalized == null
            ? null
            : Locale(normalized),
      ),
    );
  }
}

final settingsProvider =
    AsyncNotifierProvider<SettingsController, AppSettings>(
      SettingsController.new,
    );

/// 当前生效的主题（未加载完成前用默认落日红）。
final themeVariantProvider = Provider<TfThemeVariant>(
  (ref) => ref.watch(settingsProvider).value?.theme ?? TfThemeVariant.terrafin,
);

/// 当前生效的语言覆盖；null 跟随系统。
final localeOverrideProvider = Provider<Locale?>(
  (ref) => ref.watch(settingsProvider).value?.locale,
);
