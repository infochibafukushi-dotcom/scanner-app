import { useEffect, useMemo, useRef, useState } from 'react'
import type { CornerDetectionMode, Point } from '../types'

const labels = ['左上', '右上', '右下', '左下']

type CornerEditorProps = {
  imageUrl: string
  corners: [Point, Point, Point, Point]
  detectionMode: CornerDetectionMode
  detecting: boolean
  onChange: (corners: [Point, Point, Point, Point]) => void
  onRedetect: () => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const detectionLabel: Record<CornerDetectionMode, string> = {
  auto: '自動検出済み',
  fallback: '自動検出できず標準範囲',
  manual: '手動調整済み'
}

export function CornerEditor({ imageUrl, corners, detectionMode, detecting, onChange, onRedetect }: CornerEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [ratio, setRatio] = useState(1)

  useEffect(() => {
    const image = new Image()
    image.onload = () => setRatio(image.width / image.height || 1)
    image.src = imageUrl
  }, [imageUrl])

  useEffect(() => {
    if (activeIndex === null) return

    const onPointerMove = (event: PointerEvent) => {
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1)
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1)
      const next = [...corners] as [Point, Point, Point, Point]
      next[activeIndex] = { x, y }
      onChange(next)
    }

    const onPointerUp = () => setActiveIndex(null)

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [activeIndex, corners, onChange])

  const polygonPoints = useMemo(
    () => corners.map((point) => `${point.x * 100}% ${point.y * 100}%`).join(', '),
    [corners]
  )

  return (
    <div className="editor-panel">
      <div className="editor-header editor-header-actions">
        <div>
          <div className="editor-title-line">
            <h3>四隅調整</h3>
            <span className={`detection-badge ${detectionMode}`}>{detectionLabel[detectionMode]}</span>
          </div>
          <p>撮影時に四隅を自動判定します。ずれた場合だけ青いハンドルで微調整してください。</p>
        </div>
        <button type="button" className="chip" onClick={onRedetect} disabled={detecting}>
          {detecting ? '再検出中…' : '四隅を再検出'}
        </button>
      </div>

      <div ref={containerRef} className="editor-canvas" style={{ aspectRatio: `${ratio}` }}>
        <img src={imageUrl} alt="調整対象" className="editor-image" />
        <div className="editor-overlay" style={{ clipPath: `polygon(${polygonPoints})` }} />
        <svg className="editor-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            points={corners.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')}
            fill="rgba(14,165,233,0.15)"
            stroke="#0ea5e9"
            strokeWidth="1"
          />
        </svg>
        {corners.map((point, index) => (
          <button
            key={labels[index]}
            type="button"
            className="corner-handle"
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            onPointerDown={(event) => {
              event.preventDefault()
              setActiveIndex(index)
            }}
            aria-label={labels[index]}
            title={labels[index]}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  )
}
