import type { FilterMode, Point, ScanPage } from '../types'
import { applyAspectToSize, resolveTargetAspect } from './paper'

/** Purpose-specific max side lengths to balance quality and mobile memory. */
export const RENDER_MAX = {
  preview: 1800,
  editor: 2400,
  gallery: 800,
  ocr: 2400,
  export: 3400,
  highRes: 4000
} as const

export const defaultCorners = (): [Point, Point, Point, Point] => [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 }
]

const enableHighQuality = (ctx: CanvasRenderingContext2D) => {
  ctx.imageSmoothingEnabled = true
  try {
    ctx.imageSmoothingQuality = 'high'
  } catch {
    // Older browsers may omit imageSmoothingQuality.
  }
}

export const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const grayscale = (r: number, g: number, b: number) => Math.round(r * 0.299 + g * 0.587 + b * 0.114)

const percentileFromHistogram = (histogram: Uint32Array, total: number, percentile: number) => {
  const target = total * percentile
  let accumulated = 0
  for (let value = 0; value < histogram.length; value += 1) {
    accumulated += histogram[value]
    if (accumulated >= target) return value
  }
  return 255
}

const boxBlur = (input: Uint8Array, width: number, height: number, radius: number) => {
  const horizontal = new Float32Array(input.length)
  const output = new Uint8Array(input.length)
  const size = radius * 2 + 1

  for (let y = 0; y < height; y += 1) {
    let sum = 0
    for (let x = -radius; x <= radius; x += 1) sum += input[y * width + clamp(x, 0, width - 1)]
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / size
      const leaving = clamp(x - radius, 0, width - 1)
      const entering = clamp(x + radius + 1, 0, width - 1)
      sum += input[y * width + entering] - input[y * width + leaving]
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = -radius; y <= radius; y += 1) sum += horizontal[clamp(y, 0, height - 1) * width + x]
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = Math.round(sum / size)
      const leaving = clamp(y - radius, 0, height - 1)
      const entering = clamp(y + radius + 1, 0, height - 1)
      sum += horizontal[entering * width + x] - horizontal[leaving * width + x]
    }
  }

  return output
}

/**
 * Estimate slowly changing page illumination on a small luminance map, then
 * normalize each source pixel against that background. This removes broad
 * phone/hand shadows without needing OpenCV and keeps the operation cheap
 * enough for a mobile PWA.
 */
const enhanceDocument = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData

  const mapMaxSide = 320
  const mapScale = Math.min(1, mapMaxSide / Math.max(width, height))
  const mapWidth = Math.max(24, Math.round(width * mapScale))
  const mapHeight = Math.max(24, Math.round(height * mapScale))
  const luminanceMap = new Uint8Array(mapWidth * mapHeight)

  for (let my = 0; my < mapHeight; my += 1) {
    const sy = clamp(Math.round(((my + 0.5) / mapHeight) * height - 0.5), 0, height - 1)
    for (let mx = 0; mx < mapWidth; mx += 1) {
      const sx = clamp(Math.round(((mx + 0.5) / mapWidth) * width - 0.5), 0, width - 1)
      const index = (sy * width + sx) * 4
      luminanceMap[my * mapWidth + mx] = grayscale(data[index], data[index + 1], data[index + 2])
    }
  }

  const blurRadius = Math.max(6, Math.round(Math.min(mapWidth, mapHeight) * 0.055))
  const background = boxBlur(luminanceMap, mapWidth, mapHeight, blurRadius)
  const correctedLuminance = new Uint8Array(width * height)
  const correctedHistogram = new Uint32Array(256)

  for (let y = 0; y < height; y += 1) {
    const my = clamp(Math.round((y / Math.max(1, height - 1)) * (mapHeight - 1)), 0, mapHeight - 1)
    for (let x = 0; x < width; x += 1) {
      const mx = clamp(Math.round((x / Math.max(1, width - 1)) * (mapWidth - 1)), 0, mapWidth - 1)
      const pixel = y * width + x
      const index = pixel * 4
      const sourceY = grayscale(data[index], data[index + 1], data[index + 2])
      const localBackground = Math.max(42, background[my * mapWidth + mx])

      // Bring the estimated paper background toward a bright neutral value.
      // Limit the gain so dark photos are improved without amplifying noise.
      const illuminationGain = clamp(232 / localBackground, 0.78, 2.35)
      const shadowCorrected = clamp(sourceY * illuminationGain, 0, 255)
      const value = Math.round(shadowCorrected)
      correctedLuminance[pixel] = value
      correctedHistogram[value] += 1
    }
  }

  const total = width * height
  const low = percentileFromHistogram(correctedHistogram, total, 0.012)
  const high = percentileFromHistogram(correctedHistogram, total, 0.992)
  const range = Math.max(56, high - low)

  for (let pixel = 0, i = 0; i < data.length; i += 4, pixel += 1) {
    const sourceY = Math.max(1, grayscale(data[i], data[i + 1], data[i + 2]))
    const correctedY = correctedLuminance[pixel]
    const stretched = clamp(((correctedY - low) / range) * 255, 0, 255)

    // Blend auto-levels instead of applying a full hard stretch so color pages
    // remain natural while paper backgrounds become cleaner and more even.
    const leveled = clamp(correctedY * 0.38 + stretched * 0.62, 0, 255)
    const contrasted = clamp((leveled - 128) * 1.04 + 128, 0, 255)
    const factor = clamp(contrasted / sourceY, 0.3, 3.6)

    data[i] = Math.round(clamp(data[i] * factor, 0, 255))
    data[i + 1] = Math.round(clamp(data[i + 1] * factor, 0, 255))
    data[i + 2] = Math.round(clamp(data[i + 2] * factor, 0, 255))
  }

  ctx.putImageData(imageData, 0, 0)
}


const applyClean = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData
  const original = new Uint8ClampedArray(data)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      const value = grayscale(original[index], original[index + 1], original[index + 2])
      const offsets = [
        ((y - 1) * width + x) * 4,
        ((y + 1) * width + x) * 4,
        (y * width + x - 1) * 4,
        (y * width + x + 1) * 4,
        ((y - 1) * width + x - 1) * 4,
        ((y - 1) * width + x + 1) * 4,
        ((y + 1) * width + x - 1) * 4,
        ((y + 1) * width + x + 1) * 4
      ]
      const neighbors = offsets.map((offset) => grayscale(original[offset], original[offset + 1], original[offset + 2]))
      const minimum = Math.min(...neighbors)
      const average = neighbors.reduce((sum, neighbor) => sum + neighbor, 0) / neighbors.length
      const brightNeighbors = neighbors.filter((neighbor) => neighbor > 228).length
      // Only lift tiny isolated speckles on bright paper; leave fine text/lines alone.
      if (value >= 140 && minimum > 228 && average - value > 45 && brightNeighbors >= 7) {
        const mix = 0.55
        for (let channel = 0; channel < 3; channel += 1) {
          data[index + channel] = Math.round(original[index + channel] * (1 - mix) + average * mix)
        }
      } else if (value >= 190 && minimum > 232 && average - value > 18 && brightNeighbors >= 7) {
        for (let channel = 0; channel < 3; channel += 1) {
          data[index + channel] = Math.round(original[index + channel] * 0.85 + average * 0.15)
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0)
}

/** Mild unsharp mask — strengthens edges slightly without visible halos. */
const applyMildUnsharp = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData
  const source = new Uint8ClampedArray(data)
  const amount = 0.22

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[index + channel]
        const blur =
          (source[((y - 1) * width + x) * 4 + channel] +
            source[((y + 1) * width + x) * 4 + channel] +
            source[(y * width + x - 1) * 4 + channel] +
            source[(y * width + x + 1) * 4 + channel] +
            center * 4) /
          8
        const sharpened = center + amount * (center - blur)
        data[index + channel] = Math.round(clamp(sharpened, 0, 255))
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
}

const applyAutoEnhance = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData
  const illuminationCanvas = document.createElement('canvas')
  illuminationCanvas.width = width
  illuminationCanvas.height = height
  const illuminationCtx = illuminationCanvas.getContext('2d', { willReadFrequently: true })
  if (!illuminationCtx) throw new Error('Canvas context could not be created.')
  illuminationCtx.filter = `blur(${clamp(Math.round(Math.min(width, height) / 24), 14, 48)}px)`
  illuminationCtx.drawImage(ctx.canvas, 0, 0)
  const illumination = illuminationCtx.getImageData(0, 0, width, height).data
  const histogram = new Uint32Array(256)
  const luminance = new Uint8Array(width * height)
  for (let pixel = 0, index = 0; index < data.length; index += 4, pixel += 1) {
    const background = grayscale(illumination[index], illumination[index + 1], illumination[index + 2])
    const correction = clamp(240 / Math.max(135, background), 0.9, 1.16)
    data[index] = clamp(Math.round(data[index] * correction), 0, 255)
    data[index + 1] = clamp(Math.round(data[index + 1] * correction), 0, 255)
    data[index + 2] = clamp(Math.round(data[index + 2] * correction), 0, 255)
    const value = grayscale(data[index], data[index + 1], data[index + 2])
    luminance[pixel] = value
    histogram[value] += 1
  }
  const low = percentileFromHistogram(histogram, luminance.length, 0.01)
  const high = percentileFromHistogram(histogram, luminance.length, 0.995)
  const range = Math.max(45, high - low)
  for (let pixel = 0, index = 0; index < data.length; index += 4, pixel += 1) {
    const current = luminance[pixel]
    const target = current * 0.25 + clamp(((current - low) / range) * 240 + 8, 0, 255) * 0.75
    const adjustment = target / Math.max(1, current)
    data[index] = clamp(Math.round(data[index] * adjustment), 0, 255)
    data[index + 1] = clamp(Math.round(data[index + 1] * adjustment), 0, 255)
    data[index + 2] = clamp(Math.round(data[index + 2] * adjustment), 0, 255)
  }
  ctx.putImageData(imageData, 0, 0)
}

const applyFilter = (ctx: CanvasRenderingContext2D, filter: FilterMode, width: number, height: number) => {
  // Legacy `bw` is treated as gray for compatibility with old saves.
  const mode = filter === 'bw' ? 'gray' : filter
  if (mode === 'color') return
  if (mode === 'auto') { applyAutoEnhance(ctx, width, height); return }
  const imageData = ctx.getImageData(0, 0, width, height)
  const { data } = imageData
  const total = width * height
  const luminance = new Uint8Array(total)
  const histogram = new Uint32Array(256)
  for (let pixel = 0, i = 0; i < data.length; i += 4, pixel += 1) {
    const gray = grayscale(data[i], data[i + 1], data[i + 2])
    luminance[pixel] = gray
    histogram[gray] += 1
  }
  const low = percentileFromHistogram(histogram, total, 0.02)
  const high = percentileFromHistogram(histogram, total, 0.98)
  const range = Math.max(28, high - low)
  const normalized = new Uint8Array(total)
  for (let pixel = 0; pixel < total; pixel += 1) {
    const stretched = clamp(((luminance[pixel] - low) / range) * 255, 0, 255)
    const gammaCorrected = 255 * Math.pow(stretched / 255, 0.94)
    normalized[pixel] = Math.round(clamp((gammaCorrected - 128) * 1.06 + 128, 0, 255))
  }
  for (let pixel = 0, i = 0; i < data.length; i += 4, pixel += 1) {
    const value = normalized[pixel]
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

const sampleBilinear = (
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
) => {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) {
    const sx = clamp(Math.round(x), 0, width - 1)
    const sy = clamp(Math.round(y), 0, height - 1)
    const index = (sy * width + sx) * 4
    return [src[index], src[index + 1], src[index + 2]] as const
  }

  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const dx = x - x0
  const dy = y - y0
  const invDx = 1 - dx
  const invDy = 1 - dy

  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4

  const mix = (c: number) =>
    src[i00 + c] * invDx * invDy +
    src[i10 + c] * dx * invDy +
    src[i01 + c] * invDx * dy +
    src[i11 + c] * dx * dy

  return [mix(0), mix(1), mix(2)] as const
}

const warpPerspective = (
  sourceCanvas: HTMLCanvasElement,
  corners: [Point, Point, Point, Point],
  maxSide: number = RENDER_MAX.export,
  paperSize: ScanPage['paperSize'] = 'auto'
) => {
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceCtx) throw new Error('Canvas context could not be created.')

  const sourcePoints = corners.map((point) => ({
    x: point.x * sourceCanvas.width,
    y: point.y * sourceCanvas.height
  }))

  const [topLeft, topRight, bottomRight, bottomLeft] = sourcePoints
  let outputWidth = Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))
  let outputHeight = Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))

  const targetAspect = resolveTargetAspect(paperSize, corners)
  ;({ width: outputWidth, height: outputHeight } = applyAspectToSize(outputWidth, outputHeight, targetAspect))

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
  const sourceWidth = sourceCanvas.width
  const sourceHeight = sourceCanvas.height

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const denominator = homography[6] * x + homography[7] * y + homography[8]
      const sourceX = (homography[0] * x + homography[1] * y + homography[2]) / denominator
      const sourceY = (homography[3] * x + homography[4] * y + homography[5]) / denominator
      const [r, g, b] = sampleBilinear(src, sourceWidth, sourceHeight, sourceX, sourceY)
      const outputIndex = (y * outputWidth + x) * 4
      dst[outputIndex] = r
      dst[outputIndex + 1] = g
      dst[outputIndex + 2] = b
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

export const renderEditorImage = async (
  dataUrl: string,
  filter: FilterMode,
  maxSide: number = RENDER_MAX.editor,
  clean = false
): Promise<HTMLCanvasElement> => {
  const sourceImage = await loadImage(dataUrl)
  const scale = Math.min(1, maxSide / Math.max(sourceImage.width, sourceImage.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceImage.width * scale))
  canvas.height = Math.max(1, Math.round(sourceImage.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context could not be created.')
  enableHighQuality(ctx)
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height)
  if (clean) applyClean(ctx, canvas.width, canvas.height)
  applyFilter(ctx, filter, canvas.width, canvas.height)
  return canvas
}

export const renderScanPage = async (
  page: ScanPage,
  maxSide: number = RENDER_MAX.preview
): Promise<HTMLCanvasElement> => {
  const sourceImage = await loadImage(page.dataUrl)
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = sourceImage.width
  sourceCanvas.height = sourceImage.height
  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) throw new Error('Canvas context could not be created.')
  enableHighQuality(sourceCtx)
  sourceCtx.drawImage(sourceImage, 0, 0)

  const correctedCanvas = warpPerspective(
    sourceCanvas,
    page.corners,
    maxSide,
    page.paperSize ?? (page as { paperRatio?: ScanPage['paperSize'] }).paperRatio ?? 'auto'
  )
  const correctedCtx = correctedCanvas.getContext('2d')
  if (!correctedCtx) throw new Error('Canvas context could not be created.')
  enhanceDocument(correctedCtx, correctedCanvas.width, correctedCanvas.height)
  if (page.clean) applyClean(correctedCtx, correctedCanvas.width, correctedCanvas.height)
  applyFilter(correctedCtx, page.filter, correctedCanvas.width, correctedCanvas.height)
  applyMildUnsharp(correctedCtx, correctedCanvas.width, correctedCanvas.height)

  const rotation = normalizeRotation(page.rotation)
  if (rotation === 0) return correctedCanvas

  const rotatedCanvas = document.createElement('canvas')
  const rotatedCtx = rotatedCanvas.getContext('2d')
  if (!rotatedCtx) throw new Error('Canvas context could not be created.')

  const isQuarterTurn = rotation === 90 || rotation === 270
  rotatedCanvas.width = isQuarterTurn ? correctedCanvas.height : correctedCanvas.width
  rotatedCanvas.height = isQuarterTurn ? correctedCanvas.width : correctedCanvas.height

  enableHighQuality(rotatedCtx)
  rotatedCtx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2)
  rotatedCtx.rotate((rotation * Math.PI) / 180)
  rotatedCtx.drawImage(correctedCanvas, -correctedCanvas.width / 2, -correctedCanvas.height / 2)

  return rotatedCanvas
}
