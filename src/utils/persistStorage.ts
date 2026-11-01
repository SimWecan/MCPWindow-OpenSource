import type { StateStorage } from 'zustand/middleware'

interface SecureStorageBridge {
  isAvailable: () => Promise<boolean>
  encrypt: (value: string) => Promise<string>
  decrypt: (value: string) => Promise<string>
}

const PREFIX = 'mcpwindow-encrypted:v1:'
const memoryStorage = new Map<string, string>()
const browserStorage = (): Storage | undefined => typeof localStorage === 'undefined' ? undefined : localStorage
const secureBridge = (): SecureStorageBridge | undefined => {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { mcpwindow?: { secureStorage?: SecureStorageBridge } }).mcpwindow?.secureStorage
}

// 加密耗时不同会让旧快照后落盘；串行化写入，避免刷新后配置随机回退。
let writeQueue: Promise<void> = Promise.resolve()
function enqueue(operation: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(operation)
  writeQueue = next.catch(() => undefined)
  return next
}

/** 桌面版密文仍放 localStorage，但密钥由操作系统凭证库保护；浏览器预览保持原行为。 */
export const persistStorage: StateStorage = {
  async getItem(name) {
    await writeQueue
    const value = browserStorage()?.getItem(name) ?? memoryStorage.get(name) ?? null
    if (!value?.startsWith(PREFIX)) return value
    const secure = secureBridge()
    if (!secure || !(await secure.isAvailable())) throw new Error('系统加密存储不可用，无法读取本机配置')
    return secure.decrypt(value.slice(PREFIX.length))
  },
  setItem(name, value) {
    return enqueue(async () => {
      const secure = secureBridge()
      if (secure && !(await secure.isAvailable())) throw new Error('系统加密存储不可用，请启用系统凭证库')
      const stored = secure ? PREFIX + await secure.encrypt(value) : value
      const storage = browserStorage()
      if (storage) storage.setItem(name, stored)
      else memoryStorage.set(name, stored)
    })
  },
  removeItem(name) {
    return enqueue(async () => {
      browserStorage()?.removeItem(name)
      memoryStorage.delete(name)
    })
  },
}
