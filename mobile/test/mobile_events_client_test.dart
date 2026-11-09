import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:stream_channel/stream_channel.dart';

import 'package:mcpwindow_mobile/data/mobile_events_client.dart';

/// 假 WS 通道：测试注入驱动服务端消息与关闭。
class FakeWebSocketSink implements WebSocketSink {
  @override
  void add(dynamic event) {}

  @override
  void addError(Object error, [StackTrace? stackTrace]) {}

  @override
  Future<void> addStream(Stream<dynamic> stream) => stream.drain<void>();

  @override
  Future<void> close([int? closeCode, String? closeReason]) async {}

  @override
  Future<void> get done => Future<void>.value();
}

class FakeWebSocketChannel extends StreamChannelMixin<dynamic>
    implements WebSocketChannel {
  final StreamController<dynamic> incoming = StreamController<dynamic>();

  @override
  Stream<dynamic> get stream => incoming.stream;

  @override
  WebSocketSink get sink => FakeWebSocketSink();

  @override
  String? get protocol => null;

  @override
  int? get closeCode => null;

  @override
  String? get closeReason => null;

  @override
  Future<int?> get ready => Future<int?>.value(0);

  void serverClose() => incoming.close();
}

void main() {
  group('MobileEventsClient', () {
    test('https 端点生成 wss 事件地址且省略 443 端口', () {
      final client = MobileEventsClient(
        endpoint: 'https://tunnel.example.com',
        token: 'tk',
      );
      final uri = client.eventsUri;
      expect(uri.scheme, 'wss');
      expect(uri.host, 'tunnel.example.com');
      expect(uri.hasPort, isFalse);
      expect(uri.path, '/mobile/events');
      expect(uri.queryParameters['token'], 'tk');
    });

    test('http 端点生成 ws 地址并保留非默认端口', () {
      final client = MobileEventsClient(
        endpoint: 'http://192.168.1.20:42101',
        token: 'tk',
      );
      final uri = client.eventsUri;
      expect(uri.scheme, 'ws');
      expect(uri.port, 42101);
    });

    test('收到 snapshot 消息推送到 snapshots 流', () async {
      final fake = FakeWebSocketChannel();
      final client = MobileEventsClient(
        endpoint: 'http://192.168.1.20:42101',
        token: 'tk',
        connect: (_) => fake,
      );
      addTearDown(client.dispose);

      final pending = client.snapshots.first;
      client.connect();
      fake.incoming.add(
        '{"type":"snapshot","data":{"summary":{"online":2},"servers":[],"alerts":[],"approvals":[]}}',
      );
      final snapshot = await pending;
      expect(snapshot['summary']?['online'], 2);
    });

    test('忽略 connected 等非 snapshot 消息', () async {
      final fake = FakeWebSocketChannel();
      final client = MobileEventsClient(
        endpoint: 'http://192.168.1.20:42101',
        token: 'tk',
        connect: (_) => fake,
      );
      addTearDown(client.dispose);

      var pushes = 0;
      final sub = client.snapshots.listen((_) => pushes++);
      client.connect();
      fake.incoming.add('{"type":"connected"}');
      fake.incoming.add('not json');
      await Future<void>.delayed(Duration.zero);
      expect(pushes, 0);
      await sub.cancel();
    });

    test('断线后自动重连（退避可调）', () async {
      final fakes = <FakeWebSocketChannel>[];
      var connects = 0;
      final client = MobileEventsClient(
        endpoint: 'http://192.168.1.20:42101',
        token: 'tk',
        connect: (_) {
          connects++;
          final fake = FakeWebSocketChannel();
          fakes.add(fake);
          return fake;
        },
        backoff: (_) => Duration.zero,
      );
      addTearDown(client.dispose);

      var lost = 0;
      client.onConnectionLost(() => lost++);

      client.connect();
      expect(connects, 1);
      fakes.first.serverClose();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(connects, greaterThanOrEqualTo(2));
      expect(lost, 1);
    });

    test('dispose 后不再重连', () async {
      final fakes = <FakeWebSocketChannel>[];
      var connects = 0;
      final client = MobileEventsClient(
        endpoint: 'http://192.168.1.20:42101',
        token: 'tk',
        connect: (_) {
          connects++;
          final fake = FakeWebSocketChannel();
          fakes.add(fake);
          return fake;
        },
        backoff: (_) => Duration.zero,
      );
      client.connect();
      client.dispose();
      fakes.first.serverClose();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(connects, 1);
    });
  });
}
