export function filterAndSortServers(servers, query = '', status = 'all', sort = 'custom') {
  const keyword = query.trim().toLowerCase()
  const filtered = servers.filter(server => {
    if (status !== 'all' && (server.status || 'unknown') !== status) return false
    return !keyword || `${server.name} ${server.url}`.toLowerCase().includes(keyword)
  })
  if (sort === 'name') return filtered.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === 'status') return filtered.sort((a, b) => (a.status || 'unknown').localeCompare(b.status || 'unknown') || a.name.localeCompare(b.name))
  if (sort === 'recent') return filtered.sort((a, b) => (b.lastProbeAt || 0) - (a.lastProbeAt || 0) || a.name.localeCompare(b.name))
  return filtered
}

export function readServerActivities(value) {
  if (!Array.isArray(value)) return []
  return value.filter(item => item && typeof item.id === 'string' && typeof item.serverName === 'string'
    && typeof item.ok === 'boolean' && typeof item.message === 'string' && Number.isFinite(item.ts)
    && ['add', 'remove', 'refresh', 'log-settings'].includes(item.action)).slice(0, 50)
}

export function appendServerActivity(activities, activity) {
  const next = { ...activity, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ts: Date.now() }
  return [next, ...readServerActivities(activities)].slice(0, 50)
}
