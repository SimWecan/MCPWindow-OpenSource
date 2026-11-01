/** 指针进入滚动区域上下边缘时返回逐帧滚动速度，离开边缘返回 0。 */
export function edgeScrollSpeed(pointerY: number, top: number, bottom: number, edge = 56, maxSpeed = 18): number {
  if (bottom <= top || edge <= 0) return 0
  if (pointerY <= top + edge) {
    const intensity = Math.min(1, Math.max(0, 1 - (pointerY - top) / edge))
    return -Math.max(1, Math.ceil(maxSpeed * intensity))
  }
  if (pointerY >= bottom - edge) {
    const intensity = Math.min(1, Math.max(0, 1 - (bottom - pointerY) / edge))
    return Math.max(1, Math.ceil(maxSpeed * intensity))
  }
  return 0
}
