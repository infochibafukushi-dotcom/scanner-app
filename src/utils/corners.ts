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
  const cutoff = weights[Math.floor(weights.length * 0.55)] ?? 0
  let working = candidates.filter((point) => point.weight >= cutoff)
  if (working.length < 12) working = candidates

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const line = weightedLineFit(working)
    if (!line) return null

    const residuals = working.map((point) => Math.abs(point.v - (line.a * point.t + line.b)))
    const typicalResidual = median(residuals)
    const limit = Math.max(3.5, typicalResidual * 2.55)
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

const cornerDistance = (a: [Point, Point, Point, Point], b: [Point, Point, Point, Point]) => {
  let sum = 0
  for (let i = 0; i < 4; i += 1) sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y)
  return sum / 4
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
    if (delta > 1.15) return 0
    score *= 1 - delta / 1.45
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
  const steps = 28
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
    const inX = clamp(Math.round(mx - (nx / length) * 10), 0, width - 1)
    const inY = clamp(Math.round(my - (ny / length) * 10), 0, height - 1)
    const outX = clamp(Math.round(mx + (nx / length) * 10), 0, width - 1)
    const outY = clamp(Math.round(my + (ny / length) * 10), 0, height - 1)
    inside += gray[inY * width + inX]
    outside += gray[outY * width + outX]
    insideCount += 1
    outsideCount += 1
  }

  if (!insideCount || !outsideCount) return 0
  return Math.min(1, Math.abs(inside / insideCount - outside / outsideCount) / 42)
}

/** Penalize quads that hug the image border (often the phone frame / table crop). */
const borderHugPenalty = (corners: Point[]) => {
  const margin = 0.04
  let near = 0
  for (const point of corners) {
    if (point.x <= margin || point.x >= 1 - margin || point.y <= margin || point.y >= 1 - margin) near += 1
  }
  if (near >= 4) return 0.72
  if (near === 3) return 0.88
  return 1
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
        point.x < -width * 0.08 ||
        point.x > width * 1.08 ||
        point.y < -height * 0.08 ||
        point.y > height * 1.08
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
  if (area < 0.1) return null

  const [tl, tr, br, bl] = normalized
  const top = Math.hypot(tr.x - tl.x, tr.y - tl.y)
  const bottom = Math.hypot(br.x - bl.x, br.y - bl.y)
  const left = Math.hypot(bl.x - tl.x, bl.y - tl.y)
  const right = Math.hypot(br.x - tr.x, br.y - tr.y)
  const minSide = Math.min(top, bottom, left, right)
  if (minSide < 0.16) return null

  const oppositePair =
    1 -
    Math.min(
      1,
      (Math.abs(top - bottom) / Math.max(top, bottom) + Math.abs(left - right) / Math.max(left, right)) / 2
    )
  const aspect = (top + bottom) / 2 / Math.max(1e-6, (left + right) / 2)
  const realisticAspect = aspect > 0.18 && aspect < 5.5 ? 1 : 0.15
  const angles = angleScore(normalized)
  if (angles <= 0) return null

  const edgeStrength =
    (sampleEdgeStrength(mag, width, height, cornersPx[0], cornersPx[1]) +
      sampleEdgeStrength(mag, width, height, cornersPx[1], cornersPx[2]) +
      sampleEdgeStrength(mag, width, height, cornersPx[2], cornersPx[3]) +
      sampleEdgeStrength(mag, width, height, cornersPx[3], cornersPx[0])) /
    4
  const edgeScore = Math.min(1, edgeStrength / 36)
  const contrast = insideOutsideContrast(gray, width, height, cornersPx)
  const areaScore = area < 0.16 ? (area / 0.16) * 0.5 : Math.min(1, area / 0.52)
  const qualityScore = Math.min(1, lineQuality / 32)
  const borderScore = borderHugPenalty(normalized)

  // Near-full-frame quads need strong edge+contrast evidence (avoid detecting the viewport).
  const fullFramePenalty = area > 0.86 && edgeScore < 0.42 ? 0.78 : 1

  const score =
    (areaScore * 0.2 +
      oppositePair * 0.13 +
      angles * 0.15 +
      edgeScore * 0.24 +
      contrast * 0.14 +
      qualityScore * 0.1 +
      realisticAspect * 0.04) *
    borderScore *
    fullFramePenalty

  const confidence = clamp(score, 0, 1)
  if (confidence < 0.32) return null

  const clamped = normalized.map((point) => ({
    x: clamp(point.x, 0.012, 0.988),
    y: clamp(point.y, 0.012, 0.988)
  })) as [Point, Point, Point, Point]

  return { corners: clamped, score, confidence }
}

const enhanceContrast = (gray: Uint8Array) => {
  let min = 255
  let max = 0
  for (let i = 0; i < gray.length; i += 6) {
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

/** Emphasize paper vs background for low-contrast desks. */
const stretchMidtones = (gray: Uint8Array) => {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1
  const total = gray.length
  let acc = 0
  let low = 0
  let high = 255
  const loTarget = total * 0.05
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v]
    if (acc >= loTarget) {
      low = v
      break
    }
  }
  acc = 0
  for (let v = 255; v >= 0; v -= 1) {
    acc += hist[v]
    if (acc >= total * 0.05) {
      high = v
      break
    }
  }
  const range = Math.max(24, high - low)
  const out = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = clamp(Math.round(((gray[i] - low) / range) * 255), 0, 255)
  }
  return out
}

const magnitudeFloor = (mag: Float32Array) => {
  let sum = 0
  let count = 0
  for (let i = 0; i < mag.length; i += 11) {
    sum += mag[i]
    count += 1
  }
  const mean = sum / Math.max(1, count)
  return mean * 1.15 + 6
}

const detectFromGray = (
  gray: Uint8Array,
  width: number,
  height: number,
  blurRadius = 2
): ScoredCorners | null => {
  const blurred = blurGrayscale(gray, width, height, blurRadius)
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

  const floor = magnitudeFloor(mag)
  const top: Candidate[] = []
  const bottom: Candidate[] = []
  const left: Candidate[] = []
  const right: Candidate[] = []
  const xStep = Math.max(2, Math.round(width / 180))
  const yStep = Math.max(2, Math.round(height / 180))
  const topStart = Math.round(height * 0.015)
  const topEnd = Math.round(height * 0.55)
  const bottomStart = Math.round(height * 0.45)
  const bottomEnd = Math.round(height * 0.985)
  const leftStart = Math.round(width * 0.015)
  const leftEnd = Math.round(width * 0.55)
  const rightStart = Math.round(width * 0.45)
  const rightEnd = Math.round(width * 0.985)

  for (let x = Math.round(width * 0.04); x < width * 0.96; x += xStep) {
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
    if (bestTop.score >= floor) top.push({ t: x, v: bestTop.y, weight: bestTop.score })
    if (bestBottom.score >= floor) bottom.push({ t: x, v: bestBottom.y, weight: bestBottom.score })
  }

  for (let y = Math.round(height * 0.04); y < height * 0.96; y += yStep) {
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
    if (bestLeft.score >= floor) left.push({ t: y, v: bestLeft.x, weight: bestLeft.score })
    if (bestRight.score >= floor) right.push({ t: y, v: bestRight.x, weight: bestRight.score })
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

const pickBestWithConsensus = (candidates: ScoredCorners[]): ScoredCorners | null => {
  if (!candidates.length) return null
  const ranked = [...candidates].sort((a, b) => b.score - a.score)
  const best = ranked[0]
  let agreements = 0
  for (let i = 1; i < ranked.length; i += 1) {
    if (cornerDistance(best.corners, ranked[i].corners) <= 0.045) agreements += 1
  }
  if (agreements > 0) {
    return {
      ...best,
      confidence: clamp(best.confidence + 0.06 * Math.min(3, agreements), 0, 1),
      score: best.score + 0.03 * agreements
    }
  }
  return best
}

/** Core multi-pass detector used by still and live paths. */
export const runCornerDetectionOnGray = (
  baseGray: Uint8Array,
  width: number,
  height: number
): CornerDetectionResult => {
  const enhanced = enhanceContrast(baseGray)
  const passes: { gray: Uint8Array; blur: number }[] = [
    { gray: baseGray, blur: 2 },
    { gray: enhanced, blur: 2 },
    { gray: liftShadows(baseGray), blur: 2 },
    { gray: localNormalize(baseGray, width, height), blur: 2 },
    { gray: stretchMidtones(baseGray), blur: 2 },
    { gray: enhanced, blur: 1 },
    { gray: blurGrayscale(enhanced, width, height, 1), blur: 3 }
  ]

  const scored: ScoredCorners[] = []
  for (const pass of passes) {
    const candidate = detectFromGray(pass.gray, width, height, pass.blur)
    if (candidate) scored.push(candidate)
  }

  const best = pickBestWithConsensus(scored)
  if (!best) return { corners: defaultCorners(), detected: false, confidence: 0 }
  return {
    corners: best.corners,
    detected: true,
    confidence: best.confidence
  }
}

const grayFromImageData = (imageData: ImageData) => {
  const { data, width, height } = imageData
  const baseGray = new Uint8Array(width * height)
  for (let pixel = 0, i = 0; i < data.length; i += 4, pixel += 1) {
    baseGray[pixel] = grayscale(data[i], data[i + 1], data[i + 2])
  }
  return { baseGray, width, height }
}

/** Detect from an already-drawn canvas/ImageData (avoids JPEG round-trip for live preview). */
export const detectDocumentCornersFromImageData = (imageData: ImageData): CornerDetectionResult => {
  try {
    const { baseGray, width, height } = grayFromImageData(imageData)
    return runCornerDetectionOnGray(baseGray, width, height)
  } catch (error) {
    console.warn('Document corner detection failed.', error)
    return { corners: defaultCorners(), detected: false, confidence: 0 }
  }
}

export const detectDocumentCorners = async (dataUrl: string): Promise<CornerDetectionResult> => {
  try {
    const image = await loadImage(dataUrl)
    const maxSide = 900
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
    const width = Math.max(96, Math.round(image.width * scale))
    const height = Math.max(96, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return { corners: defaultCorners(), detected: false, confidence: 0 }

    ctx.drawImage(image, 0, 0, width, height)
    return detectDocumentCornersFromImageData(ctx.getImageData(0, 0, width, height))
  } catch (error) {
    console.warn('Document corner detection failed.', error)
    return { corners: defaultCorners(), detected: false, confidence: 0 }
  }
}

/** Confidence threshold for allowing auto-shutter. */
export const AUTO_CAPTURE_CONFIDENCE = 0.6

/** How close successive live detections must stay to count as stable. */
export const AUTO_CAPTURE_STABLE_DELTA = 0.022

/** Consecutive confident+stable frames required before auto shutter. */
export const AUTO_CAPTURE_STABLE_FRAMES = 3
