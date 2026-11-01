async function run(input, context, api) {
  if (context.tool.name === 'workspace_summary') {
    const [servers, partitions] = await Promise.all([api.servers.list(), api.partitions.list()])
    return { plugin: context.plugin.id, servers, partitions }
  }
  if (context.tool.name === 'create_partition') {
    return api.partitions.create({ name: input.name, description: input.description })
  }
  if (context.tool.name === 'security_probe') {
    let denied = false
    let network = false
    try { await api.credentials.list() } catch (error) { denied = String(error).includes('credentials.read') }
    try { await fetch('http://127.0.0.1:9/plugin-network-probe'); network = true } catch { /* blocked by host session */ }
    return {
      denied,
      node: typeof process !== 'undefined' || typeof require !== 'undefined',
      network,
    }
  }
  throw new Error('Unknown tool')
}
