export type AccessAuthType = 'bearer' | 'basic' | 'api-key'

export interface AccessAuthConfig {
  type: AccessAuthType
  credential: string
  username?: string
  headerName?: string
}

/** 从请求头读取普通 MCP Bearer 凭证，兼容不同字段大小写。 */
export function getBearerCredential(headers?: Record<string, string>): string {
  const entry = Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'authorization')
  const match = entry?.[1].match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? ''
}

function encodeBasic(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeBasicCredential(value: string): { username: string; credential: string } {
  try {
    const binary = atob(value)
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
    const separator = decoded.indexOf(':')
    return separator < 0 ? { username: decoded, credential: '' } : { username: decoded.slice(0, separator), credential: decoded.slice(separator + 1) }
  } catch { return { username: '', credential: '' } }
}

/** 构造真实 HTTP 认证请求头；未填写凭证时不改写已有自定义请求头。 */
export function withAccessCredential(headers: Record<string, string> | undefined, config: AccessAuthConfig): Record<string, string> | undefined {
  const headerName = config.type === 'api-key' ? (config.headerName?.trim() || 'X-API-Key') : 'Authorization'
  const remaining = Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => {
    const lower = name.toLowerCase()
    return lower !== 'authorization' && (config.type !== 'api-key' || lower !== headerName.toLowerCase())
  }))
  const key = config.credential.trim()
  if (key || (config.type === 'basic' && config.username)) {
    remaining[headerName] = config.type === 'bearer' ? `Bearer ${key}`
      : config.type === 'basic' ? `Basic ${encodeBasic(`${config.username ?? ''}:${key}`)}` : key
  }
  return Object.keys(remaining).length ? remaining : undefined
}

/** 旧 API 保持 Bearer 行为，供导入兼容逻辑使用。 */
export function withBearerCredential(headers: Record<string, string> | undefined, credential: string): Record<string, string> | undefined {
  return withAccessCredential(headers, { type: 'bearer', credential })
}

export function validateHeaderName(value: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value.trim())
}
