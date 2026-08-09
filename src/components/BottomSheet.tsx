import { ReactNode, useEffect } from 'react'

type Props = {
  open: boolean
  title?: string
  onClose: () => void
  children: ReactNode
  tall?: boolean
  className?: string
}

export function BottomSheet({ open, title, onClose, children, tall = false, className = '' }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="sheet-scrim redesign-sheet-scrim" onClick={onClose} role="presentation">
      <section
        className={`redesign-bottom-sheet ${tall ? 'tall' : ''} ${className}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'シート'}
      >
        <div className="sheet-handle" />
        {title && <h2 className="sheet-title">{title}</h2>}
        {children}
      </section>
    </div>
  )
}
