export type ThemeId = 'aurora' | 'midnight' | 'daylight' | 'terrafin'

export const THEMES: Array<{
  id: ThemeId
  name: string
  description: string
  preview: { bg: string; side: string; accent: string; card: string }
}> = [
  { id: 'aurora', name: '极光紫', description: 'Logo 同款紫蓝渐变', preview: { bg: '#100d1c', side: '#191426', accent: '#a855f7', card: '#2c2141' } },
  { id: 'midnight', name: '暗夜蓝', description: '专注、克制深蓝', preview: { bg: '#0d1420', side: '#151e2d', accent: '#4f8dff', card: '#24334a' } },
  { id: 'daylight', name: '日光白', description: '明亮、柔和浅灰', preview: { bg: '#f4f5fa', side: '#ffffff', accent: '#8b5cf6', card: '#e8e3f2' } },
  { id: 'terrafin', name: '落日红', description: 'TerraFin 星际地平线系列配色', preview: { bg: '#1C1A24', side: '#232031', accent: '#E4572E', card: '#3B2A5A' } },
]

export const DEFAULT_THEME: ThemeId = 'aurora'
const STORAGE_KEY = 'mcpwindow-theme'

export function readStoredTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return THEMES.some((theme) => theme.id === saved) ? saved as ThemeId : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(theme: ThemeId, persist = true): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme === 'daylight' ? 'light' : 'dark'
  if (!persist) return
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 存储不可用时仍保持本次运行的主题切换能力。
  }
}
