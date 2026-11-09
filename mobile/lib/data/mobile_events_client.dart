import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// 桌面端配对服务的 WS 事件通道（/mobile/events）。
///
/// 服务端在状态变化时主动推送 `{"type":"snapshot","data":{...}}`，
/// 移动端据此实时刷新，无需轮询。断线后按指数退避自动重连。
class MobileEventsClient {
  MobileEventsClient({
    required this.endpoint,
    required this.token,
    WebSocketChannel Function(Uri uri)? connect,
    Duration Function(int retryAttempt)? backoff,
  }) : _connect = connect ?? WebSocketChannel.connect,
       _backoff = backoff ?? _defaultBackoff;

  final String endpoint;
  final String token;
  final WebSocketChannel Function(Uri uri) _connect;
  final Duration Function(int retryAttempt) _backoff;

  final _snapshotController =
      StreamController<Map<String, dynamic>>.broadcast();
  final List<void Function()> _connectionListeners = [];

  Timer? _retryTimer;
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  int _attempt = 0;
  bool _disposed = false;

  /// 实时快照流；只在配对模式且连接成功后有事件。
  Stream<Map<String, dynamic>> get snapshots => _snapshotController.stream;

  /// 连接状态变化（断开时触发，UI 可显示“实时连接已断开”）。
  void onConnectionLost(void Function() listener) =>
      _connectionListeners.add(listener);

  Uri get eventsUri {
    final base = Uri.parse(endpoint);
    final scheme = base.scheme == 'https' ? 'wss' : 'ws';
    final port = base.port;
    return Uri(
      scheme: scheme,
      host: base.host,
      port: (base.scheme == 'https' && port == 443) ||
              (base.scheme == 'http' && port == 80)
          ? null
          : port,
      path: '/mobile/events',
      queryParameters: {'token': token},
    );
  }

  void connect() {
    if (_disposed) return;
    WebSocketChannel channel;
    try {
      channel = _connect(eventsUri);
    } catch (_) {
      _scheduleReconnect();
      return;
    }
    _channel = channel;
    _subscription = channel.stream.listen(
      _onMessage,
      onError: (_) => _scheduleReconnect(),
      onDone: _scheduleReconnect,
      cancelOnError: true,
    );
  }

  static Duration _defaultBackoff(int attempt) =>
      Duration(seconds: (1 << attempt).clamp(1, 15));

  void _onMessage(dynamic message) {
    _attempt = 0;
    try {
      final decoded = jsonDecode(message as String);
      if (decoded is Map && decoded['type'] == 'snapshot') {
        final data = decoded['data'];
        if (data is Map<String, dynamic>) {
          _snapshotController.add(data);
        }
      }
    } catch (_) {
      // 忽略非 JSON 或结构不符的帧。
    }
  }

  void _scheduleReconnect() {
    if (_disposed) return;
    for (final listener in _connectionListeners) {
      listener();
    }
    _subscription?.cancel();
    _subscription = null;
    _retryTimer?.cancel();
    final delay = _backoff(_attempt++);
    _retryTimer = Timer(delay, connect);
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _retryTimer?.cancel();
    _subscription?.cancel();
    try {
      _channel?.sink.close();
    } catch (_) {
      // 通道可能从未建立。
    }
    if (!_snapshotController.isClosed) _snapshotController.close();
  }
}
