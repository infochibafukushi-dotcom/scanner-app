type Props = {
  message: string
  actionLabel?: string
  onAction?: () => void
  onDismiss?: () => void
}

export function Toast({ message, actionLabel, onAction, onDismiss }: Props) {
  return (
    <div className="redesign-toast" role="status">
      <span>{message}</span>
      <div className="redesign-toast-actions">
        {actionLabel && onAction && (
          <button type="button" onClick={onAction}>
            {actionLabel}
          </button>
        )}
        {onDismiss && (
          <button type="button" className="ghost" onClick={onDismiss} aria-label="閉じる">
            ×
          </button>
        )}
      </div>
    </div>
  )
}
