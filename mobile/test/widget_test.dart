import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mcpwindow_mobile/app.dart';
import 'package:mcpwindow_mobile/data/mcp_import_parser.dart';
import 'package:mcpwindow_mobile/models/server.dart';

void main() {
  testWidgets('首屏展示关键状态并进入服务器页', (tester) async {
    tester.binding.platformDispatcher.localesTestValue = const [Locale('zh')];
    addTearDown(tester.binding.platformDispatcher.clearLocalesTestValue);
    await tester.pumpWidget(ProviderScope(child: const McpWindowApp()));
    await tester.pumpAndSettle();

    expect(find.text('MCPWindow'), findsOneWidget);
    expect(find.text('关键状态'), findsOneWidget);
    expect(find.text('在线服务器'), findsOneWidget);
    expect(find.text('待处理'), findsOneWidget);

    await tester.tap(find.text('服务器'));
    await tester.pumpAndSettle();
    expect(find.text('文件检索服务'), findsOneWidget);
    expect(find.text('天气查询服务'), findsOneWidget);
  });

  testWidgets('英文界面渲染关键文案', (tester) async {
    tester.binding.platformDispatcher.localesTestValue = const [Locale('en')];
    addTearDown(tester.binding.platformDispatcher.clearLocalesTestValue);
    await tester.pumpWidget(ProviderScope(child: const McpWindowApp()));
    await tester.pumpAndSettle();

    expect(find.text('Key status'), findsOneWidget);
    expect(find.text('Online servers'), findsOneWidget);
    expect(find.text('Pending'), findsOneWidget);
    expect(find.text('Servers'), findsOneWidget);
  });

  test('mcp.json 导入支持 HTTP 与 stdio', () {
    const source = '''
{
  "mcpServers": {
    "remote": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    },
    "local": {
      "command": "node",
      "args": ["server.js", "--root=./data"]
    }
  }
}
''';

    final servers = const McpImportParser().parse(source);
    expect(servers, hasLength(2));
    expect(servers.first.name, 'remote');
    expect(servers.first.transport, ServerTransport.streamableHttp);
    expect(servers.first.credentialType, CredentialType.bearerToken);
    expect(servers.last.transport, ServerTransport.stdio);
    expect(servers.last.endpoint, 'node server.js --root=./data');
  });
}
