import { useState } from 'react'
import { syncAllAccessLogs } from './accessLogSync'

/** 总览与日志统计共用的手动日志刷新；store 更新会驱动所有图表重新计算。 */
export function useAccessLogRefresh() {
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setMessage('')
    try {
      const result = await syncAllAccessLogs()
      const base = result.imported > 0 ? `日志已更新，新增 ${result.imported} 条记录` : '日志已刷新，暂无新增记录'
      setMessage(result.errors.length ? `${base}；${result.errors.length} 台服务器同步失败` : base)
    } catch (error) {
      setMessage(`日志刷新失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRefreshing(false)
    }
  }

  return { refresh, refreshing, message }
}
