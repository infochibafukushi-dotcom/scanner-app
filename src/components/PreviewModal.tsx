import { useEffect, useState } from 'react'
import type { ScanPage } from '../types'
import { RENDER_MAX, renderScanPage } from '../utils/image'
import '../preview.css'

type PreviewIntent = 'preview' | 'save' | 'share' | 'text' | 'word'

type PreviewModalProps = {
  open: boolean
  pages: ScanPage[]
  fileName: string
  intent: PreviewIntent
  busy: boolean
  ocrStatus: string
  onClose: () => void
  onSave: () => void
  onShare: () => void
  onSaveText: () => void
  onSaveWord: () => void
}

export function PreviewModal({
  open,
  pages,
  fileName,
  intent,
  busy,
  ocrStatus,
  onClose,
  onSave,
  onShare,
  onSaveText,
  onSaveWord
}: PreviewModalProps) {
  const [images, setImages] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setImages([])

    Promise.all(
      pages.map(async (page) => {
        const canvas = await renderScanPage(page, RENDER_MAX.preview)
        return canvas.toDataURL('image/jpeg', 0.94)
      })
    )
      .then((next) => {
        if (!cancelled) setImages(next)
      })
      .catch((previewError) => {
        console.error(previewError)
        if (!cancelled) setError('プレビューの作成に失敗しました。四隅の位置を確認してください。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, pages])

  if (!open) return null

  return (
    <div className="preview-modal" role="dialog" aria-modal="true" aria-label="保存前プレビュー">
      <div className="preview-toolbar">
        <div>
          <strong>保存前の仕上がり確認</strong>
          <span>{fileName} / {pages.length}ページ</span>
        </div>
        <button type="button" className="camera-close" onClick={onClose} disabled={busy}>修正に戻る</button>
      </div>

      <div className="preview-content">
        {loading && <div className="preview-loading">補正後イメージを作成しています…</div>}
        {ocrStatus && <div className="preview-loading ocr-status">{ocrStatus}</div>}
        {error && <div className="preview-error">{error}</div>}
        {!loading && !error && images.map((image, index) => (
          <article className="preview-page" key={`${index}-${image.slice(-12)}`}>
            <div className="preview-page-number">{index + 1} / {images.length}</div>
            <img src={image} alt={`プレビュー ${index + 1}ページ`} />
          </article>
        ))}
      </div>

      <div className="preview-actions preview-actions-formats">
        <button type="button" className={intent === 'save' ? 'primary-button' : 'secondary-button'} onClick={onSave} disabled={loading || !!error || busy}>
          PDF保存
        </button>
        <button type="button" className={intent === 'text' ? 'primary-button' : 'secondary-button'} onClick={onSaveText} disabled={loading || !!error || busy}>
          テキスト保存
        </button>
        <button type="button" className={intent === 'word' ? 'primary-button' : 'secondary-button'} onClick={onSaveWord} disabled={loading || !!error || busy}>
          Word保存
        </button>
        <button type="button" className={intent === 'share' ? 'primary-button' : 'secondary-button'} onClick={onShare} disabled={loading || !!error || busy}>
          PDF共有
        </button>
      </div>
      <div className="preview-footnote">テキスト・Word保存は日本語＋英語OCRを行います。初回はOCRデータの読み込みに時間がかかる場合があります。</div>
    </div>
  )
}
