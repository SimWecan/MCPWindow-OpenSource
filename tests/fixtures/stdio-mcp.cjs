let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: {
          protocolVersion: '2024-11-05', capabilities: { tools: {} },
          serverInfo: { name: 'mcpwindow-e2e', version: '1.0.0' },
        },
      }) + '\n')
    } else if (message.method === 'tools/list') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { tools: [{
          name: 'echo', description: 'Echo text through stdio',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        }] },
      }) + '\n')
    } else if (message.method === 'tools/call') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: message.id,
        result: { content: [{ type: 'text', text: `stdio:${message.params.arguments.text}` }], isError: false },
      }) + '\n')
    }
  }
})
process.stdin.on('end', () => process.exit(0))
