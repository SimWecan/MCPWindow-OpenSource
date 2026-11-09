enum ServerStatus { online, needsCredentials, offline }

enum ServerTransport { stdio, streamableHttp }

enum CredentialType { none, bearerToken, basicAuth, apiKey }

class McpServer {
  const McpServer({
    required this.id,
    required this.name,
    required this.transport,
    required this.status,
    this.description = '',
    this.partition = '默认分区',
    this.endpoint = '',
    this.credentialType = CredentialType.none,
    this.lastSeen,
    this.favorite = false,
  });

  final String id;
  final String name;
  final String description;
  final String partition;
  final ServerTransport transport;
  final ServerStatus status;
  final String endpoint;
  final CredentialType credentialType;
  final DateTime? lastSeen;
  final bool favorite;

  McpServer copyWith({
    String? id,
    String? name,
    String? description,
    String? partition,
    ServerTransport? transport,
    ServerStatus? status,
    String? endpoint,
    CredentialType? credentialType,
    DateTime? lastSeen,
    bool? favorite,
  }) {
    return McpServer(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      partition: partition ?? this.partition,
      transport: transport ?? this.transport,
      status: status ?? this.status,
      endpoint: endpoint ?? this.endpoint,
      credentialType: credentialType ?? this.credentialType,
      lastSeen: lastSeen ?? this.lastSeen,
      favorite: favorite ?? this.favorite,
    );
  }
}
