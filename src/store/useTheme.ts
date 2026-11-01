import { create } from 'zustand'
import { applyTheme, readStoredTheme, type ThemeId } from '../utils/theme'

interface ThemeState {
  theme: ThemeId
  setTheme: (theme: ThemeId) => void
}

export const useTheme = create<ThemeState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
}))
