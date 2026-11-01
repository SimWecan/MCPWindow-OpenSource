import { describe, expect, it } from 'vitest'
import { translateText } from './index'

describe('中英文界面资源', () => {
  it('翻译静态界面、动态计数和操作结果', () => {
    expect(translateText('服务器管理', 'en')).toBe('Servers')
    expect(translateText('共 6 个分区', 'en')).toBe('6 partitions')
    expect(translateText('TerraFin启动成功，已核实真实运行状态', 'en')).toBe('TerraFin start succeeded; actual state verified')
  })

  it('中文模式保留原文且不翻译用户数据', () => {
    expect(translateText('服务器管理', 'zh')).toBe('服务器管理')
    expect(translateText('自定义服务器名称', 'en')).toBe('自定义服务器名称')
  })
})
