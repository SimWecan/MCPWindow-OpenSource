import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  headerAction?: ReactNode
  className?: string
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

export default function Modal({ title, open, onClose, children, footer, headerAction, className = '' }: Props) {
  const modalRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const modal = modalRef.current
    const focusables = () => Array.from(modal?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter((element) => element.getClientRects().length > 0)
    // 优先聚焦声明了 data-autofocus 的字段（如弹窗的主输入框），否则取第一个可聚焦元素。
    const preferred = modal?.querySelector<HTMLElement>('[data-autofocus]')
    if (preferred && focusables().includes(preferred)) preferred.focus()
    else focusables()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        modal?.focus()
        return
      }
      const anchor = items.find((element) => element.hasAttribute('data-autofocus')) ?? items[0]
      const last = items[items.length - 1]
      // Shift+Tab 从主输入框回绕到末尾按钮；Tab 从末尾回绕到主输入框。
      if (event.shiftKey && document.activeElement === anchor) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        anchor.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="modal-mask" onClick={onClose}>
      <div ref={modalRef} className={`modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id={titleId}>{title}</h3>
          {headerAction && <div className="modal-header-action">{headerAction}</div>}
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
