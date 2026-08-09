import type { PaperRatio, Point } from '../types'

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Absolute aspect ratios (width / height). */
export const PAPER_ASPECT = {
  a4Portrait: 210 / 297,
  a4Landscape: 297 / 210,
  letterPortrait: 8.5 / 11,
  letterLandscape: 11 / 8.5
} as const

const nearRatio = (value: number, target: number, tolerance = 0.1) =>
  Math.abs(value - target) / target <= tolerance

export const estimateCornerAspect = (corners: [Point, Point, Point, Point]) => {
  const [tl, tr, br, bl] = corners
  const width = (distance(tl, tr) + distance(bl, br)) / 2
  const height = (distance(tl, bl) + distance(tr, br)) / 2
  if (height <= 1e-6) return 1
  return width / height
}

/** Resolve the concrete width/height ratio for warping. null means keep free geometry. */
export const resolveTargetAspect = (
  paperRatio: PaperRatio,
  corners: [Point, Point, Point, Point]
): number | null => {
  const estimated = estimateCornerAspect(corners)
  const landscape = estimated >= 1

  if (paperRatio === 'free') return null

  if (paperRatio === 'a4') {
    return landscape ? PAPER_ASPECT.a4Landscape : PAPER_ASPECT.a4Portrait
  }

  if (paperRatio === 'letter') {
    return landscape ? PAPER_ASPECT.letterLandscape : PAPER_ASPECT.letterPortrait
  }

  // auto: snap only when close to A-series or Letter; otherwise keep free.
  if (nearRatio(estimated, PAPER_ASPECT.a4Portrait) || nearRatio(estimated, PAPER_ASPECT.a4Landscape)) {
    return landscape ? PAPER_ASPECT.a4Landscape : PAPER_ASPECT.a4Portrait
  }
  if (nearRatio(estimated, PAPER_ASPECT.letterPortrait) || nearRatio(estimated, PAPER_ASPECT.letterLandscape)) {
    return landscape ? PAPER_ASPECT.letterLandscape : PAPER_ASPECT.letterPortrait
  }
  return null
}

export const applyAspectToSize = (width: number, height: number, targetAspect: number | null) => {
  if (!targetAspect || targetAspect <= 0) return { width, height }
  const current = width / Math.max(1e-6, height)
  if (current > targetAspect) {
    return { width, height: width / targetAspect }
  }
  return { width: height * targetAspect, height }
}

export const PAPER_OPTIONS: { key: PaperRatio; label: string }[] = [
  { key: 'auto', label: '自動' },
  { key: 'a4', label: 'A4' },
  { key: 'letter', label: 'Letter' },
  { key: 'free', label: '自由' }
]
