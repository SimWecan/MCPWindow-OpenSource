export interface CredentialFormPayload {
  name: string
  scopes: string[]
  rateLimitPerMin: number
  expiresDays: number
  enabled: boolean
  role: 'read' | 'write' | 'admin'
}

export function generateLocalKey(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return `mcpsk_live_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function buildManagedCredentialPayload(
  form: CredentialFormPayload,
  partitionName: (id: string) => string | undefined,
  options: { editing: boolean; expiryTouched: boolean; preserveGlobalRole: boolean },
): Record<string, unknown> {
  const expiresAt = form.expiresDays > 0 ? new Date(Date.now() + form.expiresDays * 86400_000).toISOString() : null
  return {
    name: form.name,
    ...(options.preserveGlobalRole ? {} : {
      grants: Object.fromEntries(form.scopes.map((id) => [partitionName(id), form.role])),
    }),
    rate_limit_per_min: form.rateLimitPerMin,
    enabled: form.enabled,
    ...(!options.editing || options.expiryTouched ? { expires_at: expiresAt } : {}),
  }
}
