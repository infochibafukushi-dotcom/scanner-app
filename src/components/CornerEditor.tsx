import { useEffect, useMemo, useRef, useState } from 'react'
import type { CornerDetectionMode, FilterMode, Point } from '../types'
import { renderEditorImage } from '../utils/image'

const labels = ['左上', '右上', '右下', '左下']

type CornerEditorProps = {
  imageUrl: string
  filter: FilterMode
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

export function CornerEditor({ imageUrl, filter, corners, detectionMode, detecting, onChange, onRedetect }: CornerEditorProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [ratio, setRatio] = useState(1)
  const [previewUrl, setPreviewUrl] = useState(imageUrl)
  const [filtering, setFiltering] = useState(false)
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const image = new Image()
    image.onload = () => setRatio(image.width / image.height || 1)
    image.src = imageUrl
  }, [imageUrl])

  useEffect(() => {
    let cancelled = false

    if (filter === 'color') {
      setPreviewUrl(imageUrl)
      setFiltering(false)
      return () => { cancelled = true }
    }

    setFiltering(true)
    renderEditorImage(imageUrl, filter)
      .then((canvas) => {
        if (!cancelled) setPreviewUrl(canvas.toDataURL('image/jpeg', 0.9))
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) setPreviewUrl(imageUrl)
      })
      .finally(() => {
        if (!cancelled) setFiltering(false)
      })

    return () => {
      cancelled = true
    }
  }, [imageUrl, filter])

  useEffect(() => {
    if (activeIndex === null) return

    const onPointerMove = (event: PointerEvent) => {
      const stage = stageRef.current
      if (!stage) return

      const rect = stage.getBoundingClientRect()
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

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || zoom === 1) return
    const maxLeft = viewport.scrollWidth - viewport.clientWidth
    const maxTop = viewport.scrollHeight - viewport.clientHeight
    viewport.scrollTo({ left: maxLeft / 2, top: maxTop / 2 })
  }, [zoom])

  const polygonPoints = useMemo(
    () => corners.map((point) => `${point.x * 100}% ${point.y * 100}%`).join(', '),
    [corners]
  )

  const setZoomLevel = (next: number) => setZoom(clamp(Math.round(next * 10) / 10, 1, 4))

  return (
    <div className="editor-panel">
      <div className="editor-header editor-header-actions">
        <div>
          <div className="editor-title-line">
            <h3>四隅調整</h3>
            <span className={`detection-badge ${detectionMode}`}>{detectionLabel[detectionMode]}</span>
          </div>
          <p>選択中の画像モードを反映します。拡大して紙端と青い四隅が合っているか確認できます。</p>
        </div>
        <button type="button" className="chip" onClick={onRedetect} disabled={detecting}>
          {detecting ? '再検出中…' : '四隅を再検出'}
        </button>
      </div>

      <div className="editor-zoom-controls" aria-label="四隅調整のズーム">
        <button type="button" className="chip zoom-button" onClick={() => setZoomLevel(zoom - 0.5)} disabled={zoom <= 1}>−</button>
        <input
          type="range"
          min="1"
          max="4"
          step="0.1"
          value={zoom}
          onChange={(event) => setZoomLevel(Number(event.target.value))}
          aria-label="拡大率"
        />
        <button type="button" className="chip zoom-button" onClick={() => setZoomLevel(zoom + 0.5)} disabled={zoom >= 4}>＋</button>
        <button type="button" className="chip" onClick={() => setZoomLevel(1)} disabled={zoom === 1}>等倍</button>
        <span>{Math.round(zoom * 100)}%</span>
      </div>

      <div ref={viewportRef} className="editor-viewport">
        <div
          ref={stageRef}
          className="editor-canvas editor-stage"
          style={{ aspectRatio: `${ratio}`, width: `${zoom * 100}%` }}
        >
          <img src={previewUrl} alt="調整対象" className="editor-image" />
          {filtering && <div className="editor-processing">画像モード反映中…</div>}
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
    </div>
  )
}
