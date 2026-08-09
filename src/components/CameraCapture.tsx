import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point } from '../types'
import { captureStillDataUrl, openRearCamera } from '../utils/cameraCapture'
import {
  AUTO_CAPTURE_CONFIDENCE,
  AUTO_CAPTURE_STABLE_DELTA,
  AUTO_CAPTURE_STABLE_FRAMES
} from '../utils/corners'
import {
  detectLiveDocumentCorners,
  frameDifference,
  readSmallVideoFrame,
  smoothCorners
} from '../utils/liveCorners'
import '../highres.css'

type CameraCaptureProps = {
  open: boolean
  onClose: () => void
  onCapture: (dataUrl: string) => void
  onRequestHighRes?: () => void
  pageCount?: number
  mode?: 'append' | 'replace'
}

const cornerDelta = (before: Point[], after: Point[]) =>
  before.reduce((total, point, index) => total + Math.hypot(point.x - after[index].x, point.y - after[index].y), 0) /
  before.length

export function CameraCapture({
  open,
  onClose,
  onCapture,
  onRequestHighRes,
  pageCount = 0,
  mode = 'append'
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const lastCornersRef = useRef<Point[] | null>(null)
  const displayCornersRef = useRef<[Point, Point, Point, Point] | null>(null)
  const stableFramesRef = useRef(0)
  const previousFrameRef = useRef<ImageData | null>(null)
  const capturingRef = useRef(false)
  const autoArmedRef = useRef(true)
  const missingSinceRef = useRef<number | null>(null)
  const lockedCornersRef = useRef<Point[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sessionCount, setSessionCount] = useState(0)
  const [autoCapture, setAutoCapture] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [corners, setCorners] = useState<Point[] | null>(null)
  const [holdMessage, setHoldMessage] = useState('')
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!open) return
    setAutoCapture(false)
    setSessionCount(0)
    autoArmedRef.current = true
    missingSinceRef.current = null
    lockedCornersRef.current = null
    stableFramesRef.current = 0
    lastCornersRef.current = null
    displayCornersRef.current = null
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
  }, [open])

  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight || capturingRef.current) return
    capturingRef.current = true
    try {
      const dataUrl = await captureStillDataUrl(trackRef.current, video, 'normal')
      onCapture(dataUrl)
      setSessionCount((count) => count + 1)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 120)
      if (autoCapture) {
        autoArmedRef.current = false
        lockedCornersRef.current = lastCornersRef.current
        missingSinceRef.current = null
        stableFramesRef.current = 0
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
    if (!open) return
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
        displayCornersRef.current = null
        stableFramesRef.current = 0
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

      const smoothed = smoothCorners(displayCornersRef.current, result.corners)
      displayCornersRef.current = smoothed
      setCorners(smoothed)
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
        stableFramesRef.current = 0
        setHoldMessage('四隅を確認してください')
        return
      }

      const stableCorners = previous
        ? cornerDelta(previous, result.corners) < AUTO_CAPTURE_STABLE_DELTA
        : false
      const still = motion.difference < 6.5
      if (stableCorners && still) {
        stableFramesRef.current += 1
        setHoldMessage(
          stableFramesRef.current >= Math.max(2, AUTO_CAPTURE_STABLE_FRAMES - 1)
            ? 'そのまま保持してください'
            : '書類を動かさないでください'
        )
        if (stableFramesRef.current >= AUTO_CAPTURE_STABLE_FRAMES) {
          stableFramesRef.current = 0
          void capture()
        }
      } else {
        stableFramesRef.current = 0
        setHoldMessage('書類を動かさないでください')
      }
    }

    const interval = window.setInterval(() => {
      void tick()
    }, 320)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [autoCapture, capture, open])

  if (!open) return null

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
    <div className="camera-modal scanner-camera" role="dialog" aria-modal="true" aria-label="撮影">
      <header className="camera-toolbar">
        <button type="button" className="camera-icon-button" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <strong>Scanner</strong>
        <div className="camera-top-actions">
          {torchSupported && (
            <button type="button" className={torchOn ? 'active' : ''} onClick={() => void toggleTorch()}>
              ライト
            </button>
          )}
        </div>
      </header>

      <div className="camera-view scanner-view">
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

      <footer className="camera-footer scanner-footer capture-footer">
        <div className="mode-chips capture-mode-chips">
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

        <button
          type="button"
          className="shutter-button"
          onClick={() => void capture()}
          disabled={Boolean(error)}
          aria-label="撮影"
        >
          <span />
        </button>

        <p className="capture-count">
          {mode === 'replace'
            ? '撮り直し：1枚撮影してください'
            : sessionCount > 0
              ? `撮影：${sessionCount}ページ`
              : autoCapture
                ? '自動：安定したら1枚撮影します'
                : 'シャッターで撮影'}
        </p>

        <div className="capture-footer-actions">
          <button type="button" className="highres-link" onClick={onRequestHighRes} disabled={!onRequestHighRes || mode === 'replace'}>
            高精細スキャン
          </button>
          <button type="button" className="done-capture-button" onClick={onClose}>
            {mode === 'replace' ? 'キャンセル' : '撮影完了'}
          </button>
        </div>
        {mode === 'append' && <p className="capture-total-hint">文書全体：{pageCount}ページ</p>}
      </footer>
    </div>
  )
}
