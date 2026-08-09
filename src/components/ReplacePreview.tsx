type ReplacePreviewProps = {
  oldUrl: string
  newUrl: string
  pageNumber: number
  onRetake: () => void
  onConfirm: () => void
  onCancel: () => void
}

export function ReplacePreview({ oldUrl, newUrl, pageNumber, onRetake, onConfirm, onCancel }: ReplacePreviewProps) {
  return (
    <div className="dialog-scrim replace-scrim" role="dialog" aria-modal="true" aria-label="撮り直し確認">
      <section className="replace-dialog">
        <h2>ページ {pageNumber} を差し替えますか？</h2>
        <p>この写真に差し替えますか？</p>
        <div className="replace-compare">
          <figure>
            <img src={oldUrl} alt="現在の画像" />
            <figcaption>現在</figcaption>
          </figure>
          <figure>
            <img src={newUrl} alt="新しい画像" />
            <figcaption>新しい写真</figcaption>
          </figure>
        </div>
        <div className="replace-actions">
          <button type="button" className="secondary-button" onClick={onRetake}>
            もう一度撮影
          </button>
          <button type="button" className="primary-button" onClick={onConfirm}>
            この画像に変更
          </button>
        </div>
        <button type="button" className="text-button" onClick={onCancel}>
          キャンセル
        </button>
      </section>
    </div>
  )
}
