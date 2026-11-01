import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { probeHttp } from './probe'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()))
})

describe('远程 MCP 真实 HTTP 握手', () => {
  it('使用普通 Bearer 凭证通过鉴权并完成 initialize', async () => {
    const server = createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer ordinary-access-key') {
        res.writeHead(401).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        jsonrpc: '2.0', id: 1,
        result: {
          protocolVersion: '2024-11-05', capabilities: { tools: {} },
          serverInfo: { name: 'auth-fixture', version: '1.0.0' },
        },
      }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`

    expect(await probeHttp(url)).toBe('auth')
    expect(await probeHttp(url, 8000, { Authorization: 'Bearer ordinary-access-key' })).toBe('online')
  })
})
