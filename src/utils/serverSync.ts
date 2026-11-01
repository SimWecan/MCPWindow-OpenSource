const queues = new Map<string, Promise<void>>()
let statusRefresh: Promise<void> | null = null

/** 记录全局刷新屏障，使新配置的服务器也不会绕过尚未开始的下一轮刷新。 */
export function trackStatusRefresh(refresh: Promise<void>): void {
  const tracked = refresh.then(() => undefined, () => undefined)
  statusRefresh = tracked
  void tracked.then(() => {
    if (statusRefresh === tracked) statusRefresh = null
  })
}

/**
 * 同一台服务器的刷新与操作严格串行，避免较早的离线回读覆盖较新的启动结果。
 * 不同服务器仍可并行；失败不会阻塞后续任务。
 */
export async function runServerTask<T>(serverId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(serverId) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  const tail = run.then(() => undefined, () => undefined)
  queues.set(serverId, tail)
  try {
    return await run
  } finally {
    if (queues.get(serverId) === tail) queues.delete(serverId)
  }
}

/** 启动、停止、重启还需等待此前已触发的全局刷新，防止新服务器跳过刷新队列。 */
export async function runServerOperation<T>(serverId: string, task: () => Promise<T>): Promise<T> {
  if (statusRefresh) await statusRefresh
  return runServerTask(serverId, task)
}
