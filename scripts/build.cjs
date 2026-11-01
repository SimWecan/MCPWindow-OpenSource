// electron-builder 程序化打包入口（绕过 CLI 与新版 Node 的参数解析兼容问题）
// 注意：若本机 node 为 Electron 运行时（fs 被打 asar 补丁），必须关闭 asar 拦截才能写出 app.asar
process.noAsar = true
const path = require('node:path')
const { pathToFileURL } = require('node:url')
// source-map 0.7 在带全局 fetch 的新版 Node 中误走浏览器分支，显式初始化 WASM。
require('source-map').SourceMapConsumer.initialize({
  'lib/mappings.wasm': pathToFileURL(path.resolve(__dirname, '../node_modules/source-map/lib/mappings.wasm')).href,
})
const { build, Platform } = require('electron-builder')
const pkg = require('../package.json')

const dirOnly = process.argv.includes('--dir')
const windows = process.argv.includes('--win')
const output = process.env.MCPWINDOW_OUT || pkg.build.directories.output

build({
  targets: windows ? Platform.WINDOWS.createTarget(undefined, require('electron-builder').Arch.x64) : undefined,
  config: {
    ...pkg.build,
    // 本机平台使用 npm 已安装的匹配版本；可用环境变量指定其他平台的本地运行时。
    electronDist: process.env.MCPWINDOW_ELECTRON_DIST || (windows ? undefined : path.resolve(__dirname, '../node_modules/electron/dist')),
    directories: {
      ...pkg.build.directories,
      // 允许通过环境变量覆盖输出目录（例如原目录被文件锁占用时）
      output,
    },
  },
  ...(windows ? {} : { dir: dirOnly }),
  publish: 'never',
})
  .then(() => {
    console.log(`\n✔ 打包完成（${dirOnly ? '免安装目录' : '安装包'}）：${path.resolve(output)}`)
  })
  .catch((err) => {
    console.error('打包失败：', err)
    process.exit(1)
  })
