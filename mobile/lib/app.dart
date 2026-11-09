import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/app_theme.dart';
import 'core/strings.dart';
import 'features/add/add_server_page.dart';
import 'features/alerts/alerts_page.dart';
import 'features/approvals/approvals_page.dart';
import 'features/overview/overview_page.dart';
import 'features/pairing/scan_pairing_page.dart';
import 'features/servers/server_detail_page.dart';
import 'features/servers/servers_page.dart';
import 'features/settings/settings_page.dart';
import 'state/settings_controller.dart';

class McpWindowApp extends ConsumerStatefulWidget {
  const McpWindowApp({super.key});

  @override
  ConsumerState<McpWindowApp> createState() => _McpWindowAppState();
}

class _McpWindowAppState extends ConsumerState<McpWindowApp> {
  // 路由实例保持在 State 中：切换主题/语言重建 MaterialApp 时导航状态不丢。
  late final GoRouter _router = GoRouter(
    initialLocation: '/overview',
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            HomeShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/overview',
                builder: (context, state) => const OverviewPage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/servers',
                builder: (context, state) => const ServersPage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/alerts',
                builder: (context, state) => const AlertsPage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/approvals',
                builder: (context, state) => const ApprovalsPage(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (context, state) => const SettingsPage(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/servers/add',
        builder: (context, state) => const AddServerPage(),
      ),
      GoRoute(
        path: '/servers/detail',
        builder: (context, state) => ServerDetailPage.fromState(state),
      ),
      GoRoute(
        path: '/pairing/scan',
        builder: (context, state) => const ScanPairingPage(),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final variant = ref.watch(themeVariantProvider);
    final localeOverride = ref.watch(localeOverrideProvider);
    final theme = AppTheme.build(variant);
    return MaterialApp.router(
      title: 'MCPWindow',
      debugShowCheckedModeBanner: false,
      theme: theme,
      themeMode: ThemeMode.light,
      locale: localeOverride,
      supportedLocales: const [Locale('zh'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: _router,
    );
  }
}

class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (index) => navigationShell.goBranch(
          index,
          initialLocation: index == navigationShell.currentIndex,
        ),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.dashboard_outlined),
            selectedIcon: const Icon(Icons.dashboard),
            label: tr(context, '总览'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.dns_outlined),
            selectedIcon: const Icon(Icons.dns),
            label: tr(context, '服务器'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.notifications_outlined),
            selectedIcon: const Icon(Icons.notifications),
            label: tr(context, '告警'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.verified_user_outlined),
            selectedIcon: const Icon(Icons.verified_user),
            label: tr(context, '审批'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.settings_outlined),
            selectedIcon: const Icon(Icons.settings),
            label: tr(context, '设置'),
          ),
        ],
      ),
    );
  }
}
