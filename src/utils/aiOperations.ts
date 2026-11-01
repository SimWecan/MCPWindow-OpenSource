import { useStore } from '../store/useStore'
import type { AIServerAction, MCPServer } from '../types'
import { bridge, isControllable, operateServer } from './control'
import { canManage } from './management'

export function findAIActionTarget(action: AIServerAction): MCPServer {
  const server = useStore.getState().servers.find((item) => item.id === action.serverId && !item.archived)
  if (!server) throw new Error('目标服务器不存在或已归档，请重新获取实时状态')
  return server
}

/** 授权只开放进程操作；每次调用仍需由界面确认后触发。 */
export function validateAIAction(action: AIServerAction, permissionGranted: boolean): MCPServer {
  if (!permissionGranted) throw new Error('尚未开放服务器操作权限')
  const server = findAIActionTarget(action)
  if (!canManage(server) && !(bridge()?.procStart && isControllable(server))) {
    throw new Error(`服务器 ${server.name} 未配置可用管理能力，不能执行远程操作`)
  }
  return server
}

export async function executeAIAction(action: AIServerAction, permissionGranted: boolean): Promise<MCPServer> {
  const server = validateAIAction(action, permissionGranted)
  await operateServer(server, action.action)
  return server
}

export const AI_ACTION_LABEL = { start: '启动', stop: '停止', restart: '重启' } as const
