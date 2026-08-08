import { useEffect, useRef, useState } from 'react'
import { HIGH_RES_SHOT_ORDER, stitchHighResCaptures } from '../utils/highResStitch'

type CameraCaptureProps = {
  open: boolean
  onClose: () => void
  onCapture: (dataUrl: string) => void
}

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean }
type TorchConstraintSet = MediaTrackConstraintSet & { torch?: boolean }
type CaptureMode = 'normal' | 'highres'

export function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const videoTrackRef = useRef<MediaStreamTrack | null>(null)
  const torchOnRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [capturedCount, setCapturedCount] = useState(0)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchBusy, setTorchBusy] = useState(false)
  const [mode, setMode] = useState<CaptureMode>('normal')
  const [highResShots, setHighResShots] = useState<string[]>([])
  const [stitching, setStitching] = useState(false)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setCapturedCount(0)
    setHighResShots([])
    setStitching(false)

    const startCamera = async () => {
      try {
        setError(null)
        setTorchSupported(false)
        setTorchOn(false)
        torchOnRef.current = false
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
      if (track && torchOnRef.current) {
        void track.applyConstraints({ advanced: [{ torch: false } as TorchConstraintSet] }).catch(() => undefined)
      }
      streamRef.current?.getTracks().forEach((mediaTrack) => mediaTrack.stop())
      streamRef.current = null
      videoTrackRef.current = null
      torchOnRef.current = false
      setTorchOn(false)
      setTorchSupported(false)
      setHighResShots([])
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
      torchOnRef.current = next
      setTorchOn(next)
    } catch (torchError) {
      console.error(torchError)
      setTorchSupported(false)
      setTorchOn(false)
      torchOnRef.current = false
      window.alert('この端末・ブラウザでは撮影ライトを制御できません。')
    } finally {
      setTorchBusy(false)
    }
  }

  const captureFrame = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return null

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.96)
  }

  const capture = async () => {
    if (stitching) return
    const dataUrl = captureFrame()
    if (!dataUrl) return

    if (mode === 'normal') {
      onCapture(dataUrl)
      setCapturedCount((count) => count + 1)
      return
    }

    const nextShots = [...highResShots, dataUrl]
    if (nextShots.length < 4) {
      setHighResShots(nextShots)
      return
    }

    setHighResShots(nextShots)
    setStitching(true)
    try {
      const stitched = await stitchHighResCaptures(nextShots)
      onCapture(stitched)
      setCapturedCount((count) => count + 1)
      setHighResShots([])
    } catch (stitchError) {
      console.error(stitchError)
      const message = stitchError instanceof Error
        ? stitchError.message
        : '4分割画像の合成に失敗しました。撮影をやり直してください。'
      window.alert(message)
      setHighResShots([])
    } finally {
      setStitching(false)
    }
  }

  const switchMode = (nextMode: CaptureMode) => {
    if (stitching || nextMode === mode) return
    if (highResShots.length && nextMode === 'normal') {
      const discard = window.confirm('撮影途中の高精細スキャンを破棄して通常撮影へ戻りますか？')
      if (!discard) return
    }
    setHighResShots([])
    setMode(nextMode)
  }

  const highResStep = Math.min(highResShots.length, 3)
  const highResPosition = HIGH_RES_SHOT_ORDER[highResStep]

  return (
    <div className="camera-modal" role="dialog" aria-modal="true" aria-label="スキャン撮影">
      <div className="camera-toolbar">
        <div className="camera-session-info">
          <strong>{mode === 'normal' ? '連続撮影' : '高精細4分割'}</strong>
          <span>{capturedCount}ページ撮影</span>
        </div>

        <div className="camera-toolbar-actions">
          <div className="camera-mode-switch" aria-label="撮影モード">
            <button type="button" className={mode === 'normal' ? 'active' : ''} onClick={() => switchMode('normal')} disabled={stitching}>通常</button>
            <button type="button" className={mode === 'highres' ? 'active' : ''} onClick={() => switchMode('highres')} disabled={stitching}>高精細4分割</button>
          </div>
          <button
            type="button"
            className={`camera-torch ${torchOn ? 'active' : ''}`}
            onClick={() => void toggleTorch()}
            disabled={!torchSupported || torchBusy || Boolean(error) || stitching}
            aria-pressed={torchOn}
          >
            {torchBusy ? '切替中…' : torchSupported ? `ライト ${torchOn ? 'ON' : 'OFF'}` : 'ライト非対応'}
          </button>
          <button type="button" className="camera-close" onClick={onClose} disabled={stitching}>完了</button>
        </div>
      </div>

      <div className={`camera-view ${mode === 'highres' ? 'highres-mode' : ''}`}>
        <video ref={videoRef} playsInline muted className="camera-video" />
        {mode === 'normal' ? (
          <div className="camera-guide" aria-hidden="true" />
        ) : (
          <>
            <div className="highres-reticle" aria-hidden="true" />
            <div className="highres-instruction">
              {stitching ? (
                <strong>文字・線を照合して4枚を位置合わせ中…</strong>
              ) : (
                <>
                  <span>高精細 {highResShots.length + 1} / 4</span>
                  <strong>{highResPosition}を画面いっぱいに撮影</strong>
                  <small>隣の写真と約40%重ね、距離と傾きをなるべく一定にしてください</small>
                </>
              )}
            </div>
            <div className="highres-map" aria-label="4分割撮影位置">
              {HIGH_RES_SHOT_ORDER.map((position, index) => (
                <div
                  key={position}
                  className={`${index === highResStep && !stitching ? 'active' : ''} ${index < highResShots.length ? 'done' : ''}`}
                >
                  <span>{index + 1}</span>
                  <small>{position}</small>
                </div>
              ))}
            </div>
          </>
        )}
        {error && <div className="camera-error">{error}</div>}
      </div>

      <div className="camera-footer">
        {mode === 'highres' && (
          <div className="highres-footer-actions">
            <button
              type="button"
              className="camera-secondary-action"
              onClick={() => setHighResShots((shots) => shots.slice(0, -1))}
              disabled={!highResShots.length || stitching}
            >
              1枚戻す
            </button>
            <div className="highres-progress-dots" aria-label={`${highResShots.length} / 4枚撮影済み`}>
              {HIGH_RES_SHOT_ORDER.map((position, index) => (
                <span key={position} className={index < highResShots.length ? 'done' : index === highResStep ? 'active' : ''} />
              ))}
            </div>
            <button
              type="button"
              className="camera-secondary-action"
              onClick={() => setHighResShots([])}
              disabled={!highResShots.length || stitching}
            >
              最初から
            </button>
          </div>
        )}

        <button
          type="button"
          className="shutter-button"
          onClick={() => void capture()}
          disabled={Boolean(error) || stitching}
          aria-label={mode === 'highres' ? `${highResPosition}を撮影` : '撮影'}
        >
          <span />
        </button>
        <p>
          {mode === 'normal'
            ? 'ライトONは撮影画面を閉じるまで維持します。撮影後も続けて何枚でも撮影できます。'
            : stitching
              ? '重複部分の文字・線を照合し、位置と明るさを合わせて1枚に合成しています。'
              : '左上 → 右上 → 右下 → 左下の順に、隣の範囲を約40%重ねて撮影します。'}
        </p>
      </div>
    </div>
  )
}
