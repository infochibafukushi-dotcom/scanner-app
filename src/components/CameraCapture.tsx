import { useEffect, useRef, useState } from 'react'

type CameraCaptureProps = {
  open: boolean
  onClose: () => void
  onCapture: (dataUrl: string) => void
}

export function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capturedCount, setCapturedCount] = useState(0)

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

  if (!open) return null

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    onCapture(canvas.toDataURL('image/jpeg', 0.94))
    setCapturedCount((count) => count + 1)
  }

  return (
    <div className="camera-modal" role="dialog" aria-modal="true" aria-label="連続撮影">
      <div className="camera-toolbar">
        <div>
          <strong>連続撮影</strong>
          <span>{capturedCount}枚撮影</span>
        </div>
        <button type="button" className="camera-close" onClick={onClose}>完了</button>
      </div>

      <div className="camera-view">
        <video ref={videoRef} playsInline muted className="camera-video" />
        <div className="camera-guide" aria-hidden="true" />
        {error && <div className="camera-error">{error}</div>}
      </div>

      <div className="camera-footer">
        <button type="button" className="shutter-button" onClick={capture} disabled={Boolean(error)} aria-label="撮影">
          <span />
        </button>
        <p>撮影後もカメラは開いたままです。続けて何枚でも撮影できます。</p>
      </div>
    </div>
  )
}
