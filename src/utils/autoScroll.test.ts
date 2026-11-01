import { describe, expect, it } from 'vitest'
import { edgeScrollSpeed } from './autoScroll'

describe('拖动边缘自动避让', () => {
  it('接近上下边缘时按距离滚动，中间区域不滚动', () => {
    expect(edgeScrollSpeed(700, 0, 720)).toBeGreaterThan(0)
    expect(edgeScrollSpeed(0, 0, 720)).toBeLessThan(0)
    expect(edgeScrollSpeed(360, 0, 720)).toBe(0)
    expect(Math.abs(edgeScrollSpeed(0, 0, 720))).toBe(18)
    expect(edgeScrollSpeed(714, 0, 720)).toBeGreaterThan(edgeScrollSpeed(700, 0, 720))
  })

  it('离开窗口或越过边缘时保持限幅，无效区域不滚动', () => {
    expect(edgeScrollSpeed(900, 0, 720)).toBe(18)
    expect(edgeScrollSpeed(-100, 0, 720)).toBe(-18)
    expect(edgeScrollSpeed(20, 100, 100)).toBe(0)
  })
})
