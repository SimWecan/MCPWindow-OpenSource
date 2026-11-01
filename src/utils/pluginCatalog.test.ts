import { describe, expect, it, vi } from 'vitest'
import type { ToolPlugin } from '../types'
import { appendPluginActivity, filterAndSortPlugins, PLUGIN_ACTIVITY_KEY, readPluginActivities } from './pluginCatalog'

const plugin = (id: string, patch: Partial<ToolPlugin> = {}): ToolPlugin => ({
  id, name: id, version: '1.0.0', description: '', entry: 'index.js', permissions: [], tools: [], enabled: false,
  signatureStatus: 'unsigned', trustedSource: false, installedAt: 1, ...patch,
})

describe('插件目录筛选与排序', () => {
  const plugins = [
    plugin('beta', { name: 'Beta', version: '1.10.0', enabled: true, publisher: 'Alice', description: '日志分析' }),
    plugin('alpha', { name: 'Alpha', version: '1.2.0', publisher: 'Bob' }),
  ]

  it('按名称、描述、发布者搜索并筛选启停状态', () => {
    expect(filterAndSortPlugins(plugins, '日志', 'all', 'name').map((item) => item.id)).toEqual(['beta'])
    expect(filterAndSortPlugins(plugins, 'bob', 'all', 'name').map((item) => item.id)).toEqual(['alpha'])
    expect(filterAndSortPlugins(plugins, '', 'enabled', 'name').map((item) => item.id)).toEqual(['beta'])
    expect(filterAndSortPlugins(plugins, '', 'disabled', 'name').map((item) => item.id)).toEqual(['alpha'])
    expect(filterAndSortPlugins(plugins, 'missing', 'all', 'name')).toEqual([])
  })

  it('使用语义化数字版本排序且名称排序稳定', () => {
    expect(filterAndSortPlugins(plugins, '', 'all', 'name').map((item) => item.id)).toEqual(['alpha', 'beta'])
    expect(filterAndSortPlugins(plugins, '', 'all', 'version').map((item) => item.id)).toEqual(['beta', 'alpha'])
    expect(filterAndSortPlugins(plugins, '', 'all', 'publisher').map((item) => item.id)).toEqual(['beta', 'alpha'])
  })
})

describe('插件操作记录', () => {
  it('保存真实结果、限制 50 条并忽略损坏数据', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    for (let index = 0; index < 55; index++) appendPluginActivity({ action: 'enable', pluginName: `p${index}`, ok: index % 2 === 0, message: `result-${index}` }, storage)
    const activities = readPluginActivities(storage)
    expect(activities).toHaveLength(50)
    expect(activities[0]).toMatchObject({ pluginName: 'p54', ok: true, message: 'result-54', ts: 1_700_000_000_000 })
    values.set(PLUGIN_ACTIVITY_KEY, '{bad json')
    expect(readPluginActivities(storage)).toEqual([])
    vi.restoreAllMocks()
  })
})
