import { defaultCorners } from './image'
import { detectSpineFromSampler, SPINE_SPLIT_AUTO_CONFIDENCE } from './spineDetect'

export { SPINE_SPLIT_AUTO_CONFIDENCE }

export type SpineSplitResult = {
  leftDataUrl: string
  rightDataUrl: string
  spineX: number
  width: number
  confidence: number
}

/**
 * Find the darkest vertical band near the center — usually the book spine / gutter.
 * Searches 28%–72% of width to avoid page edges.
 */
export const findSpineX = (
  width: number,
  height: number,
  sampleGray: (x: number, y: number) => number
) => detectSpineFromSampler(width, height, sampleGray).spineX

export const findSpineWithConfidence = (
  width: number,
  height: number,
  sampleGray: (x: number, y: number) => number
) => detectSpineFromSampler(width, height, sampleGray)

/** Split a facing-page image into left/right pages using spine detection. */
export const splitDataUrlVertically = async (dataUrl: string): Promise<SpineSplitResult> => {
  const image = await loadImage(dataUrl)
  const width = image.width
  const height = image.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas context could not be created.')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, width, height)

  const { spineX, confidence } = findSpineWithConfidence(width, height, (x, y) => {
    const i = (y * width + x) * 4
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  })

  // Small overlap avoidance: cut with a 1px gutter discard around the spine.
  const gutter = Math.min(4, Math.floor(width * 0.004))
  const leftEnd = Math.max(1, spineX - gutter)
  const rightStart = Math.min(width - 1, spineX + gutter)
  const rightWidth = Math.max(1, width - rightStart)

  return {
    leftDataUrl: cropCanvasToDataUrl(canvas, 0, 0, leftEnd, height),
    rightDataUrl: cropCanvasToDataUrl(canvas, rightStart, 0, rightWidth, height),
    spineX,
    width,
    confidence
  }
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('画像を読み込めませんでした'))
    image.src = src
  })

const cropCanvasToDataUrl = (
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  width: number,
  height: number
) => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context could not be created.')
  ctx.drawImage(source, sx, sy, width, height, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.95)
}

export const freshCorners = () => defaultCorners()
