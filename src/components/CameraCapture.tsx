import { useEffect, useRef, useState } from 'react'

type CameraCaptureProps = {
  open: boolean
  onClose: () => void
  onCapture: (dataUrl: string) => void
}

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean }
type TorchConstraintSet = MediaTrackConstraintSet & { torch?: boolean }

export function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const videoTrackRef = useRef<MediaStreamTrack | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capturedCount, setCapturedCount] = useState(0)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchBusy, setTorchBusy] = useState(false)

  useEffect(() => {
    if (!open) return

    let cancelled = false

    const startCamera = async () => {
      try {
        setError(null)
        setTorchSupported(false)
        setTorchOn(false)
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
        const track = stream.getVideoTracks()[0] ?? null
        videoTrackRef.current = track

        if (track?.getCapabilities) {
          const capabilities = track.getCapabilities() as TorchCapabilities
          setTorchSupported(Boolean(capabilities.torch))
        }

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
      const track = videoTrackRef.current
      if (track && torchOn) {
        void track.applyConstraints({ advanced: [{ torch: false } as TorchConstraintSet] }).catch(() => undefined)
      }
      streamRef.current?.getTracks().forEach((mediaTrack) => mediaTrack.stop())
      streamRef.current = null
      videoTrackRef.current = null
      setTorchOn(false)
      setTorchSupported(false)
    }
  }, [open])

  if (!open) return null

  const toggleTorch = async () => {
    const track = videoTrackRef.current
    if (!track || !torchSupported || torchBusy) return

    const next = !torchOn
    setTorchBusy(true)
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraintSet] })
      setTorchOn(next)
    } catch (torchError) {
      console.error(torchError)
      setTorchSupported(false)
      setTorchOn(false)
      window.alert('この端末・ブラウザでは撮影ライトを制御できません。')
    } finally {
      setTorchBusy(false)
    }
  }

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
        <div className="camera-toolbar-actions">
          <button
            type="button"
            className={`camera-torch ${torchOn ? 'active' : ''}`}
            onClick={() => void toggleTorch()}
            disabled={!torchSupported || torchBusy || Boolean(error)}
            aria-pressed={torchOn}
          >
            {torchBusy ? '切替中…' : torchSupported ? `ライト ${torchOn ? 'ON' : 'OFF'}` : 'ライト非対応'}
          </button>
          <button type="button" className="camera-close" onClick={onClose}>完了</button>
        </div>
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
        <p>ライトONは撮影画面を閉じるまで維持します。撮影後も続けて何枚でも撮影できます。</p>
      </div>
    </div>
  )
}
