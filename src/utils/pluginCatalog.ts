import type { ToolPlugin } from '../types'

export type PluginStatusFilter = 'all' | 'enabled' | 'disabled'
export type PluginSort = 'name' | 'version' | 'publisher'
export type PluginActivityAction = 'import' | 'enable' | 'disable' | 'remove' | 'check-update'

export interface PluginActivity {
  id: string
  action: PluginActivityAction
  pluginName: string
  ok: boolean
  message: string
  ts: number
}

export const PLUGIN_ACTIVITY_KEY = 'mcpwindow-plugin-activities-v1'
const MAX_ACTIVITIES = 50

export function filterAndSortPlugins(
  plugins: ToolPlugin[], query: string, status: PluginStatusFilter, sort: PluginSort,
): ToolPlugin[] {
  const keyword = query.trim().toLowerCase()
  return plugins.filter((plugin) => {
    if (status === 'enabled' && !plugin.enabled) return false
    if (status === 'disabled' && plugin.enabled) return false
    return !keyword || `${plugin.name} ${plugin.id} ${plugin.description} ${plugin.publisher ?? ''}`.toLowerCase().includes(keyword)
  }).sort((a, b) => {
    if (sort === 'version') return b.version.localeCompare(a.version, undefined, { numeric: true }) || a.name.localeCompare(b.name)
    if (sort === 'publisher') return (a.publisher ?? '').localeCompare(b.publisher ?? '') || a.name.localeCompare(b.name)
    return a.name.localeCompare(b.name)
  })
}

export function readPluginActivities(storage: Pick<Storage, 'getItem'> = localStorage): PluginActivity[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(PLUGIN_ACTIVITY_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is PluginActivity => Boolean(item)
      && typeof item.id === 'string' && typeof item.pluginName === 'string'
      && typeof item.ok === 'boolean' && typeof item.message === 'string' && Number.isFinite(item.ts)
      && ['import', 'enable', 'disable', 'remove', 'check-update'].includes(item.action))
  } catch { return [] }
}

export function appendPluginActivity(
  activity: Omit<PluginActivity, 'id' | 'ts'>, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): PluginActivity[] {
  const next: PluginActivity = { ...activity, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ts: Date.now() }
  const activities = [next, ...readPluginActivities(storage)].slice(0, MAX_ACTIVITIES)
  storage.setItem(PLUGIN_ACTIVITY_KEY, JSON.stringify(activities))
  return activities
}
