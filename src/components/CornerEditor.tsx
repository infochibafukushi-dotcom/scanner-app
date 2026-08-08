import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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

type PointerPosition = { x: number; y: number }
type PanState = {
  pointerId: number
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
}
type PinchState = {
  distance: number
  zoom: number
  contentX: number
  contentY: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const detectionLabel: Record<CornerDetectionMode, string> = {
  auto: '自動検出済み',
  fallback: '自動検出できず標準範囲',
  manual: '手動調整済み'
}

const pointerDistance = (a: PointerPosition, b: PointerPosition) => Math.hypot(a.x - b.x, a.y - b.y)
const pointerMidpoint = (a: PointerPosition, b: PointerPosition) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2
})

export function CornerEditor({ imageUrl, filter, corners, detectionMode, detecting, onChange, onRedetect }: CornerEditorProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pointersRef = useRef(new Map<number, PointerPosition>())
  const panRef = useRef<PanState | null>(null)
  const pinchRef = useRef<PinchState | null>(null)
  const zoomRef = useRef(1)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [ratio, setRatio] = useState(1)
  const [previewUrl, setPreviewUrl] = useState(imageUrl)
  const [filtering, setFiltering] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [panning, setPanning] = useState(false)

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
    window.addEventListener('pointercancel', onPointerUp)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [activeIndex, corners, onChange])

  const polygonPoints = useMemo(
    () => corners.map((point) => `${point.x * 100}% ${point.y * 100}%`).join(', '),
    [corners]
  )

  const setZoomLevel = (next: number, anchor?: { x: number; y: number }) => {
    const viewport = viewportRef.current
    const currentZoom = zoomRef.current
    const nextZoom = clamp(Math.round(next * 100) / 100, 1, 4)
    if (Math.abs(nextZoom - currentZoom) < 0.001) return

    if (!viewport) {
      zoomRef.current = nextZoom
      setZoom(nextZoom)
      return
    }

    const anchorX = anchor?.x ?? viewport.clientWidth / 2
    const anchorY = anchor?.y ?? viewport.clientHeight / 2
    const contentX = (viewport.scrollLeft + anchorX) / currentZoom
    const contentY = (viewport.scrollTop + anchorY) / currentZoom

    zoomRef.current = nextZoom
    setZoom(nextZoom)

    requestAnimationFrame(() => {
      const currentViewport = viewportRef.current
      if (!currentViewport) return
      currentViewport.scrollLeft = contentX * nextZoom - anchorX
      currentViewport.scrollTop = contentY * nextZoom - anchorY
    })
  }

  const beginSinglePointerPan = (pointerId: number, point: PointerPosition) => {
    const viewport = viewportRef.current
    if (!viewport) return
    panRef.current = {
      pointerId,
      startX: point.x,
      startY: point.y,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop
    }
    pinchRef.current = null
    setPanning(true)
  }

  const beginPinch = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const points = Array.from(pointersRef.current.values())
    if (points.length < 2) return
    const [a, b] = points
    const midpoint = pointerMidpoint(a, b)
    const rect = viewport.getBoundingClientRect()
    const localX = midpoint.x - rect.left
    const localY = midpoint.y - rect.top
    const currentZoom = zoomRef.current

    pinchRef.current = {
      distance: Math.max(1, pointerDistance(a, b)),
      zoom: currentZoom,
      contentX: (viewport.scrollLeft + localX) / currentZoom,
      contentY: (viewport.scrollTop + localY) / currentZoom
    }
    panRef.current = null
    setPanning(true)
  }

  const handleViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('.corner-handle')) return

    const viewport = viewportRef.current
    if (!viewport) return

    event.preventDefault()
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    try {
      viewport.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }

    if (pointersRef.current.size >= 2) beginPinch()
    else beginSinglePointerPan(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  const handleViewportPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    const viewport = viewportRef.current
    if (!viewport) return

    event.preventDefault()
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size >= 2) {
      if (!pinchRef.current) beginPinch()
      const pinch = pinchRef.current
      if (!pinch) return

      const points = Array.from(pointersRef.current.values())
      const [a, b] = points
      const distance = Math.max(1, pointerDistance(a, b))
      const midpoint = pointerMidpoint(a, b)
      const rect = viewport.getBoundingClientRect()
      const localX = midpoint.x - rect.left
      const localY = midpoint.y - rect.top
      const nextZoom = clamp(pinch.zoom * (distance / pinch.distance), 1, 4)

      zoomRef.current = nextZoom
      setZoom(nextZoom)
      requestAnimationFrame(() => {
        const currentViewport = viewportRef.current
        if (!currentViewport) return
        currentViewport.scrollLeft = pinch.contentX * nextZoom - localX
        currentViewport.scrollTop = pinch.contentY * nextZoom - localY
      })
      return
    }

    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
    viewport.scrollTop = pan.scrollTop - (event.clientY - pan.startY)
  }

  const handleViewportPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.delete(event.pointerId)

    const viewport = viewportRef.current
    if (viewport) {
      try {
        viewport.releasePointerCapture(event.pointerId)
      } catch {
        // Ignore browsers that already released the pointer.
      }
    }

    pinchRef.current = null
    const remaining = Array.from(pointersRef.current.entries())
    if (remaining.length === 1) {
      const [pointerId, point] = remaining[0]
      beginSinglePointerPan(pointerId, point)
    } else {
      panRef.current = null
      setPanning(false)
    }
  }

  return (
    <div className="editor-panel">
      <div className="editor-header editor-header-actions">
        <div>
          <div className="editor-title-line">
            <h3>四隅調整</h3>
            <span className={`detection-badge ${detectionMode}`}>{detectionLabel[detectionMode]}</span>
          </div>
          <p>1本指で画像を移動、2本指でピンチ拡大・縮小できます。青い四隅はそのままドラッグして微調整できます。</p>
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

      <div
        ref={viewportRef}
        className={`editor-viewport ${panning ? 'is-panning' : ''}`}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerEnd}
        onPointerCancel={handleViewportPointerEnd}
      >
        <div
          ref={stageRef}
          className="editor-canvas editor-stage"
          style={{ aspectRatio: `${ratio}`, width: `${zoom * 100}%` }}
        >
          <img src={previewUrl} alt="調整対象" className="editor-image" draggable={false} />
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
                event.stopPropagation()
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
