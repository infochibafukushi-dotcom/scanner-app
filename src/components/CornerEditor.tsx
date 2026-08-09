import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CornerDetectionMode, FilterMode, Point } from '../types'
import { RENDER_MAX, renderEditorImage } from '../utils/image'
import '../gesture.css'

const labels = ['左上', '右上', '右下', '左下']
const LOUPE_ZOOM = 3

type CornerEditorProps = {
  imageUrl: string
  filter: FilterMode
  corners: [Point, Point, Point, Point]
  detectionMode: CornerDetectionMode
  detecting: boolean
  clean?: boolean
  onChange: (corners: [Point, Point, Point, Point]) => void
  onRedetect: () => void
}

type Viewport = { scale: number; x: number; y: number }
type Loupe = { x: number; y: number; size: number; point: Point }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const pointerDistance = (first: PointerEvent, second: PointerEvent) =>
  Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)

const detectionLabel: Record<CornerDetectionMode, string> = {
  auto: '自動検出済み',
  fallback: '自動検出できず標準範囲',
  manual: '手動調整済み'
}

const loupeSizeForViewport = () => {
  const width = window.visualViewport?.width ?? window.innerWidth
  return width >= 900 ? 140 : width >= 700 ? 132 : 118
}

/** Place the loupe near the finger using client coordinates (viewport space). */
const placeLoupe = (
  clientX: number,
  clientY: number,
  size: number,
  preferRight: boolean,
  point: Point
): Loupe => {
  const gap = 20
  const margin = 8
  // Use visualViewport only for available size — never add offsetLeft/offsetTop to client coords.
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight

  let x = preferRight ? clientX + gap : clientX - size - gap
  if (x + size > viewportWidth - margin) x = clientX - size - gap
  if (x < margin) x = clientX + gap
  x = clamp(x, margin, viewportWidth - size - margin)

  let y = clientY - size - gap
  if (y < margin) y = clientY + gap
  y = clamp(y, margin, viewportHeight - size - margin)

  return { x, y, size, point }
}

export function CornerEditor({
  imageUrl,
  filter,
  corners,
  detectionMode,
  detecting,
  clean = false,
  onChange,
  onRedetect
}: CornerEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const pointersRef = useRef(new Map<number, PointerEvent>())
  const panRef = useRef<{ pointerId: number; clientX: number; clientY: number; view: Viewport } | null>(null)
  const pinchRef = useRef<{ distance: number; centerX: number; centerY: number; view: Viewport } | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [ratio, setRatio] = useState(1)
  const [previewUrl, setPreviewUrl] = useState(imageUrl)
  const [filtering, setFiltering] = useState(false)
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 })
  const viewportRef = useRef(viewport)
  const [loupe, setLoupe] = useState<Loupe | null>(null)

  useEffect(() => {
    viewportRef.current = viewport
  }, [viewport])

  useEffect(() => {
    const image = new Image()
    image.onload = () => setRatio(image.width / image.height || 1)
    image.src = imageUrl
    setViewport({ scale: 1, x: 0, y: 0 })
  }, [imageUrl])

  useEffect(() => {
    let cancelled = false
    setFiltering(true)
    renderEditorImage(imageUrl, filter, RENDER_MAX.editor, clean)
      .then((canvas) => {
        if (cancelled) return
        previewCanvasRef.current = canvas
        canvas.toBlob(
          (blob) => {
            if (cancelled || !blob) return
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
            const url = URL.createObjectURL(blob)
            previewUrlRef.current = url
            setPreviewUrl(url)
          },
          'image/jpeg',
          0.96
        )
      })
      .catch((error) => {
        console.error(error)
        if (!cancelled) {
          previewCanvasRef.current = null
          setPreviewUrl(imageUrl)
        }
      })
      .finally(() => {
        if (!cancelled) setFiltering(false)
      })

    return () => {
      cancelled = true
    }
  }, [imageUrl, filter, clean])

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    []
  )

  const beginPan = (pointer: PointerEvent) => {
    panRef.current = {
      pointerId: pointer.pointerId,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      view: viewportRef.current
    }
    pinchRef.current = null
  }

  const beginPinch = () => {
    const pointers = [...pointersRef.current.values()]
    if (pointers.length < 2) return
    const [first, second] = pointers
    pinchRef.current = {
      distance: pointerDistance(first, second),
      centerX: (first.clientX + second.clientX) / 2,
      centerY: (first.clientY + second.clientY) / 2,
      view: viewportRef.current
    }
    panRef.current = null
  }

  const paintLoupe = (point: Point, size: number) => {
    const canvas = loupeCanvasRef.current
    const source = previewCanvasRef.current
    if (!canvas || !source) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pixelSize = Math.round(size * dpr)
    if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
      canvas.width = pixelSize
      canvas.height = pixelSize
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    try {
      ctx.imageSmoothingQuality = 'high'
    } catch {
      // ignore
    }

    const container = containerRef.current
    const rect = container?.getBoundingClientRect()
    const view = viewportRef.current
    const displayWidth = Math.max(1, (rect?.width ?? source.width) * view.scale)
    const srcCrop = Math.max(12, (size / LOUPE_ZOOM) * (source.width / displayWidth))
    const cx = point.x * source.width
    const cy = point.y * source.height

    ctx.clearRect(0, 0, pixelSize, pixelSize)
    ctx.fillStyle = '#020617'
    ctx.fillRect(0, 0, pixelSize, pixelSize)
    ctx.drawImage(
      source,
      cx - srcCrop / 2,
      cy - srcCrop / 2,
      srcCrop,
      srcCrop,
      0,
      0,
      pixelSize,
      pixelSize
    )
  }

  useEffect(() => {
    if (!loupe) return
    paintLoupe(loupe.point, loupe.size)
  }, [loupe])

  const updateLoupe = (clientX: number, clientY: number, point: Point, cornerIndex: number) => {
    const size = loupeSizeForViewport()
    const preferRight = cornerIndex === 0 || cornerIndex === 3
    setLoupe(placeLoupe(clientX, clientY, size, preferRight, point))
  }

  const updateCorner = (index: number, clientX: number, clientY: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const view = viewportRef.current
    const point = {
      x: clamp((clientX - rect.left - view.x) / (rect.width * view.scale), 0, 1),
      y: clamp((clientY - rect.top - view.y) / (rect.height * view.scale), 0, 1)
    }
    const next = [...corners] as [Point, Point, Point, Point]
    next[index] = point
    onChange(next)
    updateLoupe(clientX, clientY, point, index)
  }

  const onViewportPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activeIndex !== null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, event.nativeEvent)
    if (pointersRef.current.size === 1) beginPan(event.nativeEvent)
    else if (pointersRef.current.size === 2) beginPinch()
  }

  const onViewportPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activeIndex !== null) return
    pointersRef.current.set(event.pointerId, event.nativeEvent)
    const pinch = pinchRef.current
    if (pinch && pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()]
      const scale = clamp(
        pinch.view.scale * (pointerDistance(first, second) / Math.max(1, pinch.distance)),
        1,
        4
      )
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const centerX = (first.clientX + second.clientX) / 2 - rect.left
      const centerY = (first.clientY + second.clientY) / 2 - rect.top
      setViewport({
        scale,
        x: centerX - (pinch.centerX - rect.left - pinch.view.x) * (scale / pinch.view.scale),
        y: centerY - (pinch.centerY - rect.top - pinch.view.y) * (scale / pinch.view.scale)
      })
      return
    }
    const pan = panRef.current
    if (pan?.pointerId === event.pointerId) {
      setViewport({
        ...pan.view,
        x: pan.view.x + event.clientX - pan.clientX,
        y: pan.view.y + event.clientY - pan.clientY
      })
    }
  }

  const onViewportPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size >= 2) beginPinch()
    else if (pointersRef.current.size === 1) beginPan([...pointersRef.current.values()][0])
    else {
      panRef.current = null
      pinchRef.current = null
    }
  }

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
          <p>1本指で移動、2本指で拡大。角ドラッグ中は指の近くに拡大ルーペを表示します。</p>
        </div>
        <button type="button" className="chip" onClick={onRedetect} disabled={detecting}>
          {detecting ? '再検出中…' : '四隅を再検出'}
        </button>
      </div>

      <div
        ref={containerRef}
        className="editor-canvas editor-gesture-viewport"
        style={{ aspectRatio: `${ratio}` }}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
      >
        <div
          className="editor-viewport-content"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
        >
          <img src={previewUrl} alt="調整対象" className="editor-image" draggable={false} />
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
                event.currentTarget.setPointerCapture(event.pointerId)
                setActiveIndex(index)
                updateCorner(index, event.clientX, event.clientY)
              }}
              onPointerMove={(event) => {
                if (activeIndex === index) updateCorner(index, event.clientX, event.clientY)
              }}
              onPointerUp={() => {
                if (activeIndex === index) {
                  setActiveIndex(null)
                  setLoupe(null)
                }
              }}
              onPointerCancel={() => {
                setActiveIndex(null)
                setLoupe(null)
              }}
              aria-label={labels[index]}
              title={labels[index]}
            >
              <span />
            </button>
          ))}
        </div>
        {filtering && <div className="editor-processing">画像モード反映中…</div>}
      </div>

      {loupe &&
        createPortal(
          <div
            className="corner-loupe"
            style={{ left: loupe.x, top: loupe.y, width: loupe.size, height: loupe.size }}
            aria-hidden="true"
          >
            <canvas ref={loupeCanvasRef} className="corner-loupe-canvas" />
            <span className="corner-loupe-crosshair" />
          </div>,
          document.body
        )}
    </div>
  )
}
