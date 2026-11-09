import 'dart:convert';

import '../models/server.dart';

class McpImportParser {
  const McpImportParser();

  List<McpServer> parse(String source) {
    final decoded = jsonDecode(source);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('顶层必须是 JSON 对象');
    }
    final servers = decoded['mcpServers'];
    if (servers is! Map<String, dynamic>) {
      throw const FormatException('缺少 mcpServers 对象');
    }
    if (servers.isEmpty) {
      throw const FormatException('mcpServers 中没有服务器');
    }

    final result = <McpServer>[];
    servers.forEach((name, value) {
      if (value is! Map) return;
      result.add(_parseServer(name, Map<String, dynamic>.from(value)));
    });
    if (result.isEmpty) {
      throw const FormatException('没有可识别的 MCP 服务器');
    }
    return result;
  }

  McpServer _parseServer(String name, Map<String, dynamic> value) {
    final url = _stringValue(value['url']);
    final command = _stringValue(value['command']);
    if (url.isEmpty && command.isEmpty) {
      throw FormatException('$name 缺少 url 或 command');
    }

    final transport = url.isNotEmpty
        ? ServerTransport.streamableHttp
        : ServerTransport.stdio;
    final headers = value['headers'] is Map<String, dynamic>
        ? Map<String, dynamic>.from(value['headers'] as Map<String, dynamic>)
        : <String, dynamic>{};
    final credentialType = _credentialType(headers);
    final endpoint = transport == ServerTransport.streamableHttp
        ? url
        : _stdioEndpoint(command, value['args']);

    return McpServer(
      id: '',
      name: name,
      description: '从 mcp.json 导入',
      transport: transport,
      status: ServerStatus.offline,
      endpoint: endpoint,
      credentialType: credentialType,
    );
  }

  CredentialType _credentialType(Map<String, dynamic> headers) {
    for (final entry in headers.entries) {
      final key = entry.key.toLowerCase();
      final value = entry.value?.toString().toLowerCase() ?? '';
      if (key == 'authorization' && value.startsWith('bearer ')) {
        return CredentialType.bearerToken;
      }
      if (key == 'authorization' && value.startsWith('basic ')) {
        return CredentialType.basicAuth;
      }
      if (key.contains('api-key') || key == 'x-api-key') {
        return CredentialType.apiKey;
      }
    }
    return CredentialType.none;
  }

  String _stdioEndpoint(String command, Object? args) {
    if (args is! List<dynamic>) return command;
    final renderedArgs = args
        .map((arg) => arg?.toString() ?? '')
        .where((arg) => arg.isNotEmpty);
    return [command, ...renderedArgs].join(' ');
  }

  String _stringValue(Object? value) => value?.toString().trim() ?? '';
}
