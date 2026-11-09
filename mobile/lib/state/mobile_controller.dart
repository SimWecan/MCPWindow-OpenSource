import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../data/mock_mobile_repository.dart';
import '../data/mobile_api_client.dart';
import '../data/mobile_events_client.dart';
import '../data/mobile_repository.dart';
import '../data/paired_mobile_repository.dart';
import '../models/mobile_snapshot.dart';
import '../models/server.dart';

/// 桌面端配对配置；地址与令牌保存在本机安全存储。
class PairingConfig {
  const PairingConfig({this.endpoint, this.token});

  final String? endpoint;
  final String? token;

  bool get isConfigured =>
      (endpoint?.isNotEmpty ?? false) && (token?.isNotEmpty ?? false);
}

class PairingConfigController extends AsyncNotifier<PairingConfig> {
  static const _storage = FlutterSecureStorage();

  @override
  Future<PairingConfig> build() => _read();

  Future<PairingConfig> _read() async {
    final endpoint = await _storage.read(key: 'desktop_endpoint');
    final token = await _storage.read(key: 'access_token');
    return PairingConfig(
      endpoint: endpoint?.isEmpty == true ? null : endpoint,
      token: token?.isEmpty == true ? null : token,
    );
  }

  /// 重新读取安全存储并更新状态；watch 链会自动切换移动端数据源。
  Future<void> reload() async {
    state = AsyncData(await _read());
  }
}

final pairingConfigProvider =
    AsyncNotifierProvider<PairingConfigController, PairingConfig>(
      PairingConfigController.new,
    );

final mobileRepositoryProvider = Provider<MobileRepository>((ref) {
  final config = ref.watch(pairingConfigProvider).value;
  if (config != null && config.isConfigured) {
    return PairedMobileRepository(
      MobileApiClient(baseUrl: config.endpoint!, accessToken: config.token),
    );
  }
  return MockMobileRepository();
});

/// WS 实时事件通道：配对模式下连接桌面端 /mobile/events，自动重连。
/// 配置变化（重新配对）时自动重建旧连接。
final mobileEventsProvider = Provider<MobileEventsClient?>((ref) {
  final config = ref.watch(pairingConfigProvider).value;
  if (config == null || !config.isConfigured) return null;
  final client = MobileEventsClient(
    endpoint: config.endpoint!,
    token: config.token!,
  );
  ref.onDispose(client.dispose);
  return client;
});

final mobileControllerProvider =
    AsyncNotifierProvider<MobileController, MobileSnapshot>(
      MobileController.new,
    );

class MobileController extends AsyncNotifier<MobileSnapshot> {
  MobileRepository get _repository => ref.watch(mobileRepositoryProvider);
  StreamSubscription<Map<String, dynamic>>? _eventsSubscription;

  @override
  Future<MobileSnapshot> build() {
    _eventsSubscription?.cancel();
    _eventsSubscription = null;
    final events = ref.watch(mobileEventsProvider);
    if (events != null) {
      _eventsSubscription = events.snapshots.listen(_onSnapshotPushed);
      ref.onDispose(() => _eventsSubscription?.cancel());
      events.connect();
    }
    return _repository.load();
  }

  /// 桌面端状态变化时通过 WS 推送实时快照，直接刷新界面。
  void _onSnapshotPushed(Map<String, dynamic> data) {
    try {
      state = AsyncData(PairedMobileRepository.parseSnapshot(data));
    } catch (_) {
      // 推送结构不符时忽略，等下一次推送或手动刷新。
    }
  }

  Future<void> refresh() => _reload();

  Future<void> startServer(String serverId) async {
    await _repository.updateServerStatus(serverId, ServerStatus.online);
    await _reload();
  }

  Future<void> stopServer(String serverId) async {
    await _repository.updateServerStatus(serverId, ServerStatus.offline);
    await _reload();
  }

  Future<void> restartServer(String serverId) async {
    await _repository.restartServer(serverId);
    await _reload();
  }

  Future<void> addServer(McpServer server) async {
    await _repository.addServer(server);
    await _reload();
  }

  Future<void> removeServer(String serverId) async {
    await _repository.removeServer(serverId);
    await _reload();
  }

  Future<void> markAllAlertsRead() async {
    await _repository.markAllAlertsRead();
    await _reload();
  }

  Future<void> respondToApproval(String approvalId, bool approved) async {
    await _repository.respondToApproval(approvalId, approved);
    await _reload();
  }

  Future<void> _reload() async {
    state = const AsyncLoading<MobileSnapshot>();
    state = await AsyncValue.guard<MobileSnapshot>(() => _repository.load());
  }
}
