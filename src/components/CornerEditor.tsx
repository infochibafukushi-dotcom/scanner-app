import { useEffect, useMemo, useRef, useState } from 'react'
import type { Point } from '../types'

const labels = ['左上', '右上', '右下', '左下']

type CornerEditorProps = {
  imageUrl: string
  corners: [Point, Point, Point, Point]
  onChange: (corners: [Point, Point, Point, Point]) => void
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function CornerEditor({ imageUrl, corners, onChange }: CornerEditorProps) {
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
      <div className="editor-header">
        <div>
          <h3>四隅調整</h3>
          <p>青いハンドルをドラッグして、取り込み範囲を調整します。</p>
        </div>
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
