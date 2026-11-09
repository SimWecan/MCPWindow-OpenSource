import 'package:dio/dio.dart';

/// 桌面端配对服务 API 客户端（与 electron/pairingServer 路由对应）。
class MobileApiClient {
  MobileApiClient({required String baseUrl, String? accessToken})
    : _dio = Dio(
        BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 8),
          receiveTimeout: const Duration(seconds: 15),
          headers: {
            if (accessToken != null && accessToken.isNotEmpty)
              'Authorization': 'Bearer $accessToken',
          },
        ),
      );

  final Dio _dio;

  /// 无需令牌的健康检查，用于“测试连接”。
  static Future<bool> ping(String baseUrl) async {
    final dio = Dio(
      BaseOptions(connectTimeout: const Duration(seconds: 5), receiveTimeout: const Duration(seconds: 5)),
    );
    try {
      final response = await dio.get<Map<String, dynamic>>('$baseUrl/health');
      return response.statusCode == 200 && response.data?['ok'] == true;
    } on DioException catch (error) {
      throw _friendly(error);
    }
  }

  Future<Map<String, dynamic>> fetchSnapshot() => _getMap('/mobile/snapshot');
  Future<List<dynamic>> fetchServers() => _getList('/mobile/servers');
  Future<List<dynamic>> fetchAlerts() => _getList('/mobile/alerts');
  Future<List<dynamic>> fetchApprovals() => _getList('/mobile/approvals');

  Future<void> startServer(String serverId) =>
      _post('/mobile/servers/$serverId/start');
  Future<void> stopServer(String serverId) =>
      _post('/mobile/servers/$serverId/stop');
  Future<void> restartServer(String serverId) =>
      _post('/mobile/servers/$serverId/restart');
  Future<void> deleteServer(String serverId) =>
      _dio.delete<void>('/mobile/servers/$serverId').then((_) {}, onError: _throwFriendly);
  Future<void> markAlertsRead() => _post('/mobile/alerts/read-all');
  Future<void> respondToApproval(String approvalId, bool approved) =>
      _post('/mobile/approvals/$approvalId/respond', body: {'approved': approved});

  Future<void> addServer(Map<String, dynamic> payload) =>
      _post('/mobile/servers', body: payload);

  Future<void> _post(String path, {Map<String, dynamic>? body}) async {
    try {
      await _dio.post<void>(path, data: body);
    } on DioException catch (error) {
      throw _friendly(error);
    }
  }

  Future<Map<String, dynamic>> _getMap(String path) async {
    try {
      final response = await _dio.get<Map<String, dynamic>>(path);
      return response.data ?? <String, dynamic>{};
    } on DioException catch (error) {
      throw _friendly(error);
    }
  }

  Future<List<dynamic>> _getList(String path) async {
    try {
      final response = await _dio.get<List<dynamic>>(path);
      return response.data ?? <dynamic>[];
    } on DioException catch (error) {
      throw _friendly(error);
    }
  }

  static Never _throwFriendly(Object error) {
    if (error is DioException) throw _friendly(error);
    throw Exception('$error');
  }

  /// 把 Dio 异常翻译成带桌面端错误信息的可读异常。
  static Exception _friendly(DioException error) {
    final data = error.response?.data;
    if (data is Map && data['error'] is String) return Exception(data['error']);
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return Exception('连接桌面端超时，请检查地址与网络');
      case DioExceptionType.connectionError:
        return Exception('无法连接桌面端，请确认配对服务已开启');
      default:
        return Exception('请求失败（HTTP ${error.response?.statusCode ?? '—'}）');
    }
  }
}
