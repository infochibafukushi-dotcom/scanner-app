import type { CornerDetectionResult, Point } from '../types'
import { detectDocumentCornersFromImageData } from './corners'

export type LiveCornerResult = CornerDetectionResult

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** Exponential smoothing to reduce live-preview jitter. */
export const smoothCorners = (
  previous: [Point, Point, Point, Point] | null,
  next: [Point, Point, Point, Point],
  alpha = 0.42
): [Point, Point, Point, Point] => {
  if (!previous) return next
  return previous.map((point, index) => ({
    x: clamp01(point.x * (1 - alpha) + next[index].x * alpha),
    y: clamp01(point.y * (1 - alpha) + next[index].y * alpha)
  })) as [Point, Point, Point, Point]
}

/** Captures a small frame so contour work does not compete with camera rendering. */
export const detectLiveDocumentCorners = async (
  video: HTMLVideoElement,
  maxSide = 480
): Promise<LiveCornerResult | null> => {
  if (!video.videoWidth || !video.videoHeight) return null

  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(96, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(96, Math.round(video.videoHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null

  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  // Skip JPEG encode/decode — feed pixels directly into the detector.
  return detectDocumentCornersFromImageData(context.getImageData(0, 0, canvas.width, canvas.height))
}

export const frameDifference = (
  previous: ImageData | null,
  current: ImageData
): { difference: number; frame: ImageData } => {
  if (!previous || previous.data.length !== current.data.length) return { difference: Infinity, frame: current }

  let total = 0
  const step = 16
  for (let index = 0; index < current.data.length; index += step) {
    total += Math.abs(current.data[index] - previous.data[index])
    total += Math.abs(current.data[index + 1] - previous.data[index + 1])
    total += Math.abs(current.data[index + 2] - previous.data[index + 2])
  }
  return { difference: total / ((current.data.length / step) * 3), frame: current }
}

export const readSmallVideoFrame = (video: HTMLVideoElement, size = 96): ImageData | null => {
  if (!video.videoWidth || !video.videoHeight) return null
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(video, 0, 0, size, size)
  return context.getImageData(0, 0, size, size)
}

export type { Point }
