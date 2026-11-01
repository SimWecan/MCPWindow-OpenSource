import { describe, expect, it } from 'vitest'
import { moveItem, reorderVisible } from './reorder'

describe('手动卡片排序', () => {
  it('可向前或向后插入，且普通顺序不丢失', () => {
    expect(moveItem(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
  })

  it('只替换可见卡片的位置，隐藏卡片保持相对位置', () => {
    const items = [{ id: 'a' }, { id: 'hidden' }, { id: 'b' }, { id: 'c' }]
    expect(reorderVisible(items, ['c', 'b', 'a']).map((item) => item.id)).toEqual(['c', 'hidden', 'b', 'a'])
  })

  it('拒绝重复 ID，避免卡片重复或丢失', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    expect(reorderVisible(items, ['b', 'b'])).toEqual(items)
  })
})
