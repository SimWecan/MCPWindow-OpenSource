import packageInfo from '../../package.json'

export const UPDATE_MANIFEST_URL = 'https://software.terrafin.top/downloads/version.json'

export interface UpdateArtifact {
  url: string
  sha256: string
  size: number
}
export interface UpdateResult {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  publishedAt?: string
  updateAvailable: boolean
  artifacts: Partial<Record<'darwin-arm64' | 'win32-x64' | 'browser', UpdateArtifact>>
}

export function compareVersions(current: string, latest: string): number {
  const parse = (version: string) => version.trim().replace(/^v/i, '').split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0)
  const left = parse(current)
  const right = parse(latest)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (right[index] || 0) - (left[index] || 0)
    if (difference) return difference
  }
  return 0
}

function artifact(value: unknown, manifestUrl: string): UpdateArtifact | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.url !== 'string' || typeof candidate.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(candidate.sha256)
    || typeof candidate.size !== 'number' || !Number.isSafeInteger(candidate.size) || candidate.size <= 0 || candidate.size > 600 * 1024 * 1024) return undefined
  const download = new URL(candidate.url, manifestUrl)
  if (download.protocol !== 'https:' || download.origin !== new URL(manifestUrl).origin) return undefined
  return { url: download.href, sha256: candidate.sha256.toLowerCase(), size: candidate.size }
}

export async function checkForUpdates(fetcher: typeof fetch = fetch): Promise<UpdateResult> {
  const response = await fetcher(UPDATE_MANIFEST_URL, { cache: 'no-store', signal: AbortSignal.timeout(12000) })
  if (response.status === 404) throw new Error('NO_RELEASE')
  if (!response.ok) throw new Error(`UPDATE_HTTP_${response.status}`)
  const manifest = await response.json() as Record<string, unknown>
  const latestVersion = typeof manifest.version === 'string' ? manifest.version.trim().replace(/^v/i, '') : ''
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(latestVersion)) throw new Error('INVALID_RELEASE')
  const artifacts = manifest.artifacts && typeof manifest.artifacts === 'object' ? manifest.artifacts as Record<string, unknown> : {}
  return {
    currentVersion: packageInfo.version,
    latestVersion,
    releaseUrl: 'https://software.terrafin.top/mcpwindowdownload.html',
    publishedAt: typeof manifest.publishedAt === 'string' ? manifest.publishedAt : undefined,
    updateAvailable: compareVersions(packageInfo.version, latestVersion) > 0,
    artifacts: {
      'darwin-arm64': artifact(artifacts['darwin-arm64'], UPDATE_MANIFEST_URL),
      'win32-x64': artifact(artifacts['win32-x64'], UPDATE_MANIFEST_URL),
      browser: artifact(artifacts.browser, UPDATE_MANIFEST_URL),
    },
  }
}
