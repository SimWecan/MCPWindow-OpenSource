export interface SignableManifest { signature?: string }
export type PluginSignatureStatus = 'unsigned' | 'valid' | 'invalid'
export function stableSerialize(value: unknown): string
export function pluginDigest<T extends object>(manifest: T, entry: Buffer): string
export function verifyPluginSignature<T extends object>(manifest: T, entry: Buffer): PluginSignatureStatus
export function compareVersions(left: string, right: string): number
