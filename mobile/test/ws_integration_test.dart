import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mcpwindow_mobile/app.dart';
import 'package:mcpwindow_mobile/state/mobile_controller.dart';

/// 内存版配对配置：跳过安全存储，直接指向本地测试服务器。
class FakePairingConfigController extends PairingConfigController {
  FakePairingConfigController(this.config);

  final PairingConfig config;

  @override
  Future<PairingConfig> build() async => config;
}

Map<String, dynamic> _snapshot(List<String> names) => {
  'summary': {
    'online': names.length,
    'needsCredentials': 0,
    'offline': 0,
    'crashesToday': 0,
    'unreadAlerts': 0,
    'pendingApprovals': 0,
  },
  'servers': [
    for (final name in names)
      {
        'id': name,
        'name': name,
        'description': '',
        'partition': '默认分区',
        'transport': 'stdio',
        'status': 'online',
        'endpoint': 'node server.js',
        'credentialType': 'none',
        'lastSeen': null,
        'favorite': false,
      },
  ],
  'alerts': <dynamic>[],
  'approvals': <dynamic>[],
  'generatedAt': DateTime.now().millisecondsSinceEpoch,
};

/// 真实网络监听必须在真实异步区完成（setUpAll），testWidgets 体内是 fakeAsync。
HttpServer? _server;
final List<WebSocket> _sockets = [];

Future<void> _startDesktopStub() async {
  _server = await HttpServer.bind('127.0.0.1', 0);
  _server!.listen((request) {
    if (request.uri.path == '/mobile/snapshot') {
      request.response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode(_snapshot(['http-loaded'])));
      request.response.close();
      return;
    }
    if (request.uri.path == '/mobile/events') {
      WebSocketTransformer.upgrade(request).then((socket) {
        _sockets.add(socket);
        socket.add('{"type":"connected"}');
      });
      return;
    }
    request.response.statusCode = 404;
    request.response.close();
  });
}

void main() {
  setUpAll(() async => _startDesktopStub());
  setUp(() {
    // flutter_test 会安装 _MockHttpOverrides 全局拦截真实网络；本测试需要真连接。
    HttpOverrides.global = null;
  });
  tearDownAll(() async {
    for (final socket in _sockets) {
      await socket.close();
    }
    await _server?.close(force: true);
  });

  testWidgets('配对模式：HTTP 初次加载 + WS 推送实时刷新', (tester) async {
    tester.binding.platformDispatcher.localesTestValue = const [Locale('zh')];
    addTearDown(tester.binding.platformDispatcher.clearLocalesTestValue);

    final config = PairingConfig(
      endpoint: 'http://127.0.0.1:${_server!.port}',
      token: 'test-token',
    );
    final container = ProviderContainer(
      overrides: [
        pairingConfigProvider.overrideWith(
          () => FakePairingConfigController(config),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const McpWindowApp(),
      ),
    );
    await tester.pump();

    // 在真实事件循环里完成网络 IO：初次加载 + WS 握手。
    // （fakeAsync 内 dart:io 请求无法推进，dio 超时定时器却会按 fake 时钟触发。）
    await tester.runAsync(() async {
      // 真实异步区完成网络 IO：HTTP 初次加载 + WS 握手（fakeAsync 内 dart:io 无法推进）。
      await container.read(mobileControllerProvider.notifier).refresh();
      container.read(mobileEventsProvider)?.connect();
      await Future<void>.delayed(const Duration(milliseconds: 500));
    });
    await tester.pump();

    await tester.tap(find.text('服务器'));
    await tester.pumpAndSettle();

    // 初次经 HTTP 加载
    expect(find.text('http-loaded'), findsOneWidget);
    expect(find.text('ws-pushed'), findsNothing);

    // 桌面端推送新快照 → 界面应实时更新
    expect(_sockets, hasLength(1));
    await tester.runAsync(() async {
      _sockets.first.add(
        jsonEncode({
          'type': 'snapshot',
          'data': _snapshot(['http-loaded', 'ws-pushed']),
        }),
      );
      await Future<void>.delayed(const Duration(milliseconds: 300));
    });
    await tester.pump();
    expect(find.text('http-loaded'), findsOneWidget);
    expect(find.text('ws-pushed'), findsOneWidget);

    // 收尾：先卸载组件树再销毁容器，最后推进 fake 时钟，
    // 放掉首个 fakeAsync 加载尝试遗留的 Riverpod 重试/dio 拦截器定时器。
    await tester.pumpWidget(const SizedBox.shrink());
    container.dispose();
    await tester.pump();
    await tester.pump(const Duration(seconds: 5));
  });
}
