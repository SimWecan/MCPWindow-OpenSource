function moveItem(items, activeId, overId, after) {
  if (activeId === overId) return [...items]
  const rest = items.filter(id => id !== activeId)
  rest.splice(rest.indexOf(overId) + (after ? 1 : 0), 0, activeId)
  return rest
}

export function edgeScrollSpeed(pointerY, top, bottom, edge = 56, maxSpeed = 18) {
  if (bottom <= top || edge <= 0) return 0
  if (pointerY <= top + edge) return -Math.max(1, Math.ceil(maxSpeed * Math.min(1, Math.max(0, 1 - (pointerY - top) / edge))))
  if (pointerY >= bottom - edge) return Math.max(1, Math.ceil(maxSpeed * Math.min(1, Math.max(0, 1 - (bottom - pointerY) / edge))))
  return 0
}

/** 鼠标与触摸共用的长按排序；边缘自动滚动，点击和删除按钮不触发拖动。 */
export function attachCardInteractions(root, { onOpen, onReorder, holdMs = 500 }) {
  let drag = null
  let suppressClick = false
  const stopAutoScroll = () => {
    if (!drag || drag.scrollFrame === null) return
    cancelAnimationFrame(drag.scrollFrame)
    drag.scrollFrame = null
  }
  const cleanup = () => {
    if (!drag) return
    clearTimeout(drag.timer)
    stopAutoScroll()
    drag.card.style.transform = ''
    drag.card.style.zIndex = ''
    drag.card.removeAttribute('data-dragging')
    if (drag.card.hasPointerCapture(drag.id)) drag.card.releasePointerCapture(drag.id)
    root.querySelectorAll('[data-drop-target]').forEach(card => card.removeAttribute('data-drop-target'))
    drag = null
  }
  const renderDrag = (clientX, clientY) => {
    if (!drag) return
    const scrollDelta = drag.scrollParent.scrollTop - drag.initialScrollTop
    const rootRect = root.getBoundingClientRect()
    const dx = clientX - drag.x
    const dy = clientY - drag.y + scrollDelta
    const originalTop = drag.rect.top - scrollDelta
    const originalBottom = drag.rect.bottom - scrollDelta
    const x = Math.max(rootRect.left - drag.rect.left, Math.min(dx, rootRect.right - drag.rect.right))
    const y = Math.max(rootRect.top - originalTop, Math.min(dy, rootRect.bottom - originalBottom))
    drag.card.style.transform = `translate3d(${x}px,${y}px,0)`
    const over = [...root.querySelectorAll('[data-server-id]')].find(card => {
      if (card === drag.card) return false
      const rect = card.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    })
    root.querySelectorAll('[data-drop-target]').forEach(card => card.removeAttribute('data-drop-target'))
    drag.overId = over?.dataset.serverId || null
    if (over) {
      const rect = over.getBoundingClientRect()
      drag.after = clientY > rect.top + rect.height / 2
      over.dataset.dropTarget = drag.after ? 'after' : 'before'
    }
  }
  const scrollSpeed = () => drag ? edgeScrollSpeed(drag.clientY, 0, window.innerHeight) : 0
  const onAutoScroll = () => {
    if (!drag?.active) return
    drag.scrollFrame = null
    const speed = scrollSpeed()
    if (!speed) return
    const previous = drag.scrollParent.scrollTop
    drag.scrollParent.scrollTop = previous + speed
    if (drag.scrollParent.scrollTop === previous) return
    renderDrag(drag.clientX, drag.clientY)
    drag.scrollFrame = requestAnimationFrame(onAutoScroll)
  }
  const ensureAutoScroll = () => {
    if (drag?.active && drag.scrollFrame === null && scrollSpeed()) drag.scrollFrame = requestAnimationFrame(onAutoScroll)
  }
  root.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    if (event.target.closest('button,input,select,textarea,a,label')) return
    const card = event.target.closest('[data-server-id]')
    if (!card) return
    const scrollParent = document.scrollingElement || document.documentElement
    card.setPointerCapture(event.pointerId)
    drag = {
      id: event.pointerId, card, active: false, overId: null, after: false,
      x: event.clientX, y: event.clientY, clientX: event.clientX, clientY: event.clientY,
      rect: card.getBoundingClientRect(), scrollParent, initialScrollTop: scrollParent.scrollTop, scrollFrame: null,
    }
    drag.timer = setTimeout(() => {
      if (!drag) return
      drag.active = true
      card.dataset.dragging = 'true'
      card.style.zIndex = '10'
      ensureAutoScroll()
    }, holdMs)
  })
  root.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return
    drag.clientX = event.clientX
    drag.clientY = event.clientY
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.active) { if (Math.hypot(dx, dy) > 9) cleanup(); return }
    event.preventDefault()
    renderDrag(event.clientX, event.clientY)
    ensureAutoScroll()
  }, { passive: false })
  const finish = event => {
    if (!drag || event.pointerId !== drag.id) return
    const current = drag
    if (current.active && current.overId) {
      const ids = [...root.querySelectorAll('[data-server-id]')].map(card => card.dataset.serverId)
      onReorder(moveItem(ids, current.card.dataset.serverId, current.overId, current.after))
    }
    suppressClick = current.active
    cleanup()
    if (suppressClick) setTimeout(() => { suppressClick = false }, 0)
  }
  root.addEventListener('pointerup', finish)
  root.addEventListener('pointercancel', cleanup)
  root.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; return }
    if (event.target.closest('button,input,select,textarea,a,label')) return
    const card = event.target.closest('[data-server-id]')
    if (card) onOpen(card.dataset.serverId)
  }, true)
  root.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-server-id]')) {
      event.preventDefault(); onOpen(event.target.dataset.serverId)
    }
  })
}
