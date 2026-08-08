import type { Point } from '../types'
import { defaultCorners, loadImage } from './image'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const grayscale = (r: number, g: number, b: number) => Math.round(r * 0.299 + g * 0.587 + b * 0.114)

type Candidate = { t: number; v: number; weight: number }
type Line = { a: number; b: number; quality: number }

const weightedLineFit = (points: Candidate[]): Line | null => {
  if (points.length < 8) return null

  let sumW = 0
  let sumT = 0
  let sumV = 0
  let sumTT = 0
  let sumTV = 0

  for (const point of points) {
    const weight = Math.max(1, point.weight)
    sumW += weight
    sumT += weight * point.t
    sumV += weight * point.v
    sumTT += weight * point.t * point.t
    sumTV += weight * point.t * point.v
  }

  const denominator = sumW * sumTT - sumT * sumT
  if (Math.abs(denominator) < 1e-8) return null

  const a = (sumW * sumTV - sumT * sumV) / denominator
  const b = (sumV - a * sumT) / sumW
  const meanWeight = sumW / points.length
  return { a, b, quality: meanWeight }
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const robustLineFit = (candidates: Candidate[]): Line | null => {
  if (candidates.length < 12) return null

  const weights = candidates.map((point) => point.weight).sort((a, b) => a - b)
  const cutoff = weights[Math.floor(weights.length * 0.58)] ?? 0
  let working = candidates.filter((point) => point.weight >= cutoff)

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const line = weightedLineFit(working)
    if (!line) return null

    const residuals = working.map((point) => Math.abs(point.v - (line.a * point.t + line.b)))
    const typicalResidual = median(residuals)
    const limit = Math.max(4, typicalResidual * 2.8)
    const filtered = working.filter((point) => Math.abs(point.v - (line.a * point.t + line.b)) <= limit)

    if (filtered.length < 10 || filtered.length === working.length) return line
    working = filtered
  }

  return weightedLineFit(working)
}

const blurGrayscale = (input: Uint8Array, width: number, height: number) => {
  const horizontal = new Float32Array(input.length)
  const output = new Uint8Array(input.length)
  const radius = 2

  for (let y = 0; y < height; y += 1) {
    let sum = 0
    for (let x = -radius; x <= radius; x += 1) sum += input[y * width + clamp(x, 0, width - 1)]
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / (radius * 2 + 1)
      const leaving = clamp(x - radius, 0, width - 1)
      const entering = clamp(x + radius + 1, 0, width - 1)
      sum += input[y * width + entering] - input[y * width + leaving]
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0
    for (let y = -radius; y <= radius; y += 1) sum += horizontal[clamp(y, 0, height - 1) * width + x]
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = Math.round(sum / (radius * 2 + 1))
      const leaving = clamp(y - radius, 0, height - 1)
      const entering = clamp(y + radius + 1, 0, height - 1)
      sum += horizontal[entering * width + x] - horizontal[leaving * width + x]
    }
  }

  return output
}

const polygonArea = (points: Point[]) => {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const next = points[(i + 1) % points.length]
    area += points[i].x * next.y - next.x * points[i].y
  }
  return Math.abs(area) / 2
}

const intersect = (horizontal: Line, vertical: Line): Point | null => {
  const denominator = 1 - vertical.a * horizontal.a
  if (Math.abs(denominator) < 1e-6) return null
  const x = (vertical.a * horizontal.b + vertical.b) / denominator
  const y = horizontal.a * x + horizontal.b
  return { x, y }
}

const geometryLooksLikeDocument = (corners: Point[], width: number, height: number) => {
  if (corners.length !== 4) return false
  if (corners.some((point) => point.x < -width * 0.08 || point.x > width * 1.08 || point.y < -height * 0.08 || point.y > height * 1.08)) return false

  const normalized = corners.map((point) => ({ x: point.x / width, y: point.y / height }))
  if (polygonArea(normalized) < 0.16) return false

  const [tl, tr, br, bl] = normalized
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y)
  const left = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  const right = Math.hypot(br.x - tr.x, br.y - tr.y)
  return Math.min(top, bottom, left, right) > 0.22
}

export const detectDocumentCorners = async (dataUrl: string): Promise<{ corners: [Point, Point, Point, Point]; detected: boolean }> => {
  try {
    const image = await loadImage(dataUrl)
    const maxSide = 720
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const width = Math.max(80, Math.round(image.width * scale))
    const height = Math.max(80, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { corners: defaultCorners(), detected: false }

    ctx.drawImage(image, 0, 0, width, height)
    const source = ctx.getImageData(0, 0, width, height).data
    const gray = new Uint8Array(width * height)
    for (let pixel = 0, i = 0; i < source.length; i += 4, pixel += 1) gray[pixel] = grayscale(source[i], source[i + 1], source[i + 2])
    const blurred = blurGrayscale(gray, width, height)
    const gx = new Float32Array(width * height)
    const gy = new Float32Array(width * height)

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const tl = blurred[(y - 1) * width + x - 1]
        const tc = blurred[(y - 1) * width + x]
        const tr = blurred[(y - 1) * width + x + 1]
        const ml = blurred[y * width + x - 1]
        const mr = blurred[y * width + x + 1]
        const bl = blurred[(y + 1) * width + x - 1]
        const bc = blurred[(y + 1) * width + x]
        const br = blurred[(y + 1) * width + x + 1]
        const index = y * width + x
        gx[index] = Math.abs((tr + 2 * mr + br) - (tl + 2 * ml + bl))
        gy[index] = Math.abs((bl + 2 * bc + br) - (tl + 2 * tc + tr))
      }
    }

    const top: Candidate[] = []
    const bottom: Candidate[] = []
    const left: Candidate[] = []
    const right: Candidate[] = []
    const xStep = Math.max(2, Math.round(width / 170))
    const yStep = Math.max(2, Math.round(height / 170))
    const topStart = Math.round(height * 0.025)
    const topEnd = Math.round(height * 0.48)
    const bottomStart = Math.round(height * 0.52)
    const bottomEnd = Math.round(height * 0.975)
    const leftStart = Math.round(width * 0.025)
    const leftEnd = Math.round(width * 0.48)
    const rightStart = Math.round(width * 0.52)
    const rightEnd = Math.round(width * 0.975)

    for (let x = Math.round(width * 0.06); x < width * 0.94; x += xStep) {
      let bestTop = { y: topStart, score: 0 }
      let bestBottom = { y: bottomStart, score: 0 }
      for (let y = topStart; y <= topEnd; y += 1) {
        const score = gy[y * width + x]
        if (score > bestTop.score) bestTop = { y, score }
      }
      for (let y = bottomStart; y <= bottomEnd; y += 1) {
        const score = gy[y * width + x]
        if (score > bestBottom.score) bestBottom = { y, score }
      }
      top.push({ t: x, v: bestTop.y, weight: bestTop.score })
      bottom.push({ t: x, v: bestBottom.y, weight: bestBottom.score })
    }

    for (let y = Math.round(height * 0.06); y < height * 0.94; y += yStep) {
      let bestLeft = { x: leftStart, score: 0 }
      let bestRight = { x: rightStart, score: 0 }
      for (let x = leftStart; x <= leftEnd; x += 1) {
        const score = gx[y * width + x]
        if (score > bestLeft.score) bestLeft = { x, score }
      }
      for (let x = rightStart; x <= rightEnd; x += 1) {
        const score = gx[y * width + x]
        if (score > bestRight.score) bestRight = { x, score }
      }
      left.push({ t: y, v: bestLeft.x, weight: bestLeft.score })
      right.push({ t: y, v: bestRight.x, weight: bestRight.score })
    }

    const topLine = robustLineFit(top)
    const bottomLine = robustLineFit(bottom)
    const leftLine = robustLineFit(left)
    const rightLine = robustLineFit(right)
    if (!topLine || !bottomLine || !leftLine || !rightLine) return { corners: defaultCorners(), detected: false }

    const rawCorners = [
      intersect(topLine, leftLine),
      intersect(topLine, rightLine),
      intersect(bottomLine, rightLine),
      intersect(bottomLine, leftLine)
    ]

    if (rawCorners.some((point) => !point) || !geometryLooksLikeDocument(rawCorners as Point[], width, height)) {
      return { corners: defaultCorners(), detected: false }
    }

    const normalized = (rawCorners as Point[]).map((point) => ({
      x: clamp(point.x / width, 0.015, 0.985),
      y: clamp(point.y / height, 0.015, 0.985)
    })) as [Point, Point, Point, Point]

    const quality = Math.min(topLine.quality, bottomLine.quality, leftLine.quality, rightLine.quality)
    if (quality < 20) return { corners: defaultCorners(), detected: false }

    return { corners: normalized, detected: true }
  } catch (error) {
    console.warn('Document corner detection failed.', error)
    return { corners: defaultCorners(), detected: false }
  }
}
