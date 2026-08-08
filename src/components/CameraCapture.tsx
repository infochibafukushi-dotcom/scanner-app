import { useCallback, useEffect, useRef, useState } from 'react'
import type { Point } from '../types'
import { detectLiveDocumentCorners, frameDifference, readSmallVideoFrame } from '../utils/liveCorners'
import '../highres.css'

type CameraCaptureProps = {
  open: boolean
  onClose: () => void
  onCapture: (dataUrl: string) => void
  onRequestHighRes?: () => void
}

const cornerDelta = (before: Point[], after: Point[]) =>
  before.reduce((total, point, index) => total + Math.hypot(point.x - after[index].x, point.y - after[index].y), 0) / before.length

export function CameraCapture({ open, onClose, onCapture, onRequestHighRes }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastCornersRef = useRef<Point[] | null>(null)
  const stableSinceRef = useRef<number | null>(null)
  const previousFrameRef = useRef<ImageData | null>(null)
  const capturingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [capturedCount, setCapturedCount] = useState(0)
  const [autoCapture, setAutoCapture] = useState(true)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [corners, setCorners] = useState<Point[] | null>(null)
  const [holdMessage, setHoldMessage] = useState('')
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!open) return

    let cancelled = false

    const startCamera = async () => {
      try {
        setError(null)
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        })

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean }
        setTorchSupported(Boolean(capabilities?.torch))
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
    }
  }, [open])

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight || capturingRef.current) return
    capturingRef.current = true
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      onCapture(canvas.toDataURL('image/jpeg', 0.94))
      setCapturedCount((count) => count + 1)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 120)
    }
    window.setTimeout(() => { capturingRef.current = false }, 350)
  }, [onCapture])

  useEffect(() => {
    if (!open || !autoCapture) return
    let stopped = false
    const tick = async () => {
      const video = videoRef.current
      if (!video || stopped) return
      const [result, frame] = await Promise.all([
        detectLiveDocumentCorners(video),
        Promise.resolve(readSmallVideoFrame(video))
      ])
      if (stopped || !result || !frame) return
      const motion = frameDifference(previousFrameRef.current, frame)
      previousFrameRef.current = motion.frame
      const stableCorners = result.detected && lastCornersRef.current && cornerDelta(lastCornersRef.current, result.corners) < 0.025
      const still = motion.difference < 7
      setCorners(result.detected ? result.corners : null)
      if (result.detected && stableCorners && still) {
        stableSinceRef.current ??= Date.now()
        const elapsed = Date.now() - stableSinceRef.current
        setHoldMessage(elapsed > 450 ? 'そのまま保持してください' : '書類を動かさないでください')
        if (elapsed >= 850) {
          stableSinceRef.current = null
          capture()
        }
      } else {
        stableSinceRef.current = null
        setHoldMessage('')
      }
      lastCornersRef.current = result.detected ? result.corners : null
    }
    const interval = window.setInterval(() => { void tick() }, 380)
    return () => { stopped = true; window.clearInterval(interval) }
  }, [autoCapture, capture, open])

  if (!open) return null

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
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
    <div className="camera-modal scanner-camera" role="dialog" aria-modal="true" aria-label="連続撮影">
      <header className="camera-toolbar">
        <button type="button" className="camera-icon-button" onClick={onClose} aria-label="閉じる">×</button>
        <strong>Scanner</strong>
        <div className="camera-top-actions">
          {torchSupported && <button type="button" className={torchOn ? 'active' : ''} onClick={() => void toggleTorch()}>ライト</button>}
          <button type="button" className={autoCapture ? 'active' : ''} onClick={() => setAutoCapture((value) => !value)}>{autoCapture ? '自動' : '手動'}</button>
        </div>
      </header>
      <div className="camera-view scanner-view">
        <video ref={videoRef} playsInline muted className="camera-video" />
        {corners && <svg className="live-contour" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><polygon points={corners.map((point) => `${point.x},${point.y}`).join(' ')} /></svg>}
        {!corners && <div className="camera-guide" aria-hidden="true" />}
        {flash && <div className="shutter-flash" aria-hidden="true" />}
        {holdMessage && <p className="auto-hint">{holdMessage}</p>}
        {error && <div className="camera-error">{error}</div>}
      </div>
      <footer className="camera-footer scanner-footer">
        <div className="mode-chips">
          <button type="button" className="active">通常</button>
          <button type="button" onClick={onRequestHighRes} disabled={!onRequestHighRes}>高精細</button>
        </div>
        <button type="button" className="shutter-button" onClick={capture} disabled={Boolean(error)} aria-label="撮影">
          <span />
        </button>
        <p>{capturedCount ? `${capturedCount}枚撮影済み` : autoCapture ? '書類を枠内に置くと自動で撮影します' : 'シャッターを押して撮影してください'}</p>
      </footer>
    </div>
  )
}
