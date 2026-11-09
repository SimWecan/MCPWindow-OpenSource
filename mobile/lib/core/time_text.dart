import 'package:intl/intl.dart';

/// 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期；支持英文。
String relativeTime(DateTime value, {bool en = false}) {
  final difference = DateTime.now().difference(value);
  if (difference.inMinutes < 1) return en ? 'Just now' : '刚刚';
  if (difference.inHours < 1) {
    return en ? '${difference.inMinutes} min ago' : '${difference.inMinutes} 分钟前';
  }
  if (difference.inDays < 1) {
    return en ? '${difference.inHours} h ago' : '${difference.inHours} 小时前';
  }
  if (difference.inDays < 30) {
    return en ? '${difference.inDays} d ago' : '${difference.inDays} 天前';
  }
  return DateFormat.yMMMd(en ? 'en_US' : 'zh_CN').format(value);
}
