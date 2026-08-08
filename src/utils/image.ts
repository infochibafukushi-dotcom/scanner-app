import type { FilterMode, Point, ScanPage } from '../types'

export const defaultCorners = (): [Point, Point, Point, Point] => [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 }
]

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })

const grayscale = (r: number, g: number, b: number) => Math.round(r * 0.299 + g * 0.587 + b * 0.114)

const applyFilter = (ctx: CanvasRenderingContext2D, filter: FilterMode, width: number, height: number) => {
  if (filter === 'color') return

  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData

  for (let i = 0; i < data.length; i += 4) {
    const gray = grayscale(data[i], data[i + 1], data[i + 2])

    if (filter === 'gray') {
      data[i] = gray
      data[i + 1] = gray
      data[i + 2] = gray
      continue
    }

    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128))
    const value = contrasted > 165 ? 255 : 0
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }

  ctx.putImageData(imageData, 0, 0)
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const solveLinearSystem = (matrix: number[][], vector: number[]) => {
  const n = vector.length
  const augmented = matrix.map((row, index) => [...row, vector[index]])

  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row
    }

    ;[augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]]
    const divisor = augmented[col][col]
    if (Math.abs(divisor) < 1e-10) throw new Error('四隅の形状を補正できません。')

    for (let j = col; j <= n; j += 1) augmented[col][j] /= divisor

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = augmented[row][col]
      for (let j = col; j <= n; j += 1) augmented[row][j] -= factor * augmented[col][j]
    }
  }

  return augmented.map((row) => row[n])
}

const computeHomography = (destination: Point[], source: Point[]) => {
  const matrix: number[][] = []
  const vector: number[] = []

  for (let i = 0; i < 4; i += 1) {
    const { x, y } = destination[i]
    const { x: u, y: v } = source[i]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    vector.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    vector.push(v)
  }

  const h = solveLinearSystem(matrix, vector)
  return [...h, 1]
}

const warpPerspective = (sourceCanvas: HTMLCanvasElement, corners: [Point, Point, Point, Point]) => {
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceCtx) throw new Error('Canvas context could not be created.')

  const sourcePoints = corners.map((point) => ({
    x: point.x * sourceCanvas.width,
    y: point.y * sourceCanvas.height
  }))

  const [topLeft, topRight, bottomRight, bottomLeft] = sourcePoints
  let outputWidth = Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))
  let outputHeight = Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))

  const maxSide = 1600
  const scale = Math.min(1, maxSide / Math.max(outputWidth, outputHeight))
  outputWidth = Math.max(1, Math.round(outputWidth * scale))
  outputHeight = Math.max(1, Math.round(outputHeight * scale))

  const destinationPoints: Point[] = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 }
  ]

  const homography = computeHomography(destinationPoints, sourcePoints)
  const sourceData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = outputWidth
  outputCanvas.height = outputHeight
  const outputCtx = outputCanvas.getContext('2d')
  if (!outputCtx) throw new Error('Canvas context could not be created.')

  const outputData = outputCtx.createImageData(outputWidth, outputHeight)
  const src = sourceData.data
  const dst = outputData.data

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const denominator = homography[6] * x + homography[7] * y + homography[8]
      const sourceX = (homography[0] * x + homography[1] * y + homography[2]) / denominator
      const sourceY = (homography[3] * x + homography[4] * y + homography[5]) / denominator
      const sx = Math.max(0, Math.min(sourceCanvas.width - 1, Math.round(sourceX)))
      const sy = Math.max(0, Math.min(sourceCanvas.height - 1, Math.round(sourceY)))
      const sourceIndex = (sy * sourceCanvas.width + sx) * 4
      const outputIndex = (y * outputWidth + x) * 4
      dst[outputIndex] = src[sourceIndex]
      dst[outputIndex + 1] = src[sourceIndex + 1]
      dst[outputIndex + 2] = src[sourceIndex + 2]
      dst[outputIndex + 3] = 255
    }
  }

  outputCtx.putImageData(outputData, 0, 0)
  return outputCanvas
}

const normalizeRotation = (rotation: number) => {
  const normalized = rotation % 360
  return normalized < 0 ? normalized + 360 : normalized
}

export const renderScanPage = async (page: ScanPage): Promise<HTMLCanvasElement> => {
  const sourceImage = await loadImage(page.dataUrl)
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = sourceImage.width
  sourceCanvas.height = sourceImage.height
  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) throw new Error('Canvas context could not be created.')
  sourceCtx.drawImage(sourceImage, 0, 0)

  const correctedCanvas = warpPerspective(sourceCanvas, page.corners)
  const correctedCtx = correctedCanvas.getContext('2d')
  if (!correctedCtx) throw new Error('Canvas context could not be created.')
  applyFilter(correctedCtx, page.filter, correctedCanvas.width, correctedCanvas.height)

  const rotation = normalizeRotation(page.rotation)
  if (rotation === 0) return correctedCanvas

  const rotatedCanvas = document.createElement('canvas')
  const rotatedCtx = rotatedCanvas.getContext('2d')
  if (!rotatedCtx) throw new Error('Canvas context could not be created.')

  const isQuarterTurn = rotation === 90 || rotation === 270
  rotatedCanvas.width = isQuarterTurn ? correctedCanvas.height : correctedCanvas.width
  rotatedCanvas.height = isQuarterTurn ? correctedCanvas.width : correctedCanvas.height

  rotatedCtx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2)
  rotatedCtx.rotate((rotation * Math.PI) / 180)
  rotatedCtx.drawImage(correctedCanvas, -correctedCanvas.width / 2, -correctedCanvas.height / 2)

  return rotatedCanvas
}
