import { describe, expect, it } from 'vitest'
import { validateToolArguments } from './pluginArguments'

const schema = {
  properties: {
    name: { type: 'string' },
    count: { type: 'integer', minimum: 1, maximum: 5 },
    ratio: { type: 'number' },
    enabled: { type: 'boolean' },
    tags: { type: 'array' },
    options: { type: 'object' },
    mode: { type: 'string', enum: ['read', 'write'] },
  },
  required: ['name'],
}

describe('插件参数 Schema 校验', () => {
  it('识别缺失、空字符串和 null 必填参数', () => {
    expect(validateToolArguments(schema, {})).toEqual(['缺少必填参数: name'])
    expect(validateToolArguments(schema, { name: '' })).toEqual(['缺少必填参数: name'])
    expect(validateToolArguments(schema, { name: null })).toEqual(['缺少必填参数: name'])
  })

  it('校验标量、数组和对象类型', () => {
    const errors = validateToolArguments(schema, { name: 'demo', count: 1.5, ratio: '1', enabled: 1, tags: {}, options: [] })
    expect(errors).toEqual(expect.arrayContaining([
      '参数 count 类型应为 integer', '参数 ratio 类型应为 number',
      '参数 enabled 类型应为 boolean', '参数 tags 类型应为 array', '参数 options 类型应为 object',
    ]))
  })

  it('校验枚举和数值边界', () => {
    expect(validateToolArguments(schema, { name: 'demo', count: 0, mode: 'admin' })).toEqual(expect.arrayContaining(['参数 count 不能小于 1', '参数 mode 不在可选值中']))
    expect(validateToolArguments(schema, { name: 'demo', count: 6 })).toContain('参数 count 不能大于 5')
  })

  it('接受完整合法参数', () => {
    expect(validateToolArguments(schema, { name: 'demo', count: 2, ratio: 1.2, enabled: true, tags: [], options: {}, mode: 'read' })).toEqual([])
  })
})
