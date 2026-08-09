import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { Point } from '../types'
import { captureStillDataUrl, openRearCamera } from '../utils/cameraCapture'
import { AUTO_CAPTURE_CONFIDENCE } from '../utils/corners'
import { detectLiveDocumentCorners, frameDifference, readSmallVideoFrame } from '../utils/liveCorners'
import '../highres.css'

type Props = {
  active: boolean
  pageCount: number
  latestThumbUrl?: string | null
  mode?: 'append' | 'replace'
  onCapture: (dataUrl: string) => void
  onClose: () => void
  onOpenGallery: () => void
  onDone: () => void
  onRequestHighRes?: () => void
  onAddPhotos: (event: ChangeEvent<HTMLInputElement>) => void
}

const cornerDelta = (before: Point[], after: Point[]) =>
  before.reduce((total, point, index) => total + Math.hypot(point.x - after[index].x, point.y - after[index].y), 0) /
  before.length

export function CameraView({
  active,
  pageCount,
  latestThumbUrl,
  mode = 'append',
  onCapture,
  onClose,
  onOpenGallery,
  onDone,
  onRequestHighRes,
  onAddPhotos
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const lastCornersRef = useRef<Point[] | null>(null)
  const stableSinceRef = useRef<number | null>(null)
  const previousFrameRef = useRef<ImageData | null>(null)
  const capturingRef = useRef(false)
  const autoArmedRef = useRef(true)
  const missingSinceRef = useRef<number | null>(null)
  const lockedCornersRef = useRef<Point[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoCapture, setAutoCapture] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [corners, setCorners] = useState<Point[] | null>(null)
  const [holdMessage, setHoldMessage] = useState('')
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!active) return
    setAutoCapture(false)
    autoArmedRef.current = true
    missingSinceRef.current = null
    lockedCornersRef.current = null
    stableSinceRef.current = null
    lastCornersRef.current = null
    setHoldMessage('')
    setCorners(null)

    let cancelled = false
    const startCamera = async () => {
      try {
        setError(null)
        const { stream, track, torchSupported: hasTorch } = await openRearCamera('normal')
        if (cancelled) {
          stream.getTracks().forEach((mediaTrack) => mediaTrack.stop())
          return
        }
        streamRef.current = stream
        trackRef.current = track ?? null
        setTorchSupported(hasTorch)
        setTorchOn(false)
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (cameraError) {
        console.error(cameraError)
        setError('カメラを起動できません。ブラウザのカメラ許可を確認してください。')
      }
    }
    void startCamera()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      trackRef.current = null
    }
  }, [active])

  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight || capturingRef.current) return
    capturingRef.current = true
    try {
      const dataUrl = await captureStillDataUrl(trackRef.current, video, 'normal')
      onCapture(dataUrl)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 120)
      if (autoCapture) {
        autoArmedRef.current = false
        lockedCornersRef.current = lastCornersRef.current
        missingSinceRef.current = null
        stableSinceRef.current = null
        setHoldMessage('撮影しました\n次の書類を映してください')
      }
    } catch (captureError) {
      console.error(captureError)
    } finally {
      window.setTimeout(() => {
        capturingRef.current = false
      }, 400)
    }
  }, [autoCapture, onCapture])

  useEffect(() => {
    if (!active) return
    let stopped = false
    const tick = async () => {
      const video = videoRef.current
      if (!video || stopped) return
      const [result, frame] = await Promise.all([
        detectLiveDocumentCorners(video),
        Promise.resolve(readSmallVideoFrame(video))
      ])
      if (stopped || !frame) return
      const motion = frameDifference(previousFrameRef.current, frame)
      previousFrameRef.current = motion.frame

      if (!result?.detected) {
        setCorners(null)
        lastCornersRef.current = null
        stableSinceRef.current = null
        if (!autoCapture) return
        if (!autoArmedRef.current) {
          missingSinceRef.current ??= Date.now()
          if (Date.now() - missingSinceRef.current >= 850) {
            autoArmedRef.current = true
            lockedCornersRef.current = null
            missingSinceRef.current = null
            setHoldMessage('次の書類を枠内に合わせてください')
          }
        }
        return
      }

      setCorners(result.corners)
      const previous = lastCornersRef.current
      lastCornersRef.current = result.corners
      const confident = result.confidence >= AUTO_CAPTURE_CONFIDENCE

      if (!autoCapture) return

      if (!autoArmedRef.current) {
        const locked = lockedCornersRef.current
        const movedAway = locked ? cornerDelta(locked, result.corners) > 0.18 : false
        if (movedAway) {
          autoArmedRef.current = true
          lockedCornersRef.current = null
          missingSinceRef.current = null
          setHoldMessage('次の書類を枠内に合わせてください')
        } else {
          missingSinceRef.current = null
        }
        return
      }

      missingSinceRef.current = null
      if (!confident) {
        stableSinceRef.current = null
        setHoldMessage('四隅を確認してください')
        return
      }

      const stableCorners = previous ? cornerDelta(previous, result.corners) < 0.025 : false
      const still = motion.difference < 7
      if (stableCorners && still) {
        stableSinceRef.current ??= Date.now()
        const elapsed = Date.now() - stableSinceRef.current
        setHoldMessage(elapsed > 450 ? 'そのまま保持してください' : '書類を動かさないでください')
        if (elapsed >= 850) {
          stableSinceRef.current = null
          void capture()
        }
      } else {
        stableSinceRef.current = null
      }
    }

    const interval = window.setInterval(() => {
      void tick()
    }, 380)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [active, autoCapture, capture])

  if (!active) return null

  const toggleTorch = async () => {
    const track = trackRef.current ?? streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      const next = !torchOn
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      setTorchSupported(false)
    }
  }

  return (
    <div className="camera-view-screen" role="dialog" aria-modal="true" aria-label="撮影">
      <header className="camera-view-header">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <strong>Scanner</strong>
        <button
          type="button"
          className={`icon-chip ${torchOn ? 'active' : ''}`}
          onClick={() => void toggleTorch()}
          disabled={!torchSupported}
          aria-label="ライト"
        >
          ライト
        </button>
      </header>

      <div className="camera-view-stage">
        <video ref={videoRef} playsInline muted className="camera-video" />
        {corners && (
          <svg className="live-contour" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={corners.map((point) => `${point.x},${point.y}`).join(' ')} />
          </svg>
        )}
        {!corners && <div className="camera-guide" aria-hidden="true" />}
        {flash && <div className="shutter-flash" aria-hidden="true" />}
        {holdMessage && <p className="auto-hint">{holdMessage}</p>}
        {error && <div className="camera-error">{error}</div>}
      </div>

      <footer className="camera-view-footer">
        <div className="camera-mode-row">
          <div className="segmented">
            <button
              type="button"
              className={!autoCapture ? 'active' : ''}
              onClick={() => {
                setAutoCapture(false)
                setHoldMessage('')
              }}
            >
              手動
            </button>
            <button
              type="button"
              className={autoCapture ? 'active' : ''}
              onClick={() => {
                setAutoCapture(true)
                autoArmedRef.current = true
                lockedCornersRef.current = null
                missingSinceRef.current = null
                setHoldMessage('書類を枠内に合わせてください')
              }}
            >
              自動
            </button>
          </div>
          {mode === 'append' && onRequestHighRes && (
            <button type="button" className="chip-mini" onClick={onRequestHighRes}>
              高精細
            </button>
          )}
        </div>

        <div className="camera-shutter-row">
          <button
            type="button"
            className="thumb-stack"
            onClick={onOpenGallery}
            disabled={pageCount <= 0}
            aria-label="ページ一覧"
          >
            {latestThumbUrl ? <img src={latestThumbUrl} alt="" /> : <span className="thumb-empty" />}
            {pageCount > 0 && <span className="thumb-badge">{pageCount}</span>}
          </button>

          <button
            type="button"
            className="shutter-button large"
            onClick={() => void capture()}
            disabled={Boolean(error)}
            aria-label="撮影"
          >
            <span />
          </button>

          <label className="photo-add-btn">
            <input type="file" accept="image/*" multiple hidden onChange={onAddPhotos} />
            写真追加
          </label>
        </div>

        {mode === 'replace' ? (
          <button type="button" className="secondary-button camera-done" onClick={onClose}>
            キャンセル
          </button>
        ) : (
          pageCount > 0 && (
            <button type="button" className="primary-button camera-done" onClick={onDone}>
              撮影完了
            </button>
          )
        )}
      </footer>
    </div>
  )
}
