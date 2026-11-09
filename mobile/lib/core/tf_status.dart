import 'package:flutter/material.dart';

import '../core/app_theme.dart';
import '../models/server.dart';

/// 服务器状态统一映射：颜色、文案与图标，供状态点、状态徽标和列表图标共用。
class TfStatus {
  TfStatus._();

  static Color color(ServerStatus status) => switch (status) {
    ServerStatus.online => TfColors.success,
    ServerStatus.needsCredentials => TfColors.warning,
    ServerStatus.offline => TfColors.danger,
  };

  static String label(ServerStatus status, {bool en = false}) => switch (status) {
    ServerStatus.online => en ? 'Online' : '在线',
    ServerStatus.needsCredentials => en ? 'Credentials' : '需凭证',
    ServerStatus.offline => en ? 'Offline' : '离线',
  };

  static IconData icon(ServerStatus status) => switch (status) {
    ServerStatus.online => Icons.cloud_done_outlined,
    ServerStatus.needsCredentials => Icons.key_outlined,
    ServerStatus.offline => Icons.cloud_off_outlined,
  };
}
