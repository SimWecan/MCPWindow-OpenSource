/** 将拖动项插入目标项之前或之后，不产生重复或丢失。 */
export function moveItem<T>(items: T[], activeId: T, overId: T, after = false): T[] {
  if (activeId === overId || !items.includes(activeId) || !items.includes(overId)) return [...items]
  const remaining = items.filter((item) => item !== activeId)
  const targetIndex = remaining.indexOf(overId)
  remaining.splice(targetIndex + (after ? 1 : 0), 0, activeId)
  return remaining
}

/** 只重排当前可见项，隐藏项继续占据原有位置并保持相对顺序。 */
export function reorderVisible<T extends { id: string }>(items: T[], orderedVisibleIds: string[]): T[] {
  const visibleIds = new Set(orderedVisibleIds)
  if (visibleIds.size !== orderedVisibleIds.length) return [...items]
  const ordered = new Map(orderedVisibleIds.map((id, index) => [id, index]))
  const replacements = items.filter((item) => visibleIds.has(item.id)).sort((a, b) => (ordered.get(a.id) ?? 0) - (ordered.get(b.id) ?? 0))
  let index = 0
  return items.map((item) => visibleIds.has(item.id) ? replacements[index++] : item)
}
