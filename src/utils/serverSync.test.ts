import { describe, expect, it } from 'vitest'
import { runServerOperation, runServerTask, trackStatusRefresh } from './serverSync'

describe('单服务器状态与操作串行化', () => {
  it('后到的启动任务等待较早的状态刷新完成', async () => {
    const events: string[] = []
    let finishRefresh!: () => void
    const gate = new Promise<void>((resolve) => { finishRefresh = resolve })
    const refresh = runServerTask('terrafin', async () => {
      events.push('refresh:start')
      await gate
      events.push('refresh:end')
    })
    const start = runServerTask('terrafin', async () => { events.push('start') })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['refresh:start'])
    finishRefresh()
    await Promise.all([refresh, start])
    expect(events).toEqual(['refresh:start', 'refresh:end', 'start'])
  })

  it('不同服务器保持并行，失败任务不会阻塞后续操作', async () => {
    const events: string[] = []
    await Promise.all([
      runServerTask('a', async () => { events.push('a') }),
      runServerTask('b', async () => { events.push('b') }),
    ])
    await expect(runServerTask('a', async () => { throw new Error('failed') })).rejects.toThrow('failed')
    await expect(runServerTask('a', async () => 'recovered')).resolves.toBe('recovered')
    expect(events.sort()).toEqual(['a', 'b'])
  })

  it('新配置服务器的启动也等待此前已触发的全局刷新', async () => {
    const events: string[] = []
    let finishRefresh!: () => void
    const refresh = new Promise<void>((resolve) => { finishRefresh = resolve })
    trackStatusRefresh(refresh)
    const start = runServerOperation('new-terrafin', async () => { events.push('start') })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual([])
    finishRefresh()
    await start
    expect(events).toEqual(['start'])
  })
})
