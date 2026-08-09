/** Shared high-resolution still capture for normal / high-res scan modes. */

export type CaptureProfile = 'normal' | 'highres'

type Caps = MediaTrackCapabilities & {
  torch?: boolean
  width?: { max?: number }
  height?: { max?: number }
}

const MAX_SIDE: Record<CaptureProfile, number> = {
  normal: 4000,
  highres: 4800
}

const JPEG_QUALITY: Record<CaptureProfile, number> = {
  normal: 0.97,
  highres: 0.98
}

const enableHighQuality = (ctx: CanvasRenderingContext2D) => {
  ctx.imageSmoothingEnabled = true
  try {
    ctx.imageSmoothingQuality = 'high'
  } catch {
    // Older browsers may not support imageSmoothingQuality.
  }
}

const canvasToJpegDataUrl = (canvas: HTMLCanvasElement, quality: number) =>
  canvas.toDataURL('image/jpeg', quality)

const downscaleIfNeeded = (source: CanvasImageSource, width: number, height: number, maxSide: number) => {
  const longest = Math.max(width, height)
  const scale = longest > maxSide ? maxSide / longest : 1
  const outW = Math.max(1, Math.round(width * scale))
  const outH = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context could not be created.')
  enableHighQuality(ctx)
  ctx.drawImage(source, 0, 0, outW, outH)
  return canvas
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })

/** Open the rear camera with the highest practical ideal resolution. */
export const openRearCamera = async (profile: CaptureProfile = 'normal') => {
  const idealWidth = profile === 'highres' ? 4096 : 3840
  const idealHeight = profile === 'highres' ? 3072 : 2160

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: idealWidth },
      height: { ideal: idealHeight }
    }
  })

  const track = stream.getVideoTracks()[0]
  const capabilities = (track?.getCapabilities?.() ?? {}) as Caps

  const maxW = capabilities.width?.max
  const maxH = capabilities.height?.max
  if (track && typeof maxW === 'number' && typeof maxH === 'number' && maxW > 0 && maxH > 0) {
    const targetSide = MAX_SIDE[profile]
    const scale = Math.min(1, targetSide / Math.max(maxW, maxH))
    try {
      await track.applyConstraints({
        width: { ideal: Math.round(maxW * scale) },
        height: { ideal: Math.round(maxH * scale) }
      })
    } catch {
      // Keep the stream even if the device rejects advanced constraints.
    }
  }

  return { stream, track, torchSupported: Boolean(capabilities.torch) }
}

const captureFromVideo = (video: HTMLVideoElement, profile: CaptureProfile) => {
  if (!video.videoWidth || !video.videoHeight) throw new Error('Video frame is not ready.')
  const canvas = downscaleIfNeeded(video, video.videoWidth, video.videoHeight, MAX_SIDE[profile])
  return canvasToJpegDataUrl(canvas, JPEG_QUALITY[profile])
}

/**
 * Prefer ImageCapture.takePhoto() when available so still-image resolution
 * can exceed the live preview stream. Falls back to a video-frame canvas grab.
 */
export const captureStillDataUrl = async (
  track: MediaStreamTrack | null | undefined,
  video: HTMLVideoElement | null | undefined,
  profile: CaptureProfile = 'normal'
): Promise<string> => {
  const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture

  if (track && typeof ImageCaptureCtor === 'function') {
    try {
      const capture = new ImageCaptureCtor(track)
      const blob = await capture.takePhoto()
      const dataUrl = await blobToDataUrl(blob)
      const image = await loadImage(dataUrl)
      const canvas = downscaleIfNeeded(image, image.width, image.height, MAX_SIDE[profile])
      return canvasToJpegDataUrl(canvas, JPEG_QUALITY[profile])
    } catch (error) {
      console.warn('ImageCapture.takePhoto failed; falling back to video frame.', error)
    }
  }

  if (!video) throw new Error('Camera video is not available.')
  return captureFromVideo(video, profile)
}
