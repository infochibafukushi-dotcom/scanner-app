import { useEffect, useState } from 'react'
import type { ScanPage } from '../types'
import { RENDER_MAX, renderScanPage } from '../utils/image'

type CorrectedPreviewProps = {
  page: ScanPage
  compact?: boolean
}

export function CorrectedPreview({ page, compact = false }: CorrectedPreviewProps) {
  const [imageUrl, setImageUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const imageKey = `${page.id}:${page.dataUrl.length}:${page.rotation}:${page.filter}:${page.clean}:${page.bookFlatten}:${page.paperSize}:${JSON.stringify(page.corners)}`

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')

      renderScanPage(page, RENDER_MAX.preview)
        .then((canvas) => {
          if (cancelled) return
          canvas.toBlob(
            (blob) => {
              if (cancelled || !blob) return
              objectUrl = URL.createObjectURL(blob)
              setImageUrl(objectUrl)
            },
            'image/jpeg',
            0.94
          )
        })
        .catch((previewError) => {
          console.error(previewError)
          if (!cancelled) setError('プレビューを作成できませんでした。四隅を確認してください。')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // page 全体ではなく imageKey で監視し、OCR/翻訳更新での再描画を避ける
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey])

  if (compact) {
    return (
      <div className="corrected-preview compact">
        {loading && <span className="preview-status">更新中…</span>}
        {error && <div className="preview-error-inline">{error}</div>}
        {!error && imageUrl && (
          <img src={imageUrl} alt="補正後プレビュー" className="corrected-preview-image" />
        )}
      </div>
    )
  }

  return (
    <div className="card corrected-preview-card">
      <div className="section-title-row corrected-preview-title">
        <div>
          <h2>台形補正後プレビュー</h2>
          <p>四隅・回転・自動/カラー/グレーを反映した、保存時と同じ形です。</p>
        </div>
        {loading && <span>更新中…</span>}
      </div>

      {error && <div className="preview-error-inline">{error}</div>}
      {!error && imageUrl && (
        <div className="corrected-preview-image-wrap">
          <img src={imageUrl} alt="台形補正後プレビュー" className="corrected-preview-image" />
        </div>
      )}
    </div>
  )
}
