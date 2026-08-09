import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { CaptureMode, CornerDetectionResult, Point } from '../types'
import { captureStillDataUrl, openRearCamera } from '../utils/cameraCapture'
import { loadAutoCapturePreference, saveAutoCapturePreference } from '../utils/autoCaptureStorage'
import {
  BOOK_PAGE_CHANGE_DELTA,
  BOOK_PAGE_CHANGE_FRAMES,
  bookPageDifference,
  isBookPageChange,
  nextBookChangeStreak,
  shouldReArmBookPage
} from '../utils/bookPageChange'
import {
  loadBookPageOrder,
  saveBookPageOrder,
  type BookPageOrder
} from '../utils/bookPageOrderStorage'
import { loadCaptureMode, saveCaptureMode } from '../utils/captureModeStorage'
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

export type CapturePayload = {
  dataUrl: string
  liveDetection?: CornerDetectionResult | null
  captureMode: CaptureMode
}

type Props = {
  active: boolean
  pageCount: number
  latestThumbUrl?: string | null
  mode?: 'append' | 'replace'
  captureProcessing?: boolean
  onCapture: (payload: CapturePayload) => void
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
  captureProcessing = false,
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
  const lastDetectionRef = useRef<CornerDetectionResult | null>(null)
  const displayCornersRef = useRef<[Point, Point, Point, Point] | null>(null)
  const stableFramesRef = useRef(0)
  const previousFrameRef = useRef<ImageData | null>(null)
  const capturingRef = useRef(false)
  const autoArmedRef = useRef(true)
  const missingSinceRef = useRef<number | null>(null)
  const lockedCornersRef = useRef<Point[] | null>(null)
  const capturedBookFrameRef = useRef<ImageData | null>(null)
  const bookChangeFramesRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [autoCapture, setAutoCapture] = useState(() => loadAutoCapturePreference())
  const [captureMode, setCaptureMode] = useState<CaptureMode>(() => loadCaptureMode())
  const [bookPageOrder, setBookPageOrder] = useState<BookPageOrder>(() => loadBookPageOrder())
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [corners, setCorners] = useState<Point[] | null>(null)
  const [holdMessage, setHoldMessage] = useState('')
  const [flash, setFlash] = useState(false)

  const activeRef = useRef(active)
  activeRef.current = active
  const captureModeRef = useRef(captureMode)
  captureModeRef.current = captureMode

  // Keep MediaStream across gallery visits; stop only on unmount.
  useEffect(() => {
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
        stream.getVideoTracks().forEach((mediaTrack) => {
          mediaTrack.enabled = activeRef.current
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          if (activeRef.current) await videoRef.current.play()
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
  }, [])

  useEffect(() => {
    const stream = streamRef.current
    if (!stream) return
    stream.getVideoTracks().forEach((track) => {
      track.enabled = active
    })
    const video = videoRef.current
    if (!active) {
      video?.pause()
      return
    }
    if (video && video.srcObject !== stream) video.srcObject = stream
    void video?.play().catch(() => undefined)
  }, [active])

  useEffect(() => {
    if (!active) return
    // Replace (retake) starts in manual to avoid accidental auto shutter on the wrong page.
    // Append mode restores the user's remembered auto-capture preference.
    setAutoCapture(mode === 'replace' ? false : loadAutoCapturePreference())
    autoArmedRef.current = true
    missingSinceRef.current = null
    lockedCornersRef.current = null
    stableFramesRef.current = 0
    lastCornersRef.current = null
    lastDetectionRef.current = null
    displayCornersRef.current = null
    capturedBookFrameRef.current = null
    bookChangeFramesRef.current = 0
    setHoldMessage(captureModeRef.current === 'book' ? '背を中央付近に合わせてください' : '')
    setCorners(null)
  }, [active, mode])

  const capture = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight || capturingRef.current) return
    capturingRef.current = true
    try {
      const dataUrl = await captureStillDataUrl(trackRef.current, video, 'normal')
      const effectiveMode: CaptureMode = mode === 'replace' ? 'document' : captureMode
      onCapture({ dataUrl, liveDetection: lastDetectionRef.current, captureMode: effectiveMode })
      setFlash(true)
      window.setTimeout(() => setFlash(false), 100)
      if (autoCapture) {
        autoArmedRef.current = false
        lockedCornersRef.current = lastCornersRef.current
        missingSinceRef.current = null
        stableFramesRef.current = 0
        bookChangeFramesRef.current = 0
        if (captureMode === 'book' && mode !== 'replace') {
          capturedBookFrameRef.current = readSmallVideoFrame(video, 64)
          setHoldMessage('撮影しました\n次のページをめくってください')
        } else {
          capturedBookFrameRef.current = null
          setHoldMessage('撮影しました\n次の書類を映してください')
        }
      }
    } catch (captureError) {
      console.error(captureError)
    } finally {
      window.setTimeout(() => {
        capturingRef.current = false
      }, 220)
    }
  }, [autoCapture, captureMode, mode, onCapture])

  useEffect(() => {
    if (!active) return
    let stopped = false
    const tick = async () => {
      const video = videoRef.current
      if (!video || stopped) return
      const [result, frame] = await Promise.all([
        detectLiveDocumentCorners(video),
        Promise.resolve(readSmallVideoFrame(video, captureMode === 'book' ? 64 : 96))
      ])
      if (stopped || !frame) return
      const motion = frameDifference(previousFrameRef.current, frame)
      previousFrameRef.current = motion.frame

      if (!result?.detected) {
        setCorners(null)
        lastCornersRef.current = null
        lastDetectionRef.current = null
        displayCornersRef.current = null
        stableFramesRef.current = 0
        if (!autoCapture) return
        if (!autoArmedRef.current) {
          missingSinceRef.current ??= Date.now()
          // Document left the frame long enough — re-arm for the next sheet.
          // TODO: book capture mode needs content-diff based re-arm (page turns keep similar outer corners).
          if (Date.now() - missingSinceRef.current >= 850) {
            autoArmedRef.current = true
            lockedCornersRef.current = null
            missingSinceRef.current = null
            capturedBookFrameRef.current = null
            bookChangeFramesRef.current = 0
            setHoldMessage(
              captureMode === 'book' ? '背を中央付近に合わせてください' : '次の書類を枠内に合わせてください'
            )
          }
        }
        return
      }

      lastDetectionRef.current = result
      const smoothed = smoothCorners(displayCornersRef.current, result.corners)
      displayCornersRef.current = smoothed
      setCorners(smoothed)
      const previous = lastCornersRef.current
      lastCornersRef.current = result.corners
      const confident = result.confidence >= AUTO_CAPTURE_CONFIDENCE

      if (!autoCapture) return

      if (!autoArmedRef.current) {
        const locked = lockedCornersRef.current
        // Same-paper lock (document): require the sheet to leave frame or move corners a lot.
        // Book mode ALSO re-arms on content change after a page turn.
        const movedAway = locked ? cornerDelta(locked, result.corners) > 0.18 : false

        let contentTurn = false
        if (captureMode === 'book' && capturedBookFrameRef.current) {
          const pageDiff = bookPageDifference(capturedBookFrameRef.current, frame)
          const changed = isBookPageChange(pageDiff, BOOK_PAGE_CHANGE_DELTA)
          bookChangeFramesRef.current = nextBookChangeStreak(bookChangeFramesRef.current, changed)
          if (shouldReArmBookPage(bookChangeFramesRef.current, BOOK_PAGE_CHANGE_FRAMES)) {
            contentTurn = true
          }
        }

        if (movedAway || contentTurn) {
          autoArmedRef.current = true
          lockedCornersRef.current = null
          missingSinceRef.current = null
          capturedBookFrameRef.current = null
          bookChangeFramesRef.current = 0
          setHoldMessage(
            captureMode === 'book' ? 'そのまま保持してください' : '次の書類を枠内に合わせてください'
          )
        } else {
          missingSinceRef.current = null
        }
        return
      }

      missingSinceRef.current = null
      if (!confident) {
        stableFramesRef.current = 0
        setHoldMessage(captureMode === 'book' ? '背を中央付近に合わせてください' : '四隅を確認してください')
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
            : captureMode === 'book'
              ? '背を中央付近に合わせてください'
              : '書類を動かさないでください'
        )
        if (stableFramesRef.current >= AUTO_CAPTURE_STABLE_FRAMES) {
          stableFramesRef.current = 0
          void capture()
        }
      } else {
        stableFramesRef.current = 0
        setHoldMessage(
          captureMode === 'book' ? '背を中央付近に合わせてください' : '書類を動かさないでください'
        )
      }
    }

    const interval = window.setInterval(() => {
      void tick()
    }, 320)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [active, autoCapture, capture, captureMode])

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

  const selectCaptureMode = (next: CaptureMode) => {
    setCaptureMode(next)
    saveCaptureMode(next)
    capturedBookFrameRef.current = null
    bookChangeFramesRef.current = 0
    autoArmedRef.current = true
    lockedCornersRef.current = null
    setHoldMessage(next === 'book' ? '背を中央付近に合わせてください' : '')
  }

  return (
    <div
      className={`camera-view-screen ${active ? 'is-active' : 'is-idle'}`}
      role="dialog"
      aria-modal={active}
      aria-label="撮影"
      aria-hidden={!active}
      hidden={!active}
    >
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
        {captureMode === 'book' && mode !== 'replace' && (
          <div className="book-capture-guide" aria-hidden="true">
            <div className="book-guide-spine" />
            <span className="book-guide-label left">左頁</span>
            <span className="book-guide-label right">右頁</span>
          </div>
        )}
        {corners && (
          <svg className="live-contour" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <polygon points={corners.map((point) => `${point.x},${point.y}`).join(' ')} />
          </svg>
        )}
        {!corners && captureMode === 'document' && <div className="camera-guide" aria-hidden="true" />}
        {flash && <div className="shutter-flash" aria-hidden="true" />}
        {holdMessage && <p className="auto-hint">{holdMessage}</p>}
        {error && <div className="camera-error">{error}</div>}
      </div>

      <footer className="camera-view-footer">
        {mode === 'append' && (
          <div className="camera-mode-row camera-capture-type-row">
            <div className="segmented compact">
              <button
                type="button"
                className={captureMode === 'document' ? 'active' : ''}
                onClick={() => selectCaptureMode('document')}
              >
                書類
              </button>
              <button
                type="button"
                className={captureMode === 'book' ? 'active' : ''}
                onClick={() => selectCaptureMode('book')}
              >
                本
              </button>
            </div>
            {captureMode === 'book' && (
              <div className="segmented compact book-order-segment">
                <button
                  type="button"
                  className={bookPageOrder === 'ltr' ? 'active' : ''}
                  onClick={() => {
                    setBookPageOrder('ltr')
                    saveBookPageOrder('ltr')
                  }}
                  aria-label="ページ順 左から右"
                >
                  左→右
                </button>
                <button
                  type="button"
                  className={bookPageOrder === 'rtl' ? 'active' : ''}
                  onClick={() => {
                    setBookPageOrder('rtl')
                    saveBookPageOrder('rtl')
                  }}
                  aria-label="ページ順 右から左"
                >
                  右→左
                </button>
              </div>
            )}
          </div>
        )}

        <div className="camera-mode-row">
          <div className="segmented">
            <button
              type="button"
              className={!autoCapture ? 'active' : ''}
              onClick={() => {
                setAutoCapture(false)
                saveAutoCapturePreference(false)
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
                saveAutoCapturePreference(true)
                autoArmedRef.current = true
                lockedCornersRef.current = null
                missingSinceRef.current = null
                capturedBookFrameRef.current = null
                bookChangeFramesRef.current = 0
                setHoldMessage(
                  captureMode === 'book' ? '背を中央付近に合わせてください' : '書類を枠内に合わせてください'
                )
              }}
            >
              自動
            </button>
          </div>
          {mode === 'append' && captureMode === 'document' && onRequestHighRes && (
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
            disabled={pageCount <= 0 && !captureProcessing}
            aria-label="ページ一覧"
          >
            {latestThumbUrl ? <img src={latestThumbUrl} alt="" /> : <span className="thumb-empty" />}
            {(pageCount > 0 || captureProcessing) && (
              <span className={`thumb-badge ${captureProcessing ? 'processing' : ''}`}>
                {captureProcessing ? '…' : pageCount}
              </span>
            )}
          </button>

          <button
            type="button"
            className="shutter-button large"
            onClick={() => void capture()}
            disabled={Boolean(error) || captureProcessing}
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
