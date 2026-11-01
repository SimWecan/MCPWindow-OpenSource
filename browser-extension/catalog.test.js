import test from 'node:test'
import assert from 'node:assert/strict'
import { appendServerActivity, filterAndSortServers, readServerActivities } from './catalog.js'

const servers = [
  { id: '1', name: 'Zeta', url: 'https://zeta.example/mcp', status: 'online', lastProbeAt: 1 },
  { id: '2', name: 'Alpha', url: 'https://alpha.example/mcp', status: 'offline', lastProbeAt: 3 },
  { id: '3', name: 'Beta', url: 'https://beta.example/mcp', status: 'online', lastProbeAt: 2 },
]

test('服务器目录支持搜索、状态筛选和排序', () => {
  assert.deepEqual(filterAndSortServers(servers, 'ALPHA').map(item => item.id), ['2'])
  assert.deepEqual(filterAndSortServers(servers, '', 'online').map(item => item.id), ['1', '3'])
  assert.deepEqual(filterAndSortServers(servers, '', 'all', 'name').map(item => item.id), ['2', '3', '1'])
  assert.deepEqual(filterAndSortServers(servers, '', 'all', 'recent').map(item => item.id), ['2', '3', '1'])
  assert.deepEqual(filterAndSortServers(servers, '', 'all', 'status').map(item => item.id), ['2', '3', '1'])
})

test('服务器操作记录最多保留 50 条且忽略损坏内容', () => {
  let activities = []
  for (let i = 0; i < 55; i++) activities = appendServerActivity(activities, { action: 'refresh', serverName: `Server ${i}`, ok: true, message: '完成' })
  assert.equal(activities.length, 50)
  assert.equal(activities[0].serverName, 'Server 54')
  assert.equal(readServerActivities(null).length, 0)
  assert.deepEqual(readServerActivities([{ bad: true }, activities[0]]), [activities[0]])
})
