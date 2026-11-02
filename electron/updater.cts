import { app, ipcMain, net, shell, type IpcMainInvokeEvent } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

interface UpdateArtifact { url: string; sha256: string; size: number }

function validateArtifact(input: UpdateArtifact): UpdateArtifact {
  const url = new URL(input.url)
  if (url.protocol !== 'https:' || url.origin !== 'https://mcpwindow.terrafin.top') throw new Error('更新下载地址不受信任')
  if (!/^[a-f0-9]{64}$/i.test(input.sha256) || !Number.isSafeInteger(input.size) || input.size <= 0 || input.size > 600 * 1024 * 1024) throw new Error('更新包校验信息无效')
  return { url: url.href, sha256: input.sha256.toLowerCase(), size: input.size }
}

async function downloadAndVerify(event: IpcMainInvokeEvent, input: UpdateArtifact): Promise<string> {
  const artifact = validateArtifact(input)
  const response = await net.fetch(artifact.url, { cache: 'no-store' })
  if (!response.ok || !response.body) throw new Error(`安装包下载失败（HTTP ${response.status}）`)
  const directory = path.join(os.tmpdir(), 'MCPWindow-updates')
  fs.mkdirSync(directory, { recursive: true })
  const filePath = path.join(directory, path.basename(new URL(artifact.url).pathname))
  const temporary = `${filePath}.download`
  const hash = createHash('sha256')
  const reader = response.body.getReader()
  let received = 0
  const fd = fs.openSync(temporary, 'w')
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > artifact.size || received > 600 * 1024 * 1024) throw new Error('安装包大小与版本清单不符')
      hash.update(value)
      fs.writeSync(fd, value)
      event.sender.send('mcpwindow:update-progress', { received, total: artifact.size })
    }
  } finally {
    fs.closeSync(fd)
    reader.releaseLock()
  }
  if (received !== artifact.size || hash.digest('hex') !== artifact.sha256) {
    fs.rmSync(temporary, { force: true })
    throw new Error('安装包 SHA-256 校验失败，已取消更新')
  }
  fs.renameSync(temporary, filePath)
  return filePath
}

export function registerUpdateIpc(quitForUpdate: () => void): void {
  ipcMain.handle('mcpwindow:update-download', async (event, input: UpdateArtifact) => {
    const filePath = await downloadAndVerify(event, input)
    const error = await shell.openPath(filePath)
    if (error) throw new Error(`无法启动系统安装器：${error}`)
    quitForUpdate()
    return true
  })
}
