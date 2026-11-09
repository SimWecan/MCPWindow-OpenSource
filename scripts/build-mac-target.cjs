// 单次只打一个 mac 目标（zip 或 dmg），避免前台 300s 超时
process.noAsar = true
const path = require('node:path')
const { pathToFileURL } = require('node:url')
require('source-map').SourceMapConsumer.initialize({
  'lib/mappings.wasm': pathToFileURL(path.resolve(__dirname, '../node_modules/source-map/lib/mappings.wasm')).href,
})
const { build, Platform, Arch } = require('electron-builder')
const pkg = require('../package.json')

const target = process.argv[2] || 'zip'
build({
  targets: Platform.MAC.createTarget(target, Arch.arm64),
  config: {
    ...pkg.build,
    electronDist: path.resolve(__dirname, '../node_modules/electron/dist'),
    directories: { ...pkg.build.directories },
  },
  publish: 'never',
})
  .then(() => console.log(`\n✔ 目标 ${target} 打包完成`))
  .catch((err) => { console.error('打包失败：', err); process.exit(1) })
