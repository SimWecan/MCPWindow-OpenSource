import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const files = {
  'darwin-arm64': `MCPWindow-${pkg.version}-arm64.dmg`,
  'win32-x64': `MCPWindow-Setup-${pkg.version}.exe`,
  browser: `MCPWindow-Companion-${pkg.version}.zip`,
}
const artifacts = Object.fromEntries(Object.entries(files).map(([platform, name]) => {
  const content = fs.readFileSync(path.join(root, 'release', name))
  return [platform, {
    url: `https://software.terrafin.top/downloads/${name}`,
    size: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  }]
}))
const destination = path.join(root, 'website', 'downloads')
fs.mkdirSync(destination, { recursive: true })
fs.writeFileSync(path.join(destination, 'version.json'), `${JSON.stringify({ version: pkg.version, publishedAt: new Date().toISOString(), artifacts }, null, 2)}\n`)
console.log(`✓ 已生成 ${pkg.version} 下载站版本清单`)
