import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { get } from 'node:https'
import { compareVersions, verifyPluginSignature, type PluginSignatureStatus } from './pluginTrust.cjs'

const PERMISSIONS = new Set(['servers.read', 'servers.operate', 'partitions.read', 'partitions.write', 'credentials.read', 'credentials.write'])
const ACTION_PERMISSION: Record<string, string> = {
  'servers.list': 'servers.read', 'servers.status': 'servers.read', 'servers.operate': 'servers.operate',
  'partitions.list': 'partitions.read', 'partitions.create': 'partitions.write', 'partitions.delete': 'partitions.write',
  'credentials.list': 'credentials.read', 'credentials.issue': 'credentials.write', 'credentials.revoke': 'credentials.write',
}

export interface PluginTool {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  entry: string
  permissions: string[]
  tools: PluginTool[]
  publisher?: string
  homepage?: string
  updateUrl?: string
  signature?: string
}

export interface InstalledPlugin extends PluginManifest {
  enabled: boolean
  installedAt: number
  signatureStatus: PluginSignatureStatus
  sourceDirectory?: string
  trustedSource: boolean
}

export interface PluginUpdateResult {
  id: string
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  signatureStatus: PluginSignatureStatus
}

interface PendingHostCall {
  pluginId: string
  resolve: (value: { ok: boolean; result?: unknown; error?: string }) => void
  timer: NodeJS.Timeout
}

const pluginWindows = new Map<BrowserWindow, string>()
const pendingHostCalls = new Map<string, PendingHostCall>()
const pluginsRoot = (): string => path.join(app.getPath('userData'), 'tool-plugins')
const pluginRoot = (id: string): string => path.join(pluginsRoot(), id)
const trustFile = (): string => path.join(app.getPath('userData'), 'plugin-trust.json')

function validateManifest(value: unknown): PluginManifest {
  const manifest = value as PluginManifest
  if (!manifest || typeof manifest !== 'object') throw new Error('plugin.json 格式无效')
  if (!/^[a-z0-9][a-z0-9.-]{1,79}$/.test(manifest.id)) throw new Error('插件 id 只能包含小写字母、数字、点和连字符')
  if (!manifest.name?.trim() || !manifest.version?.trim()) throw new Error('插件必须声明 name 和 version')
  compareVersions(manifest.version, manifest.version)
  if (typeof manifest.entry !== 'string' || !manifest.entry.endsWith('.js') || path.isAbsolute(manifest.entry) || manifest.entry.split(/[\\/]/).includes('..')) {
    throw new Error('插件 entry 必须是包内相对 .js 文件')
  }
  if (!Array.isArray(manifest.permissions) || manifest.permissions.some((permission) => !PERMISSIONS.has(permission))) throw new Error('插件包含不支持的权限声明')
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) throw new Error('插件至少需要声明一个工具')
  if (manifest.updateUrl && !manifest.updateUrl.startsWith('https://')) throw new Error('插件更新地址必须使用 HTTPS')
  const names = new Set<string>()
  for (const tool of manifest.tools) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(tool.name) || names.has(tool.name)) throw new Error('工具名称无效或重复')
    names.add(tool.name)
  }
  return manifest
}

export function listTrustedSources(): string[] {
  try {
    const values = JSON.parse(fs.readFileSync(trustFile(), 'utf8'))
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string').map((value) => path.resolve(value)) : []
  } catch { return [] }
}

function withinDirectory(directory: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(directory))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function sourceTrusted(source?: string): boolean {
  return Boolean(source && listTrustedSources().some((parent) => withinDirectory(source, parent)))
}

export function addTrustedSource(directory: string): string[] {
  const source = path.resolve(directory)
  if (!fs.statSync(source).isDirectory()) throw new Error('受信任来源必须是有效目录')
  const values = listTrustedSources()
  if (!values.some((item) => withinDirectory(item, source) || withinDirectory(source, item))) values.push(source)
  fs.writeFileSync(trustFile(), JSON.stringify(values.sort(), null, 2))
  return values.sort()
}

export function removeTrustedSource(directory: string): string[] {
  const values = listTrustedSources().filter((item) => item !== path.resolve(directory))
  fs.writeFileSync(trustFile(), JSON.stringify(values, null, 2))
  return values
}

function readInstalled(id: string): InstalledPlugin {
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(pluginRoot(id), 'plugin.json'), 'utf8')))
  if (manifest.id !== id) throw new Error('插件目录与 id 不一致')
  const signatureStatus = verifyPluginSignature(manifest, fs.readFileSync(path.join(pluginRoot(id), manifest.entry)))
  let enabled = false
  try { enabled = JSON.parse(fs.readFileSync(path.join(pluginRoot(id), 'state.json'), 'utf8')).enabled === true } catch { /* default disabled */ }
  let installedAt = 0
  let sourceDirectory: string | undefined
  try { installedAt = fs.statSync(path.join(pluginRoot(id), 'plugin.json')).mtimeMs } catch { /* ignored */ }
  try { sourceDirectory = JSON.parse(fs.readFileSync(path.join(pluginRoot(id), 'install.json'), 'utf8')).sourceDirectory } catch { /* old plugin */ }
  return { ...manifest, enabled, installedAt, signatureStatus, sourceDirectory, trustedSource: sourceTrusted(sourceDirectory) }
}

export function listPlugins(): InstalledPlugin[] {
  try {
    return fs.readdirSync(pluginsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => readInstalled(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch { return [] }
}

export function importPlugin(sourceDirectory: string): InstalledPlugin {
  const source = path.resolve(sourceDirectory)
  const manifestPath = path.join(source, 'plugin.json')
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  const entrySource = path.resolve(source, manifest.entry)
  if (!entrySource.startsWith(`${source}${path.sep}`) || !fs.statSync(entrySource).isFile()) throw new Error('插件入口文件无效')
  if (fs.statSync(entrySource).size > 256_000 || fs.statSync(manifestPath).size > 64_000) throw new Error('插件文件过大')
  if (verifyPluginSignature(manifest, fs.readFileSync(entrySource)) === 'invalid') throw new Error('插件完整性校验失败，已拒绝导入')
  const destination = pluginRoot(manifest.id)
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(path.join(destination, manifest.entry)), { recursive: true })
  fs.copyFileSync(manifestPath, path.join(destination, 'plugin.json'))
  fs.copyFileSync(entrySource, path.join(destination, manifest.entry))
  fs.writeFileSync(path.join(destination, 'state.json'), JSON.stringify({ enabled: false }))
  fs.writeFileSync(path.join(destination, 'install.json'), JSON.stringify({ sourceDirectory: source }))
  return readInstalled(manifest.id)
}

function fetchBuffer(url: string, redirects = 0): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) { reject(new Error('更新地址必须使用 HTTPS')); return }
    const request = get(url, { headers: { 'User-Agent': 'MCPWindow-Plugin-Update' } }, (response) => {
      const location = response.headers.location
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location && redirects < 3) {
        response.resume()
        resolve(fetchBuffer(new URL(location, url).toString(), redirects + 1))
        return
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`更新检查返回 HTTP ${response.statusCode}`)); return }
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > 256_000) { request.destroy(new Error('更新文件过大')); return }
        chunks.push(chunk)
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    request.setTimeout(10_000, () => request.destroy(new Error('更新检查超时')))
    request.on('error', reject)
  })
}

export async function checkPluginUpdate(id: string): Promise<PluginUpdateResult> {
  const installed = readInstalled(id)
  if (!installed.updateUrl) throw new Error('该插件未配置 HTTPS 更新地址')
  let remote: PluginManifest
  try { remote = validateManifest(JSON.parse((await fetchBuffer(installed.updateUrl)).toString('utf8'))) } catch (reason) {
    if (reason instanceof SyntaxError) throw new Error('更新清单不是有效 JSON')
    throw reason
  }
  if (remote.id !== installed.id) throw new Error('更新清单的插件 id 不匹配')
  const entryUrl = new URL(remote.entry, installed.updateUrl).toString()
  const signatureStatus = verifyPluginSignature(remote, await fetchBuffer(entryUrl))
  if (signatureStatus === 'invalid') throw new Error('远程插件完整性校验失败')
  return {
    id, currentVersion: installed.version, latestVersion: remote.version,
    updateAvailable: compareVersions(remote.version, installed.version) > 0,
    signatureStatus,
  }
}

export function removePlugin(id: string): boolean {
  for (const [win, pluginId] of pluginWindows) if (pluginId === id) win.destroy()
  fs.rmSync(pluginRoot(id), { recursive: true, force: true })
  return true
}

export function setPluginEnabled(id: string, enabled: boolean): InstalledPlugin {
  const plugin = readInstalled(id)
  if (enabled && plugin.signatureStatus === 'invalid') throw new Error('插件完整性校验失败，不能启用')
  fs.writeFileSync(path.join(pluginRoot(id), 'state.json'), JSON.stringify({ enabled: Boolean(enabled) }))
  if (!enabled) for (const [win, pluginId] of pluginWindows) if (pluginId === id) win.destroy()
  return { ...plugin, enabled: Boolean(enabled) }
}

export function handlePluginHostResult(id: string, ok: boolean, result?: unknown, error?: string): void {
  const call = pendingHostCalls.get(id)
  if (!call) return
  clearTimeout(call.timer)
  pendingHostCalls.delete(id)
  call.resolve({ ok, result, error })
}

function rejectPluginCalls(pluginId: string, reason: string): void {
  for (const [id, call] of pendingHostCalls) {
    if (call.pluginId !== pluginId) continue
    clearTimeout(call.timer)
    pendingHostCalls.delete(id)
    call.resolve({ ok: false, error: reason })
  }
}

function forwardHostCall(pluginId: string, action: string, args: unknown): Promise<unknown> {
  const plugin = readInstalled(pluginId)
  const permission = ACTION_PERMISSION[action]
  if (!permission || !plugin.permissions.includes(permission)) return Promise.reject(new Error(`插件未声明权限：${permission ?? action}`))
  const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed() && !pluginWindows.has(item))
  if (!win) return Promise.reject(new Error('MCPWindow 宿主界面尚未就绪'))
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHostCalls.delete(id)
      reject(new Error('宿主 API 调用超时'))
    }, 90_000)
    pendingHostCalls.set(id, {
      pluginId, timer,
      resolve: (value) => value.ok ? resolve(value.result) : reject(new Error(value.error ?? '宿主 API 调用失败')),
    })
    win.webContents.send('mcpwindow:plugin-host-call', id, action, args)
  })
}

export async function callPluginTool(id: string, toolName: string, args: unknown): Promise<unknown> {
  const plugin = readInstalled(id)
  if (!plugin.enabled) throw new Error('插件未启用')
  if (plugin.signatureStatus === 'invalid') throw new Error('插件完整性校验失败，已阻止执行')
  if (!plugin.tools.some((tool) => tool.name === toolName)) throw new Error('插件未声明该工具')
  const source = fs.readFileSync(path.join(pluginRoot(id), plugin.entry), 'utf8')
  const win = new BrowserWindow({
    show: false, width: 640, height: 480,
    webPreferences: {
      preload: path.join(__dirname, 'pluginPreload.cjs'),
      partition: 'mcpwindow-plugin-host',
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
    },
  })
  pluginWindows.set(win, id)
  win.on('closed', () => {
    pluginWindows.delete(win)
    rejectPluginCalls(id, '插件运行已终止')
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /^(https?|wss?):/i.test(details.url) })
  })
  const timeout = setTimeout(() => win.destroy(), 15_000)
  try {
    await win.loadURL('data:text/html;charset=utf-8,<html><body>MCPWindow plugin host</body></html>')
    return await win.webContents.executeJavaScript(`(async () => {
      const source = ${JSON.stringify(source)};
      const input = ${JSON.stringify(args ?? {})};
      const host = (action, args) => window.mcpPluginHost.invoke(action, args);
      const api = Object.freeze({
        servers: Object.freeze({ list: () => host('servers.list', {}), status: (serverId) => host('servers.status', { serverId }), operate: (serverId, action) => host('servers.operate', { serverId, action }) }),
        partitions: Object.freeze({ list: () => host('partitions.list', {}), create: (args) => host('partitions.create', args), delete: (partitionId) => host('partitions.delete', { partitionId }) }),
        credentials: Object.freeze({ list: () => host('credentials.list', {}), issue: (args) => host('credentials.issue', args), revoke: (credentialId) => host('credentials.revoke', { credentialId }) }),
      });
      const context = Object.freeze({ plugin: Object.freeze({ id: ${JSON.stringify(plugin.id)}, version: ${JSON.stringify(plugin.version)} }), tool: Object.freeze({ name: ${JSON.stringify(toolName)} }) });
      const runPlugin = new Function('input', 'context', 'api', '"use strict";\\n' + source + '\\nreturn run(input, context, api);');
      return await runPlugin(input, context, api);
    })()`, true)
  } finally {
    clearTimeout(timeout)
    if (!win.isDestroyed()) win.destroy()
    pluginWindows.delete(win)
  }
}

export function registerPluginIpc(): void {
  ipcMain.handle('mcpwindow:plugin-list', () => listPlugins())
  ipcMain.handle('mcpwindow:plugin-import', (_event, source: string) => importPlugin(source))
  ipcMain.handle('mcpwindow:plugin-remove', (_event, id: string) => removePlugin(id))
  ipcMain.handle('mcpwindow:plugin-set-enabled', (_event, id: string, enabled: boolean) => setPluginEnabled(id, enabled))
  ipcMain.handle('mcpwindow:plugin-call', (_event, id: string, tool: string, args: unknown) => callPluginTool(id, tool, args))
  ipcMain.handle('mcpwindow:plugin-check-update', (_event, id: string) => checkPluginUpdate(id))
  ipcMain.handle('mcpwindow:plugin-trust-list', () => listTrustedSources())
  ipcMain.handle('mcpwindow:plugin-trust-add', (_event, directory: string) => addTrustedSource(directory))
  ipcMain.handle('mcpwindow:plugin-trust-remove', (_event, directory: string) => removeTrustedSource(directory))
  ipcMain.handle('mcpwindow:plugin-host-invoke', (event, action: string, args: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const pluginId = win && pluginWindows.get(win)
    if (!pluginId) throw new Error('插件宿主调用来源无效')
    return forwardHostCall(pluginId, action, args)
  })
  ipcMain.on('mcpwindow:plugin-host-result', (event, id: string, ok: boolean, result?: unknown, error?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || pluginWindows.has(win) || !pendingHostCalls.has(id)) return
    handlePluginHostResult(id, ok, result, error)
  })
}

export function closePluginWindows(): void {
  for (const win of pluginWindows.keys()) if (!win.isDestroyed()) win.destroy()
  pluginWindows.clear()
}
