/// 配对信息解析：支持桌面端二维码/复制内容中的两类格式。
///
/// 1. 自定义 scheme：`mcpwindow://pair/v1?host=192.168.1.20&port=42101&token=xxx`
/// 2. 普通 URL 或文本：`http://192.168.1.20:42101` 同行/后续行带 `token=xxx`
class PairingInfo {
  const PairingInfo({required this.endpoint, required this.token});

  /// 形如 `http://192.168.1.20:42101`
  final String endpoint;
  final String token;
}

class PairingLinkParser {
  const PairingLinkParser._();

  /// 从任意文本中解析配对信息；无法解析时返回 null。
  static PairingInfo? parse(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return null;

    // 自定义 scheme：mcpwindow://pair/v1?host=..&port=..&token=..
    final scheme = RegExp(
      r'mcpwindow://pair/v\d+\?([^"\s]+)',
      caseSensitive: false,
    ).firstMatch(text);
    if (scheme != null) {
      final params = Uri.splitQueryString(scheme.group(1)!);
      final host = params['host']?.trim();
      final port = int.tryParse(params['port']?.trim() ?? '');
      final token = params['token']?.trim() ?? '';
      final tls = params['tls'] == '1';
      final endpoint = _normalize(host, port, tls: tls);
      if (endpoint != null && token.isNotEmpty) {
        return PairingInfo(endpoint: endpoint, token: token);
      }
    }

    // 普通 http(s) URL，token 可能在 query 或文本其他行。
    final urlMatch = RegExp(
      r'https?://[^\s?]+(:\d+)?[^\s]*',
      caseSensitive: false,
    ).firstMatch(text);
    if (urlMatch != null) {
      try {
        final uri = Uri.parse(urlMatch.group(0)!);
        var token = uri.queryParameters['token']?.trim() ?? '';
        final host = uri.host.trim();
        final endpoint = _normalize(host, uri.port <= 0 ? null : uri.port);
        if (endpoint != null) {
          token = token.isNotEmpty ? token : _tokenFromText(text);
          if (token.isNotEmpty) return PairingInfo(endpoint: endpoint, token: token);
        }
      } catch (_) {
        // 忽略非法 URL，继续尝试 token 行。
      }
    }
    return null;
  }

  static String? _normalize(String? host, int? port, {bool tls = false}) {
    if (host == null || host.isEmpty) return null;
    final cleanHost = host.contains(':') && !host.startsWith('[') ? '[$host]' : host;
    if (tls) {
      // 远程隧道走 https；未带端口或标准 443 端口时省略端口。
      final hasPort = port != null && port != 443;
      return hasPort ? 'https://$cleanHost:$port' : 'https://$cleanHost';
    }
    return port == null ? 'http://$cleanHost' : 'http://$cleanHost:$port';
  }

  static String _tokenFromText(String text) {
    final match = RegExp(r'(?:token|令牌)[:=]\s*([^\s]+)', caseSensitive: false)
        .firstMatch(text);
    return match?.group(1)?.trim() ?? '';
  }
}
