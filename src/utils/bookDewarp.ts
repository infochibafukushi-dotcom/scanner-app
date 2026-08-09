/**
 * Book flatten modes:
 * - simple: lightweight horizontal expansion (legacy)
 * - precise: cylindrical 3D + text-line straighten (no OpenCV)
 * Precise auto-falls back to simple when spine/curl confidence is low.
 */

import type { BookFlattenMode } from '../types'
import { detectSpineFromRgba } from './spineDetect'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export type { BookFlattenMode }

export type BookDewarpOptions = {
  /** 0.15–0.55 typical. Higher = stronger curl unwrap. */
  strength?: number
  /** Skip confidence gate (tests only). */
  forcePrecise?: boolean
}

export type BookDewarpStats = {
  spineX: number
  spineConfidence: number
  curlConfidence: number
  usedMode: 'simple' | 'precise'
  radius: number
  viewDistance: number
  thetaMax: number
  curlLeft: number
  curlRight: number
}

const SPINE_CONFIDENCE_MIN = 0.48
const CURL_CONFIDENCE_MIN = 0.32

const grayAt = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4
  return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
}

/** Migrate legacy boolean / unknown values. Former `true` → precise. */
export const normalizeBookFlatten = (value: unknown): BookFlattenMode => {
  if (value === 'simple' || value === 'precise' || value === 'off') return value
  if (value === true || value === 1 || value === '1' || value === 'true') return 'precise'
  return 'off'
}

/** Darkest vertical gutter + confidence that it is a real spine. */
export const detectSpineWithConfidence = (data: Uint8ClampedArray, width: number, height: number) =>
  detectSpineFromRgba(data, width, height)

/** @deprecated Prefer detectSpineWithConfidence */
export const detectSpineX = (data: Uint8ClampedArray, width: number, height: number) =>
  detectSpineWithConfidence(data, width, height).spineX

/**
 * Estimate text baseline bow + confidence of that estimate.
 */
export const estimateTextLineCurl = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  spineX: number
) => {
  const bands = 7
  const samples: { x: number; y: number; edge: number }[] = []
  for (let b = 1; b < bands; b += 1) {
    const y0 = Math.floor((height * b) / bands)
    const y1 = Math.min(height - 1, y0 + Math.max(4, Math.floor(height / 40)))
    for (let x = Math.floor(width * 0.08); x < width * 0.92; x += Math.max(2, Math.floor(width / 80))) {
      let bestY = y0
      let best = -1
      for (let y = y0; y <= y1; y += 1) {
        const g0 = grayAt(data, width, x, Math.max(0, y - 1))
        const g1 = grayAt(data, width, x, y)
        const edge = Math.abs(g1 - g0)
        if (edge > best) {
          best = edge
          bestY = y
        }
      }
      if (best > 12) samples.push({ x, y: bestY, edge: best })
    }
  }

  const fitSide = (side: 'left' | 'right') => {
    const pts = samples.filter((p) => (side === 'left' ? p.x < spineX : p.x > spineX))
    if (pts.length < 8) return { curl: 0, residual: 1, count: pts.length }
    let sX4 = 0
    let sX2 = 0
    let sX2Y = 0
    let sY = 0
    let n = 0
    for (const p of pts) {
      const dx = p.x - spineX
      const x2 = dx * dx
      sX4 += x2 * x2
      sX2 += x2
      sX2Y += x2 * p.y
      sY += p.y
      n += 1
    }
    const det = sX4 * n - sX2 * sX2
    if (Math.abs(det) < 1e-6) return { curl: 0, residual: 1, count: n }
    const a = (sX2Y * n - sX2 * sY) / det
    const c = (sY * sX4 - sX2 * sX2Y) / det
    let err = 0
    for (const p of pts) {
      const dx = p.x - spineX
      const pred = a * dx * dx + c
      err += (p.y - pred) ** 2
    }
    const rmse = Math.sqrt(err / n) / Math.max(1, height)
    const span = side === 'left' ? spineX : width - spineX
    const curl = clamp(a * span * span, -height * 0.08, height * 0.08)
    return { curl, residual: rmse, count: n }
  }

  const left = fitSide('left')
  const right = fitSide('right')
  const sampleScore = clamp(samples.length / 80, 0, 1)
  const residualScore = clamp(1 - (left.residual + right.residual) * 2.5, 0, 1)
  const bow = Math.max(Math.abs(left.curl), Math.abs(right.curl)) / Math.max(1, height)
  // Flat pages: low bow → low confidence (avoid 3D). Curved pages with stable fit → high.
  const bowScore = clamp(bow / 0.035, 0, 1)
  const confidence = clamp(sampleScore * 0.35 + residualScore * 0.35 + bowScore * 0.3, 0, 1)

  return {
    left: left.curl,
    right: right.curl,
    confidence,
    sampleCount: samples.length
  }
}

export const estimateCylinderParams = (
  width: number,
  height: number,
  spineX: number,
  curlLeft: number,
  curlRight: number,
  strength: number
) => {
  const leftSpan = Math.max(8, spineX)
  const rightSpan = Math.max(8, width - 1 - spineX)
  const maxSpan = Math.max(leftSpan, rightSpan)
  const bow = Math.max(Math.abs(curlLeft), Math.abs(curlRight)) / Math.max(1, height)
  const thetaMax = clamp(0.42 + strength * 0.55 + bow * 1.8, 0.35, 1.05)
  const radius = maxSpan / Math.max(0.2, Math.sin(thetaMax))
  const viewDistance = radius * clamp(2.2 + (1 - strength) * 1.4, 2.0, 4.2)
  return { radius, viewDistance, thetaMax, leftSpan, rightSpan }
}

const sampleBilinear = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  dstIndex: number
) => {
  const xc = clamp(x, 0, width - 1.001)
  const yc = clamp(y, 0, height - 1.001)
  const x0 = Math.floor(xc)
  const y0 = Math.floor(yc)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = xc - x0
  const ty = yc - y0
  const i00 = (y0 * width + x0) * 4
  const i10 = (y0 * width + x1) * 4
  const i01 = (y1 * width + x0) * 4
  const i11 = (y1 * width + x1) * 4
  for (let c = 0; c < 4; c += 1) {
    const top = data[i00 + c] * (1 - tx) + data[i10 + c] * tx
    const bottom = data[i01 + c] * (1 - tx) + data[i11 + c] * tx
    out[dstIndex + c] = Math.round(top * (1 - ty) + bottom * ty)
  }
}

/**
 * Legacy lightweight horizontal expansion around the spine.
 * Safe fallback for flat documents / low-confidence precise mode.
 */
export const applySimpleBookFlatten = (source: HTMLCanvasElement, strength = 0.26): HTMLCanvasElement => {
  const width = source.width
  const height = source.height
  if (width < 8 || height < 8 || strength <= 0) return source

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  const srcCtx = source.getContext('2d', { willReadFrequently: true })
  if (!ctx || !srcCtx) return source

  const src = srcCtx.getImageData(0, 0, width, height)
  const dst = ctx.createImageData(width, height)
  const sData = src.data
  const dData = dst.data
  const { spineX } = detectSpineWithConfidence(sData, width, height)
  const leftSpan = Math.max(1, spineX)
  const rightSpan = Math.max(1, width - 1 - spineX)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x <= spineX ? (x - spineX) / leftSpan : (x - spineX) / rightSpan
      const denom = 1 - strength * (1 - nx * nx)
      const srcNx = nx * (denom <= 1e-4 ? 1 : 1 / denom)
      const srcX = clamp(spineX + srcNx * (srcNx < 0 ? leftSpan : rightSpan), 0, width - 1)
      const x0 = Math.floor(srcX)
      const x1 = Math.min(width - 1, x0 + 1)
      const t = srcX - x0
      const dstIndex = (y * width + x) * 4
      const i0 = (y * width + x0) * 4
      const i1 = (y * width + x1) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        dData[dstIndex + channel] = Math.round(sData[i0 + channel] * (1 - t) + sData[i1 + channel] * t)
      }

      const dist = Math.abs(x - spineX) / Math.max(leftSpan, rightSpan)
      if (dist < 0.18) {
        const lift = ((0.18 - dist) / 0.18) * 18
        dData[dstIndex] = Math.round(clamp(dData[dstIndex] + lift, 0, 255))
        dData[dstIndex + 1] = Math.round(clamp(dData[dstIndex + 1] + lift, 0, 255))
        dData[dstIndex + 2] = Math.round(clamp(dData[dstIndex + 2] + lift, 0, 255))
      }
    }
  }

  ctx.putImageData(dst, 0, 0)
  return out
}

/**
 * Cylindrical 3D + text-line straighten (precise path).
 */
export const dewarpBookCanvas = (
  source: HTMLCanvasElement,
  options: BookDewarpOptions = {}
): { canvas: HTMLCanvasElement; stats: BookDewarpStats } => {
  const width = source.width
  const height = source.height
  const strength = clamp(options.strength ?? 0.36, 0.12, 0.6)
  const emptyStats = (usedMode: 'simple' | 'precise'): BookDewarpStats => ({
    spineX: width / 2,
    spineConfidence: 0,
    curlConfidence: 0,
    usedMode,
    radius: width,
    viewDistance: width * 3,
    thetaMax: 0.5,
    curlLeft: 0,
    curlRight: 0
  })

  const srcCtx = source.getContext('2d', { willReadFrequently: true })
  if (!srcCtx || width < 16 || height < 16) {
    return { canvas: source, stats: emptyStats('simple') }
  }

  const src = srcCtx.getImageData(0, 0, width, height)
  const data = src.data
  const spine = detectSpineWithConfidence(data, width, height)
  const curls = estimateTextLineCurl(data, width, height, spine.spineX)

  const canPrecise =
    options.forcePrecise ||
    (spine.confidence >= SPINE_CONFIDENCE_MIN && curls.confidence >= CURL_CONFIDENCE_MIN)

  if (!canPrecise) {
    return {
      canvas: applySimpleBookFlatten(source, 0.26),
      stats: {
        ...emptyStats('simple'),
        spineX: spine.spineX,
        spineConfidence: spine.confidence,
        curlConfidence: curls.confidence,
        curlLeft: curls.left,
        curlRight: curls.right
      }
    }
  }

  const { radius, viewDistance, thetaMax, leftSpan, rightSpan } = estimateCylinderParams(
    width,
    height,
    spine.spineX,
    curls.left,
    curls.right,
    strength
  )

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const outCtx = out.getContext('2d')
  if (!outCtx) {
    return {
      canvas: applySimpleBookFlatten(source, 0.26),
      stats: {
        ...emptyStats('simple'),
        spineX: spine.spineX,
        spineConfidence: spine.confidence,
        curlConfidence: curls.confidence
      }
    }
  }

  const dst = outCtx.createImageData(width, height)
  const dData = dst.data
  const cy = (height - 1) / 2
  const z0 = viewDistance
  const spineX = spine.spineX

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const onLeft = x <= spineX
      const span = onLeft ? leftSpan : rightSpan
      const curl = onLeft ? curls.left : curls.right
      const t = span <= 1 ? 0 : (x - spineX) / span
      const theta = t * thetaMax
      const sinT = Math.sin(theta)
      const cosT = Math.cos(theta)
      const z = z0 - radius * (1 - cosT)
      const persp = z0 / Math.max(z0 * 0.35, z)
      const srcX = spineX + span * (sinT / Math.sin(thetaMax))
      const srcYBase = cy + (y - cy) / persp
      const bow = curl * (t * t)
      const srcY = srcYBase - bow

      const dstIndex = (y * width + x) * 4
      sampleBilinear(data, width, height, srcX, srcY, dData, dstIndex)

      const dist = Math.abs(t)
      if (dist < 0.2) {
        const lift = ((0.2 - dist) / 0.2) * (14 + strength * 16)
        dData[dstIndex] = Math.round(clamp(dData[dstIndex] + lift, 0, 255))
        dData[dstIndex + 1] = Math.round(clamp(dData[dstIndex + 1] + lift, 0, 255))
        dData[dstIndex + 2] = Math.round(clamp(dData[dstIndex + 2] + lift, 0, 255))
      }
    }
  }

  outCtx.putImageData(dst, 0, 0)
  return {
    canvas: out,
    stats: {
      spineX,
      spineConfidence: spine.confidence,
      curlConfidence: curls.confidence,
      usedMode: 'precise',
      radius,
      viewDistance,
      thetaMax,
      curlLeft: curls.left,
      curlRight: curls.right
    }
  }
}

/** Precise cylindrical dewarp (may auto-fallback to simple). */
export const applyBookDewarp = (source: HTMLCanvasElement, strength = 0.36) =>
  dewarpBookCanvas(source, { strength }).canvas

/** Apply flatten according to UI mode. `off` returns the source unchanged. */
export const applyBookFlattenMode = (
  source: HTMLCanvasElement,
  mode: BookFlattenMode
): HTMLCanvasElement => {
  const normalized = normalizeBookFlatten(mode)
  if (normalized === 'off') return source
  if (normalized === 'simple') return applySimpleBookFlatten(source, 0.26)
  return applyBookDewarp(source, 0.4)
}
