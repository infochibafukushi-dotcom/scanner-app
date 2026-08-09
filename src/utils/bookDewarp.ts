/**
 * Geometric 3D book dewarp (cylindrical page model + text-line straighten).
 * Does not load OpenCV — keeps the light capture/onboarding path intact.
 */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export type BookDewarpOptions = {
  /** 0.15–0.55 typical. Higher = stronger curl unwrap. */
  strength?: number
}

export type BookDewarpStats = {
  spineX: number
  radius: number
  viewDistance: number
  thetaMax: number
  curlLeft: number
  curlRight: number
}

const grayAt = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4
  return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
}

/** Darkest vertical gutter in the central band. */
export const detectSpineX = (data: Uint8ClampedArray, width: number, height: number) => {
  const start = Math.floor(width * 0.28)
  const end = Math.ceil(width * 0.72)
  const stepY = Math.max(1, Math.floor(height / 96))
  let bestX = Math.floor(width / 2)
  let best = Number.POSITIVE_INFINITY
  for (let x = start; x <= end; x += 1) {
    let sum = 0
    let count = 0
    for (let y = 0; y < height; y += stepY) {
      sum += grayAt(data, width, x, y)
      count += 1
    }
    const score = sum / Math.max(1, count) + (Math.abs(x - width / 2) / width) * 5
    if (score < best) {
      best = score
      bestX = x
    }
  }
  return clamp(bestX, 1, width - 2)
}

/**
 * Estimate how much horizontal text baselines bow (page curl signature).
 * Positive ≈ smile curve (common on open books).
 */
export const estimateTextLineCurl = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  spineX: number
) => {
  const bands = 7
  const samples: { x: number; y: number }[] = []
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
      if (best > 12) samples.push({ x, y: bestY })
    }
  }

  const fitSide = (side: 'left' | 'right') => {
    const pts = samples.filter((p) => (side === 'left' ? p.x < spineX : p.x > spineX))
    if (pts.length < 8) return 0
    // Fit y ≈ a*(x-spine)^2 + c  (ignore linear term for stability)
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
    if (Math.abs(det) < 1e-6) return 0
    const a = (sX2Y * n - sX2 * sY) / det
    // Normalize to pixel bow at page edge
    const span = side === 'left' ? spineX : width - spineX
    return clamp(a * span * span, -height * 0.08, height * 0.08)
  }

  return { left: fitSide('left'), right: fitSide('right') }
}

/**
 * Estimate cylinder radius / viewing distance for a mild-to-strong open-book curl.
 * Uses page half-width and measured text-line bow as cues.
 */
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
  // θmax grows with user strength and observed bow.
  const thetaMax = clamp(0.42 + strength * 0.55 + bow * 1.8, 0.35, 1.05)
  // Image half-width ≈ R * sin(θmax) under orthographic; perspective uses similar scale.
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
 * Reverse a perspective-aware cylindrical projection into a flat page.
 *
 * Model (per side of spine):
 *  - page point at arc length u, angle θ = u / R
 *  - 3D: X = R sinθ, Z = R (1 - cosθ) toward camera
 *  - project with viewing distance V
 */
export const dewarpBookCanvas = (
  source: HTMLCanvasElement,
  options: BookDewarpOptions = {}
): { canvas: HTMLCanvasElement; stats: BookDewarpStats } => {
  const width = source.width
  const height = source.height
  const strength = clamp(options.strength ?? 0.36, 0.12, 0.6)
  const srcCtx = source.getContext('2d', { willReadFrequently: true })
  if (!srcCtx || width < 16 || height < 16) {
    return {
      canvas: source,
      stats: {
        spineX: width / 2,
        radius: width,
        viewDistance: width * 3,
        thetaMax: 0.5,
        curlLeft: 0,
        curlRight: 0
      }
    }
  }

  const src = srcCtx.getImageData(0, 0, width, height)
  const data = src.data
  const spineX = detectSpineX(data, width, height)
  const curls = estimateTextLineCurl(data, width, height, spineX)
  const { radius, viewDistance, thetaMax, leftSpan, rightSpan } = estimateCylinderParams(
    width,
    height,
    spineX,
    curls.left,
    curls.right,
    strength
  )

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const outCtx = out.getContext('2d')
  if (!outCtx) return { canvas: source, stats: { spineX, radius, viewDistance, thetaMax, curlLeft: curls.left, curlRight: curls.right } }

  const dst = outCtx.createImageData(width, height)
  const dData = dst.data
  const cy = (height - 1) / 2
  const z0 = viewDistance

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const onLeft = x <= spineX
      const span = onLeft ? leftSpan : rightSpan
      const curl = onLeft ? curls.left : curls.right
      // Flat-page normalized coordinate in [-1, 1] across the half-page.
      const t = span <= 1 ? 0 : (x - spineX) / span
      const theta = t * thetaMax
      const sinT = Math.sin(theta)
      const cosT = Math.cos(theta)
      // Projected horizontal position on the curved page.
      const z = z0 - radius * (1 - cosT)
      const persp = z0 / Math.max(z0 * 0.35, z)
      const srcX = spineX + span * (sinT / Math.sin(thetaMax)) 
      // Vertical: closer surface (larger |θ|) is magnified in the photo → sample inward.
      const srcYBase = cy + (y - cy) / persp
      // Undo smiling / frowning text baselines measured from the photo.
      const bow = curl * (t * t)
      const srcY = srcYBase - bow

      const dstIndex = (y * width + x) * 4
      sampleBilinear(data, width, height, srcX, srcY, dData, dstIndex)

      // Lift dark gutter near the spine after unwrap.
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
      radius,
      viewDistance,
      thetaMax,
      curlLeft: curls.left,
      curlRight: curls.right
    }
  }
}

export const applyBookDewarp = (source: HTMLCanvasElement, strength = 0.36) =>
  dewarpBookCanvas(source, { strength }).canvas
