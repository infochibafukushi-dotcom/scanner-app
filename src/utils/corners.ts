import type { CornerDetectionResult, Point } from '../types'
import { defaultCorners, loadImage } from './image'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const grayscale = (r: number, g: number, b: number) => Math.round(r * 0.299 + g * 0.587 + b * 0.114)

type Candidate = { t: number; v: number; weight: number }
type Line = { a: number; b: number; quality: number }
type ScoredCorners = {
  corners: [Point, Point, Point, Point]
  score: number
  confidence: number
}

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

const blurGrayscale = (input: Uint8Array, width: number, height: number, radius = 2) => {
  const horizontal = new Float32Array(input.length)
  const output = new Uint8Array(input.length)

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

const isConvexQuad = (corners: Point[]) => {
  let sign = 0
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    const c = corners[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-8) continue
    const next = cross > 0 ? 1 : -1
    if (!sign) sign = next
    else if (sign !== next) return false
  }
  return true
}

const angleScore = (corners: Point[]) => {
  let score = 1
  for (let i = 0; i < 4; i += 1) {
    const prev = corners[(i + 3) % 4]
    const curr = corners[i]
    const next = corners[(i + 1) % 4]
    const ax = prev.x - curr.x
    const ay = prev.y - curr.y
    const bx = next.x - curr.x
    const by = next.y - curr.y
    const denom = Math.hypot(ax, ay) * Math.hypot(bx, by)
    if (denom < 1e-6) return 0
    const cos = clamp((ax * bx + ay * by) / denom, -1, 1)
    const angle = Math.acos(cos)
    const delta = Math.abs(angle - Math.PI / 2)
    if (delta > 1.1) return 0
    score *= 1 - delta / 1.4
  }
  return score
}

const sampleEdgeStrength = (
  mag: Float32Array,
  width: number,
  height: number,
  a: Point,
  b: Point
) => {
  let sum = 0
  const steps = 24
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const x = clamp(Math.round(a.x + (b.x - a.x) * t), 1, width - 2)
    const y = clamp(Math.round(a.y + (b.y - a.y) * t), 1, height - 2)
    sum += mag[y * width + x]
  }
  return sum / (steps + 1)
}

const insideOutsideContrast = (
  gray: Uint8Array,
  width: number,
  height: number,
  corners: Point[]
) => {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / 4
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / 4
  let inside = 0
  let outside = 0
  let insideCount = 0
  let outsideCount = 0

  for (let i = 0; i < 4; i += 1) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const nx = mx - cx
    const ny = my - cy
    const length = Math.hypot(nx, ny) || 1
    const inX = clamp(Math.round(mx - (nx / length) * 8), 0, width - 1)
    const inY = clamp(Math.round(my - (ny / length) * 8), 0, height - 1)
    const outX = clamp(Math.round(mx + (nx / length) * 8), 0, width - 1)
    const outY = clamp(Math.round(my + (ny / length) * 8), 0, height - 1)
    inside += gray[inY * width + inX]
    outside += gray[outY * width + outX]
    insideCount += 1
    outsideCount += 1
  }

  if (!insideCount || !outsideCount) return 0
  return Math.min(1, Math.abs(inside / insideCount - outside / outsideCount) / 48)
}

const scoreCandidate = (
  cornersPx: Point[],
  width: number,
  height: number,
  gray: Uint8Array,
  mag: Float32Array,
  lineQuality: number
): ScoredCorners | null => {
  if (cornersPx.length !== 4) return null
  if (
    cornersPx.some(
      (point) =>
        point.x < -width * 0.06 ||
        point.x > width * 1.06 ||
        point.y < -height * 0.06 ||
        point.y > height * 1.06
    )
  ) {
    return null
  }

  const normalized = cornersPx.map((point) => ({
    x: point.x / width,
    y: point.y / height
  })) as [Point, Point, Point, Point]

  if (!isConvexQuad(normalized)) return null

  const area = polygonArea(normalized)
  if (area < 0.12) return null

  const [tl, tr, br, bl] = normalized
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y)
  const left = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  const right = Math.hypot(br.x - tr.x, br.y - tr.y)
  const minSide = Math.min(top, bottom, left, right)
  if (minSide < 0.18) return null

  const oppositePair =
    1 -
    Math.min(1, (Math.abs(top - bottom) / Math.max(top, bottom) + Math.abs(left - right) / Math.max(left, right)) / 2)
  const aspect = ((top + bottom) / 2) / Math.max(1e-6, (left + right) / 2)
  const realisticAspect = aspect > 0.2 && aspect < 5 ? 1 : 0.2
  const angles = angleScore(normalized)
  if (angles <= 0) return null

  const edgeStrength =
    (sampleEdgeStrength(mag, width, height, cornersPx[0], cornersPx[1]) +
      sampleEdgeStrength(mag, width, height, cornersPx[1], cornersPx[2]) +
      sampleEdgeStrength(mag, width, height, cornersPx[2], cornersPx[3]) +
      sampleEdgeStrength(mag, width, height, cornersPx[3], cornersPx[0])) /
    4
  const edgeScore = Math.min(1, edgeStrength / 40)
  const contrast = insideOutsideContrast(gray, width, height, cornersPx)
  const areaScore = area < 0.18 ? area / 0.18 * 0.55 : Math.min(1, area / 0.55)
  const qualityScore = Math.min(1, lineQuality / 35)

  const score =
    areaScore * 0.22 +
    oppositePair * 0.14 +
    angles * 0.16 +
    edgeScore * 0.22 +
    contrast * 0.12 +
    qualityScore * 0.1 +
    realisticAspect * 0.04

  const confidence = clamp(score, 0, 1)
  if (confidence < 0.34) return null

  const clamped = normalized.map((point) => ({
    x: clamp(point.x, 0.015, 0.985),
    y: clamp(point.y, 0.015, 0.985)
  })) as [Point, Point, Point, Point]

  return { corners: clamped, score, confidence }
}

const enhanceContrast = (gray: Uint8Array) => {
  let min = 255
  let max = 0
  for (let i = 0; i < gray.length; i += 8) {
    const value = gray[i]
    if (value < min) min = value
    if (value > max) max = value
  }
  const range = Math.max(1, max - min)
  const out = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = clamp(Math.round(((gray[i] - min) / range) * 255), 0, 255)
  }
  return out
}

const liftShadows = (gray: Uint8Array) => {
  const out = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i += 1) {
    const value = gray[i] / 255
    out[i] = Math.round(Math.pow(value, 0.72) * 255)
  }
  return out
}

const localNormalize = (gray: Uint8Array, width: number, height: number) => {
  const blurred = blurGrayscale(gray, width, height, 9)
  const out = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = clamp(Math.round((gray[i] - blurred[i]) * 1.35 + 128), 0, 255)
  }
  return out
}

const detectFromGray = (gray: Uint8Array, width: number, height: number): ScoredCorners | null => {
  const blurred = blurGrayscale(gray, width, height, 2)
  const gx = new Float32Array(width * height)
  const gy = new Float32Array(width * height)
  const mag = new Float32Array(width * height)

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
      gx[index] = Math.abs(tr + 2 * mr + br - (tl + 2 * ml + bl))
      gy[index] = Math.abs(bl + 2 * bc + br - (tl + 2 * tc + tr))
      mag[index] = gx[index] + gy[index]
    }
  }

  const top: Candidate[] = []
  const bottom: Candidate[] = []
  const left: Candidate[] = []
  const right: Candidate[] = []
  const xStep = Math.max(2, Math.round(width / 170))
  const yStep = Math.max(2, Math.round(height / 170))
  const topStart = Math.round(height * 0.02)
  const topEnd = Math.round(height * 0.5)
  const bottomStart = Math.round(height * 0.5)
  const bottomEnd = Math.round(height * 0.98)
  const leftStart = Math.round(width * 0.02)
  const leftEnd = Math.round(width * 0.5)
  const rightStart = Math.round(width * 0.5)
  const rightEnd = Math.round(width * 0.98)

  for (let x = Math.round(width * 0.05); x < width * 0.95; x += xStep) {
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

  for (let y = Math.round(height * 0.05); y < height * 0.95; y += yStep) {
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
  if (!topLine || !bottomLine || !leftLine || !rightLine) return null

  const rawCorners = [
    intersect(topLine, leftLine),
    intersect(topLine, rightLine),
    intersect(bottomLine, rightLine),
    intersect(bottomLine, leftLine)
  ]
  if (rawCorners.some((point) => !point)) return null

  const lineQuality = Math.min(topLine.quality, bottomLine.quality, leftLine.quality, rightLine.quality)
  return scoreCandidate(rawCorners as Point[], width, height, gray, mag, lineQuality)
}

export const detectDocumentCorners = async (dataUrl: string): Promise<CornerDetectionResult> => {
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
    if (!ctx) return { corners: defaultCorners(), detected: false, confidence: 0 }

    ctx.drawImage(image, 0, 0, width, height)
    const source = ctx.getImageData(0, 0, width, height).data
    const baseGray = new Uint8Array(width * height)
    for (let pixel = 0, i = 0; i < source.length; i += 4, pixel += 1) {
      baseGray[pixel] = grayscale(source[i], source[i + 1], source[i + 2])
    }

    const passes = [
      baseGray,
      enhanceContrast(baseGray),
      liftShadows(baseGray),
      localNormalize(baseGray, width, height)
    ]

    let best: ScoredCorners | null = null
    for (const gray of passes) {
      const candidate = detectFromGray(gray, width, height)
      if (!candidate) continue
      if (!best || candidate.score > best.score) best = candidate
    }

    if (!best) return { corners: defaultCorners(), detected: false, confidence: 0 }
    return {
      corners: best.corners,
      detected: true,
      confidence: best.confidence
    }
  } catch (error) {
    console.warn('Document corner detection failed.', error)
    return { corners: defaultCorners(), detected: false, confidence: 0 }
  }
}

/** Confidence threshold for allowing auto-shutter. */
export const AUTO_CAPTURE_CONFIDENCE = 0.62
