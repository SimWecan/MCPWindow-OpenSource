import { create } from 'zustand'

export type Language = 'zh' | 'en'

const STORAGE_KEY = 'mcpwindow-language'

function initialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

interface LanguageState {
  language: Language
  setLanguage: (language: Language) => void
}

export const useLanguage = create<LanguageState>((set) => ({
  language: initialLanguage(),
  setLanguage: (language) => {
    try { localStorage.setItem(STORAGE_KEY, language) } catch { /* storage unavailable */ }
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
    set({ language })
  },
}))
