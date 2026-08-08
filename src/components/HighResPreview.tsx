import { useRef, useState } from 'react'
import { HIGH_RES_LABELS, HIGH_RES_TILE_ORDER, type HighResTileId } from '../types'
import '../gesture.css'
import '../highres.css'

type HighResPreviewProps = {
  dataUrl: string
  warnings?: string[]
  qualityFailed?: boolean
  failedTiles?: HighResTileId[]
  onAccept: () => void
  onPartialRetake: (tiles: HighResTileId[]) => void
  onFullRetake: () => void
  onClose: () => void
}

type Point = { x: number; y: number }

export function HighResPreview({
  dataUrl,
  warnings = [],
  qualityFailed = false,
  failedTiles = [],
  onAccept,
  onPartialRetake,
  onFullRetake,
  onClose
}: HighResPreviewProps) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [selectingTiles, setSelectingTiles] = useState(false)
  const [selectedTiles, setSelectedTiles] = useState<HighResTileId[]>(failedTiles)
  const gestureRef = useRef<{ origin: Point; offset: Point; distance?: number; scale?: number } | null>(null)

  const touchDistance = (first: Point, second: Point) => Math.hypot(first.x - second.x, first.y - second.y)

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2) {
      const first = event.touches.item(0)
      const second = event.touches.item(1)
      if (!first || !second) return
      gestureRef.current = { origin: { x: 0, y: 0 }, offset, distance: touchDistance({ x: first.clientX, y: first.clientY }, { x: second.clientX, y: second.clientY }), scale }
    } else if (event.touches.length === 1) {
      gestureRef.current = { origin: { x: event.touches[0].clientX, y: event.touches[0].clientY }, offset }
    }
  }

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture) return
    if (event.touches.length === 2 && gesture.distance && gesture.scale) {
      event.preventDefault()
      const first = event.touches.item(0)
      const second = event.touches.item(1)
      if (!first || !second) return
      setScale(Math.min(4, Math.max(1, gesture.scale * (touchDistance({ x: first.clientX, y: first.clientY }, { x: second.clientX, y: second.clientY }) / gesture.distance))))
    } else if (event.touches.length === 1) {
      event.preventDefault()
      setOffset({ x: gesture.offset.x + event.touches[0].clientX - gesture.origin.x, y: gesture.offset.y + event.touches[0].clientY - gesture.origin.y })
    }
  }

  const toggleTile = (tile: HighResTileId) => {
    setSelectedTiles((current) => current.includes(tile) ? current.filter((value) => value !== tile) : [...current, tile])
  }

  return (
    <div className="highres-modal highres-preview" role="dialog" aria-modal="true" aria-label="高精細合成結果">
      <header className="highres-header">
        <button type="button" className="camera-icon-button" onClick={onClose} aria-label="閉じる">×</button>
        <strong>高精細合成結果</strong>
        <span />
      </header>
      <div className="gesture-stage" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={() => { gestureRef.current = null }}>
        <img src={dataUrl} alt="高精細合成結果" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
      </div>
      <section className="highres-preview-controls">
        {qualityFailed && <p className="quality-warning-text">高精細合成の品質が低いため、自動確定しませんでした</p>}
        {warnings.map((warning) => <p key={warning} className="preview-warning">{warning}</p>)}
        {selectingTiles && (
          <div className="retake-picker">
            <p>撮り直す箇所を選択してください</p>
            <div>
              {HIGH_RES_TILE_ORDER.map((tile) => <button type="button" key={tile} className={selectedTiles.includes(tile) ? 'active' : ''} onClick={() => toggleTile(tile)}>{HIGH_RES_LABELS[tile]}</button>)}
            </div>
            <button type="button" className="primary-action" onClick={() => selectedTiles.length && onPartialRetake(selectedTiles)} disabled={!selectedTiles.length}>選択した部分を撮り直す</button>
          </div>
        )}
        <div className="highres-actions">
          <button type="button" className="primary-action" onClick={onAccept}>採用</button>
          <button type="button" onClick={() => setSelectingTiles((value) => !value)}>部分撮り直し</button>
          <button type="button" onClick={onFullRetake}>全部撮り直し</button>
        </div>
      </section>
    </div>
  )
}
