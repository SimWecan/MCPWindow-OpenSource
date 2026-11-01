import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { moveItem } from './reorder'
import { edgeScrollSpeed } from './autoScroll'

interface DragSession {
  pointerId: number
  card: HTMLElement
  startX: number
  startY: number
  clientX: number
  clientY: number
  cardRect: DOMRect
  scrollParent: HTMLElement
  initialScrollTop: number
  scrollFrame: number | null
  active: boolean
  overId: string | null
  after: boolean
  timer: ReturnType<typeof setTimeout>
}

/** 卡片长按排序：仅拖动视觉位置受容器约束，松手后一次性提交数据。 */
export function useLongPressReorder(
  containerRef: RefObject<HTMLElement | null>,
  onReorder: (orderedIds: string[]) => void,
  holdMs = 500,
) {
  const callbackRef = useRef(onReorder)
  useEffect(() => { callbackRef.current = onReorder }, [onReorder])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const container: HTMLElement = element
    let session: DragSession | null = null
    let suppressClick = false

    const stopAutoScroll = () => {
      if (!session || session.scrollFrame === null) return
      cancelAnimationFrame(session.scrollFrame)
      session.scrollFrame = null
    }

    const clearVisuals = () => {
      if (!session) return
      stopAutoScroll()
      session.card.style.transform = ''
      session.card.style.zIndex = ''
      session.card.removeAttribute('data-dragging')
      container.removeAttribute('data-sorting')
      container.querySelectorAll<HTMLElement>('[data-drop-target]').forEach((card) => card.removeAttribute('data-drop-target'))
      document.body.style.userSelect = ''
    }

    const removeListeners = () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onPointerCancel)
    }

    const cancel = () => {
      if (!session) return
      clearTimeout(session.timer)
      clearVisuals()
      session = null
      removeListeners()
    }

    function renderDrag(clientX: number, clientY: number) {
      if (!session) return
      const { cardRect, card, scrollParent, initialScrollTop } = session
      const scrollDelta = scrollParent.scrollTop - initialScrollTop
      const gridRect = container.getBoundingClientRect()
      const dx = clientX - session.startX
      const dy = clientY - session.startY + scrollDelta
      const originalTop = cardRect.top - scrollDelta
      const originalBottom = cardRect.bottom - scrollDelta
      const x = Math.max(gridRect.left - cardRect.left, Math.min(dx, gridRect.right - cardRect.right))
      const y = Math.max(gridRect.top - originalTop, Math.min(dy, gridRect.bottom - originalBottom))
      card.style.transform = `translate3d(${x}px, ${y}px, 0)`

      const candidates = [...container.querySelectorAll<HTMLElement>('[data-server-id]')]
        .filter((item) => item !== card)
      const over = candidates.find((item) => {
        const rect = item.getBoundingClientRect()
        return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      })
      container.querySelectorAll<HTMLElement>('[data-drop-target]').forEach((item) => item.removeAttribute('data-drop-target'))
      session.overId = over?.dataset.serverId ?? null
      if (over) {
        const rect = over.getBoundingClientRect()
        session.after = clientY > rect.top + rect.height / 2
          || (clientY >= rect.top && clientY <= rect.bottom && Math.abs(clientY - (rect.top + rect.height / 2)) < rect.height * 0.2 && clientX > rect.left + rect.width / 2)
        over.dataset.dropTarget = session.after ? 'after' : 'before'
      }
    }

    function scrollSpeed() {
      if (!session) return 0
      const rect = session.scrollParent.getBoundingClientRect()
      return edgeScrollSpeed(session.clientY, Math.max(0, rect.top), Math.min(window.innerHeight, rect.bottom))
    }

    function onAutoScroll() {
      if (!session?.active) return
      session.scrollFrame = null
      const speed = scrollSpeed()
      if (!speed) return
      const { scrollParent } = session
      const previous = scrollParent.scrollTop
      scrollParent.scrollTop = previous + speed
      if (scrollParent.scrollTop === previous) return
      renderDrag(session.clientX, session.clientY)
      session.scrollFrame = requestAnimationFrame(onAutoScroll)
    }

    function ensureAutoScroll() {
      if (session?.active && session.scrollFrame === null && scrollSpeed()) {
        session.scrollFrame = requestAnimationFrame(onAutoScroll)
      }
    }

    function onPointerMove(event: PointerEvent) {
      if (!session || event.pointerId !== session.pointerId) return
      session.clientX = event.clientX
      session.clientY = event.clientY
      const dx = event.clientX - session.startX
      const dy = event.clientY - session.startY
      if (!session.active) {
        if (Math.hypot(dx, dy) > 9) cancel()
        return
      }
      event.preventDefault()
      renderDrag(event.clientX, event.clientY)
      ensureAutoScroll()
    }

    function finish(commit: boolean) {
      if (!session) return
      const current = session
      clearTimeout(current.timer)
      if (commit && current.active && current.overId) {
        const ids = [...container.querySelectorAll<HTMLElement>('[data-server-id]')].map((card) => card.dataset.serverId!)
        const ordered = moveItem(ids, current.card.dataset.serverId!, current.overId, current.after)
        if (ordered.some((id, index) => id !== ids[index])) callbackRef.current(ordered)
      }
      suppressClick = current.active
      clearVisuals()
      session = null
      removeListeners()
      if (suppressClick) setTimeout(() => { suppressClick = false }, 0)
    }

    function onPointerUp(event: PointerEvent) {
      if (session?.pointerId === event.pointerId) finish(true)
    }
    function onPointerCancel() { cancel() }

    const onPointerDown = (event: PointerEvent) => {
      if (session || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
      const target = event.target instanceof Element ? event.target : null
      if (!target || target.closest('button,input,select,textarea,a,label,[contenteditable="true"]')) return
      const card = target.closest<HTMLElement>('[data-server-id]')
      if (!card || !container.contains(card) || !card.dataset.serverId) return
      const scrollParent = (container.closest<HTMLElement>('.main') ?? document.scrollingElement ?? document.documentElement) as HTMLElement
      session = {
        pointerId: event.pointerId, card, startX: event.clientX, startY: event.clientY,
        clientX: event.clientX, clientY: event.clientY,
        cardRect: card.getBoundingClientRect(), scrollParent, initialScrollTop: scrollParent.scrollTop, scrollFrame: null,
        active: false, overId: null, after: false,
        timer: setTimeout(() => {
          if (!session) return
          session.active = true
          session.card.dataset.dragging = 'true'
          session.card.style.zIndex = '20'
          container.dataset.sorting = 'true'
          document.body.style.userSelect = 'none'
          ensureAutoScroll()
        }, holdMs),
      }
      document.addEventListener('pointermove', onPointerMove, { passive: false })
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerCancel)
      window.addEventListener('blur', onPointerCancel)
    }

    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) return
      event.preventDefault()
      event.stopPropagation()
      suppressClick = false
    }
    const onContextMenu = (event: MouseEvent) => { if (session?.active) event.preventDefault() }
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('click', onClickCapture, true)
    container.addEventListener('contextmenu', onContextMenu)
    return () => {
      cancel()
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('click', onClickCapture, true)
      container.removeEventListener('contextmenu', onContextMenu)
    }
  }, [containerRef, holdMs])
}
