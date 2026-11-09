import 'package:flutter_test/flutter_test.dart';
import 'package:mcpwindow_mobile/data/pairing_link_parser.dart';

void main() {
  group('PairingLinkParser', () {
    test('解析 mcpwindow:// 二维码内容', () {
      final info = PairingLinkParser.parse(
        'mcpwindow://pair/v1?host=192.168.1.20&port=42101&token=abc123',
      );
      expect(info, isNotNull);
      expect(info!.endpoint, 'http://192.168.1.20:42101');
      expect(info.token, 'abc123');
    });

    test('解析 http URL，token 在 query 中', () {
      final info = PairingLinkParser.parse(
        'http://10.0.0.8:42101/mobile/snapshot?token=tk_456',
      );
      expect(info, isNotNull);
      expect(info!.endpoint, 'http://10.0.0.8:42101');
      expect(info.token, 'tk_456');
    });

    test('解析桌面端复制的多行文本（URL 行 + token 行）', () {
      final info = PairingLinkParser.parse(
        'http://192.168.31.5:42101\ntoken=xyz789',
      );
      expect(info, isNotNull);
      expect(info!.endpoint, 'http://192.168.31.5:42101');
      expect(info.token, 'xyz789');
    });

    test('解析中文“令牌=”写法', () {
      final info = PairingLinkParser.parse(
        'http://172.16.0.2:42101\n令牌: secret-1',
      );
      expect(info, isNotNull);
      expect(info!.token, 'secret-1');
    });

    test('无端口 URL 回退为默认 scheme', () {
      final info = PairingLinkParser.parse(
        'mcpwindow://pair/v1?host=desktop.local&token=t1',
      );
      expect(info, isNotNull);
      expect(info!.endpoint, 'http://desktop.local');
    });

    test('远程隧道 tls=1 解析为 https 且省略 443 端口', () {
      final info = PairingLinkParser.parse(
        'mcpwindow://pair/v1?host=xxx.trycloudflare.com&port=443&token=rt1&tls=1',
      );
      expect(info, isNotNull);
      expect(info!.endpoint, 'https://xxx.trycloudflare.com');
      expect(info.token, 'rt1');
    });

    test('远程隧道 tls=1 保留非 443 端口', () {
      final info = PairingLinkParser.parse(
        'mcpwindow://pair/v1?host=tunnel.example.com&port=8443&token=rt2&tls=1',
      );
      expect(info, isNotNull);
      expect(info!.endpoint, 'https://tunnel.example.com:8443');
    });

    test('无法解析时返回 null', () {
      expect(PairingLinkParser.parse(''), isNull);
      expect(PairingLinkParser.parse('随便一段文本'), isNull);
      expect(PairingLinkParser.parse('mcpwindow://pair/v1?host=1.1.1.1'), isNull);
    });
  });
}
