import { HIGH_RES_LABELS, type HighResCaptureStep, type HighResTileId } from '../types'

type Box = { x: number; y: number; width: number; height: number }

export const highResTileLabel = (id: HighResTileId | HighResCaptureStep) => HIGH_RES_LABELS[id]
export const HIGH_RES_TILE_LABELS = HIGH_RES_LABELS

export const laplacianVariance = (imageData: ImageData): number => {
  const { data, width, height } = imageData
  if (width < 3 || height < 3) return 0
  const gray = new Float32Array(width * height)
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel += 1) {
    gray[pixel] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  }

  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x
      const value = 4 * gray[pixel] - gray[pixel - 1] - gray[pixel + 1] - gray[pixel - width] - gray[pixel + width]
      sum += value
      sumSquares += value * value
      count += 1
    }
  }
  return count ? sumSquares / count - (sum / count) ** 2 : 0
}

export const isBlurry = async (dataUrl: string, threshold = 85) => {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = reject
    element.src = dataUrl
  })
  const scale = Math.min(1, 640 / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas を作成できませんでした。')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const score = laplacianVariance(context.getImageData(0, 0, canvas.width, canvas.height))
  return { blurry: score < threshold, score }
}

const project = (H: ArrayLike<number>, x: number, y: number) => {
  const denominator = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / denominator, y: (H[3] * x + H[4] * y + H[5]) / denominator }
}

const intersection = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

export const boxesOverlapTooMuch = (a: Box, b: Box, threshold = 0.8) =>
  intersection(a, b) / Math.max(1, Math.min(a.width * a.height, b.width * b.height)) > threshold

export const analyzeCoverageFromHomography = (H: ArrayLike<number>, tileW: number, tileH: number, refW: number, refH: number) => {
  const points = [project(H, 0, 0), project(H, tileW, 0), project(H, tileW, tileH), project(H, 0, tileH)]
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const bbox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  const reference = { x: 0, y: 0, width: refW, height: refH }
  const overlap = intersection(bbox, reference)
  const area = bbox.width * bbox.height
  return {
    bbox,
    points,
    areaRatio: area / Math.max(1, refW * refH),
    iou: overlap / Math.max(1, area + refW * refH - overlap),
    intersectionRatio: overlap / Math.max(1, area)
  }
}

export const evaluateHomographyMatrix = (H: ArrayLike<number>) => {
  const determinant = H[0] * H[4] - H[1] * H[3]
  const scale = Math.sqrt(Math.abs(determinant))
  const rotationDeg = Math.atan2(H[3], H[0]) * 180 / Math.PI
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return { scale, rotationDeg, ok: false, reason: '変換行列が不安定です。' }
  if (scale < 0.12 || scale > 7) return { scale, rotationDeg, ok: false, reason: '拡大率が不自然です。' }
  if (Math.abs(rotationDeg) > 28) return { scale, rotationDeg, ok: false, reason: '撮影角度のずれが大きすぎます。' }
  return { scale, rotationDeg, ok: true }
}

export const inspectStitchQuality = (imageData: ImageData) => {
  const { data, width, height } = imageData
  const issues: string[] = []
  const aspect = width / Math.max(1, height)
  if (aspect > 2.5 || aspect < 0.4) issues.push('出力の縦横比が不自然です。')
  if (width < 500 || height < 500) issues.push('出力サイズが小さすぎます。')

  const columns = 12
  const rows = 12
  let blankCells = 0
  for (let cellY = 0; cellY < rows; cellY += 1) {
    for (let cellX = 0; cellX < columns; cellX += 1) {
      let blank = 0
      let samples = 0
      for (let y = Math.floor(cellY * height / rows); y < Math.floor((cellY + 1) * height / rows); y += 8) {
        for (let x = Math.floor(cellX * width / columns); x < Math.floor((cellX + 1) * width / columns); x += 8) {
          const index = (y * width + x) * 4
          if (data[index + 3] < 20 || (data[index] > 248 && data[index + 1] > 248 && data[index + 2] > 248)) blank += 1
          samples += 1
        }
      }
      if (samples && blank / samples > 0.985) blankCells += 1
    }
  }
  if (blankCells > columns * rows * 0.3) issues.push('大きな空白領域があります。')
  return { ok: issues.length === 0, issues }
}
