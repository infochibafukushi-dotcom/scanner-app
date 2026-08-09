import { useCallback, useEffect, useRef, useState } from 'react'
import { HIGH_RES_LABELS, HIGH_RES_TILE_ORDER, type HighResCaptureStep, type HighResTileId } from '../types'
import { captureStillDataUrl, openRearCamera } from '../utils/cameraCapture'
import { isBlurry } from '../utils/highResQuality'
import { preloadOpenCv } from '../utils/opencvLoader'
import '../highres.css'

type HighResShots = { base: string; tiles: Record<HighResTileId, string> }

type HighResCaptureProps = {
  open: boolean
  onClose: () => void
  onShotsReady: (shots: HighResShots) => void
  initialShots?: HighResShots
  startStep?: HighResCaptureStep
}

const steps: HighResCaptureStep[] = ['base', ...HIGH_RES_TILE_ORDER]

const instruction: Record<HighResCaptureStep, string> = {
  base: 'ページ全体を写し、四隅を画面内に収めてください',
  tl: '左上を大きく写し、隣接領域を少し含めてください',
  tr: '右上を大きく写し、隣接領域を少し含めてください',
  br: '右下を大きく写し、隣接領域を少し含めてください',
  bl: '左下を大きく写し、隣接領域を少し含めてください'
}

const stepIndex = (step: HighResCaptureStep) => steps.indexOf(step)

export function HighResCapture({
  open,
  onClose,
  onShotsReady,
  initialShots,
  startStep = 'base'
}: HighResCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [currentStep, setCurrentStep] = useState<HighResCaptureStep>('base')
  const [base, setBase] = useState<string | null>(null)
  const [tiles, setTiles] = useState<Partial<Record<HighResTileId, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [qualityMessage, setQualityMessage] = useState<string | null>(null)
  const [engineStatus, setEngineStatus] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    if (!open) return
    setCurrentStep(startStep)
    setBase(initialShots?.base ?? null)
    setTiles(initialShots?.tiles ?? {})
    setError(null)
    setQualityMessage(null)
    setEngineStatus('高精度エンジンを準備中…')
    let disposed = false
    void preloadOpenCv()
      .then(() => {
        if (!disposed) setEngineStatus(null)
      })
      .catch(() => {
        if (!disposed) setEngineStatus('高精度エンジンを準備できませんでした。撮影は続けられます。')
      })
    return () => {
      disposed = true
    }
  }, [open, initialShots, startStep])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const start = async () => {
      try {
        const { stream, track } = await openRearCamera('highres')
        if (cancelled) {
          stream.getTracks().forEach((mediaTrack) => mediaTrack.stop())
          return
        }
        streamRef.current = stream
        trackRef.current = track ?? null
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch {
        setError('カメラを起動できません。ブラウザのカメラ許可を確認してください。')
      }
    }
    void start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      trackRef.current = null
    }
  }, [open])

  const retake = useCallback((step: HighResCaptureStep) => {
    setCurrentStep(step)
    setQualityMessage(null)
    if (step === 'base') {
      setBase(null)
      setTiles({})
    } else {
      setTiles((current) => {
        const next = { ...current }
        delete next[step]
        return next
      })
    }
  }, [])

  const takePhoto = async () => {
    const video = videoRef.current
    if (!video?.videoWidth || checking) return
    setChecking(true)
    setQualityMessage(null)
    try {
      const dataUrl = await captureStillDataUrl(trackRef.current, video, 'highres')
      if ((await isBlurry(dataUrl)).blurry) {
        setQualityMessage('画像がぶれています。撮り直してください。')
        return
      }
      if (currentStep === 'base') {
        setBase(dataUrl)
        setCurrentStep('tl')
        return
      }
      const nextTiles = { ...tiles, [currentStep]: dataUrl }
      setTiles(nextTiles)
      const nextStep = steps.slice(stepIndex(currentStep) + 1).find((step) => step !== 'base' && !nextTiles[step])
      if (nextStep) setCurrentStep(nextStep)
      else if (base && nextTiles.tl && nextTiles.tr && nextTiles.br && nextTiles.bl) {
        onShotsReady({ base, tiles: nextTiles as Record<HighResTileId, string> })
      }
    } catch (captureError) {
      console.error(captureError)
      setQualityMessage('撮影に失敗しました。もう一度お試しください。')
    } finally {
      setChecking(false)
    }
  }

  if (!open) return null

  return (
    <div className="highres-modal" role="dialog" aria-modal="true" aria-label="高精細スキャン">
      <header className="highres-header">
        <button type="button" className="camera-icon-button" onClick={onClose} aria-label="キャンセル">
          ×
        </button>
        <strong>高精細スキャン</strong>
        <span>
          {stepIndex(currentStep) + 1}/5
        </span>
      </header>
      <div className="highres-progress" aria-label="撮影の進行状況">
        {steps.map((step) => {
          const image = step === 'base' ? base : tiles[step]
          return (
            <button
              key={step}
              type="button"
              className={`highres-progress-item ${currentStep === step ? 'active' : ''}`}
              onClick={() => image && retake(step)}
              disabled={!image}
            >
              <span>{image ? <img src={image} alt={`${HIGH_RES_LABELS[step]}の撮影済みサムネイル`} /> : '○'}</span>
              <small>
                {HIGH_RES_LABELS[step]}
                {image ? '・撮り直す' : ''}
              </small>
            </button>
          )
        })}
      </div>
      <main className="highres-view">
        <video ref={videoRef} className="highres-video" playsInline muted />
        <div className={`quadrant-guide guide-${currentStep}`} aria-hidden="true">
          <span />
        </div>
        <div className="highres-guide-copy">
          <strong>{HIGH_RES_LABELS[currentStep]}</strong>
          <span>{instruction[currentStep]}</span>
          {currentStep !== 'base' && <small>前の写真と30〜40%重なるようにしてください</small>}
        </div>
        {error && <p className="camera-error">{error}</p>}
      </main>
      <footer className="highres-footer">
        {engineStatus && <p className="engine-status">{engineStatus}</p>}
        {qualityMessage && (
          <div className="quality-warning">
            <span>{qualityMessage}</span>
            <button type="button" onClick={() => void takePhoto()}>
              撮り直す
            </button>
          </div>
        )}
        <button
          type="button"
          className="shutter-button"
          onClick={() => void takePhoto()}
          disabled={Boolean(error) || checking}
          aria-label={`${HIGH_RES_LABELS[currentStep]}を撮影`}
        >
          <span />
        </button>
      </footer>
    </div>
  )
}
