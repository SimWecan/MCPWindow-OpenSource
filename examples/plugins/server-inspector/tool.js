async function run(input, context, api) {
  const { servers } = await api.servers.list()
  if (context.tool.name === 'inspect_servers') {
    const summary = { total: servers.length, running: 0, stopped: 0, byTransport: {}, servers: [] }
    for (const server of servers) {
      if (server.status === 'running') summary.running += 1
      else summary.stopped += 1
      summary.byTransport[server.transport] = (summary.byTransport[server.transport] || 0) + 1
      summary.servers.push({ name: server.name, status: server.status, transport: server.transport, archived: server.archived })
    }
    return summary
  }
  if (context.tool.name === 'find_server') {
    const query = input.name.trim().toLowerCase()
    return servers.filter((server) => server.name.toLowerCase().includes(query)).map((server) => ({
      name: server.name, command: server.command, args: server.args,
      transport: server.transport, status: server.status, partitionId: server.partitionId,
    }))
  }
  throw new Error('Unknown tool')
}
