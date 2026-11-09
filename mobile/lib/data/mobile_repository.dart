import '../models/mobile_snapshot.dart';
import '../models/server.dart';

abstract class MobileRepository {
  Future<MobileSnapshot> load();
  Future<McpServer> addServer(McpServer server);
  Future<void> removeServer(String serverId);
  Future<void> updateServerStatus(String serverId, ServerStatus status);
  Future<void> restartServer(String serverId);
  Future<void> markAllAlertsRead();
  Future<void> respondToApproval(String approvalId, bool approved);
}
