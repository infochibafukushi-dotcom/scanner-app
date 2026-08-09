import type { PaperRatio, PaperSize, Point } from '../types'

export type PaperDefinition = {
  id: PaperSize
  label: string
  widthMm?: number
  heightMm?: number
  ratio?: number
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Physical paper definitions (portrait mm where applicable). */
export const PAPER_DEFINITIONS: Record<Exclude<PaperSize, 'auto' | 'free'>, PaperDefinition> = {
  a3: { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420, ratio: 297 / 420 },
  a4: { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297, ratio: 210 / 297 },
  a5: { id: 'a5', label: 'A5', widthMm: 148, heightMm: 210, ratio: 148 / 210 },
  'business-card': { id: 'business-card', label: '名刺', widthMm: 91, heightMm: 55, ratio: 91 / 55 },
  letter: { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4, ratio: 215.9 / 279.4 }
}

/** Absolute aspect ratios (width / height). */
export const PAPER_ASPECT = {
  aSeriesPortrait: 1 / Math.SQRT2,
  aSeriesLandscape: Math.SQRT2,
  a4Portrait: 210 / 297,
  a4Landscape: 297 / 210,
  letterPortrait: 215.9 / 279.4,
  letterLandscape: 279.4 / 215.9,
  businessCardPortrait: 55 / 91,
  businessCardLandscape: 91 / 55
} as const

const PAPER_SIZE_SET = new Set<PaperSize>(['auto', 'a3', 'a4', 'a5', 'business-card', 'letter', 'free'])

const nearRatio = (value: number, target: number, tolerance = 0.1) =>
  Math.abs(value - target) / target <= tolerance

export const estimateCornerAspect = (corners: [Point, Point, Point, Point]) => {
  const [tl, tr, br, bl] = corners
  const width = (distance(tl, tr) + distance(bl, br)) / 2
  const height = (distance(tl, bl) + distance(tr, br)) / 2
  if (height <= 1e-6) return 1
  return width / height
}

export const estimateCornerArea = (corners: [Point, Point, Point, Point]) => {
  let area = 0
  for (let i = 0; i < corners.length; i += 1) {
    const next = corners[(i + 1) % corners.length]
    area += corners[i].x * next.y - next.x * corners[i].y
  }
  return Math.abs(area) / 2
}

/** Normalize legacy paperRatio / unknown values into PaperSize. */
export const normalizePaperSize = (value: unknown): PaperSize => {
  if (typeof value === 'string' && PAPER_SIZE_SET.has(value as PaperSize)) return value as PaperSize
  if (value === 'a4' || value === 'letter' || value === 'free' || value === 'auto') return value
  return 'auto'
}

export const migratePaperSize = (page: {
  paperSize?: unknown
  paperRatio?: PaperRatio | unknown
}): PaperSize => {
  if (page.paperSize != null) return normalizePaperSize(page.paperSize)
  if (page.paperRatio != null) return normalizePaperSize(page.paperRatio)
  return 'auto'
}

export type AutoPaperGuess = {
  kind: 'a-series' | 'letter' | 'business-card' | 'free'
  /** Concrete size used for warping when auto. A-series maps to a4 ratio. */
  warpSize: PaperSize
  label: string
}

/**
 * Guess paper family from corner geometry.
 * A3/A4/A5 cannot be distinguished by shape alone → "A判" (a4 ratio).
 * Business cards require a near 91×55 ratio and non-receipt-like proportions.
 */
const ratioDistance = (value: number, target: number) => Math.abs(value - target) / target

export const guessAutoPaper = (corners: [Point, Point, Point, Point]): AutoPaperGuess => {
  const estimated = estimateCornerAspect(corners)
  const area = estimateCornerArea(corners)
  const longShort = estimated >= 1 ? estimated : 1 / Math.max(1e-6, estimated)

  const cardLandscape = PAPER_ASPECT.businessCardLandscape
  const cardPortrait = PAPER_ASPECT.businessCardPortrait
  const looksLikeCard =
    (nearRatio(estimated, cardLandscape, 0.08) || nearRatio(estimated, cardPortrait, 0.08)) &&
    longShort < 2.05 &&
    area >= 0.08 &&
    area <= 0.55

  if (looksLikeCard) {
    return {
      kind: 'business-card',
      warpSize: 'business-card',
      label: '自動（名刺）'
    }
  }

  const aDist = Math.min(
    ratioDistance(estimated, PAPER_ASPECT.aSeriesPortrait),
    ratioDistance(estimated, PAPER_ASPECT.aSeriesLandscape)
  )
  const letterDist = Math.min(
    ratioDistance(estimated, PAPER_ASPECT.letterPortrait),
    ratioDistance(estimated, PAPER_ASPECT.letterLandscape)
  )

  // Prefer the closer of A-series vs Letter within a shared tolerance band.
  if (Math.min(aDist, letterDist) <= 0.1) {
    if (letterDist < aDist) {
      return { kind: 'letter', warpSize: 'letter', label: '自動（Letter）' }
    }
    return { kind: 'a-series', warpSize: 'a4', label: '自動（A判）' }
  }

  // Receipts / strips: keep free.
  if (longShort > 2.4 || area < 0.12) {
    return { kind: 'free', warpSize: 'free', label: '自動（自由）' }
  }

  return { kind: 'free', warpSize: 'free', label: '自動' }
}

const orientedAspect = (size: Exclude<PaperSize, 'auto' | 'free'>, landscape: boolean): number => {
  const def = PAPER_DEFINITIONS[size]
  const portrait = (def.widthMm ?? 1) / (def.heightMm ?? 1)
  return landscape ? 1 / portrait : portrait
}

/** Resolve the concrete width/height ratio for warping. null means keep free geometry. */
export const resolveTargetAspect = (
  paperSize: PaperSize | PaperRatio,
  corners: [Point, Point, Point, Point]
): number | null => {
  const size = normalizePaperSize(paperSize)
  const estimated = estimateCornerAspect(corners)
  const landscape = estimated >= 1

  if (size === 'free') return null

  if (size === 'auto') {
    const guess = guessAutoPaper(corners)
    if (guess.warpSize === 'free') return null
    return orientedAspect(guess.warpSize as Exclude<PaperSize, 'auto' | 'free'>, landscape)
  }

  if (size === 'a3' || size === 'a4' || size === 'a5') {
    return landscape ? PAPER_ASPECT.aSeriesLandscape : PAPER_ASPECT.aSeriesPortrait
  }

  if (size === 'letter') {
    return landscape ? PAPER_ASPECT.letterLandscape : PAPER_ASPECT.letterPortrait
  }

  if (size === 'business-card') {
    return landscape ? PAPER_ASPECT.businessCardLandscape : PAPER_ASPECT.businessCardPortrait
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

export type PdfPageFormat = {
  format: string | [number, number]
  orientation: 'portrait' | 'landscape'
}

/** jsPDF page size for an exported scan page. */
export const resolvePdfFormat = (
  paperSize: PaperSize,
  imageWidth: number,
  imageHeight: number
): PdfPageFormat => {
  const size = normalizePaperSize(paperSize)
  const landscape = imageWidth >= imageHeight
  const orientation = landscape ? 'landscape' : 'portrait'
  const mmToPt = (mm: number) => (mm * 72) / 25.4

  if (size === 'a3') return { format: 'a3', orientation }
  if (size === 'a4') return { format: 'a4', orientation }
  if (size === 'a5') return { format: 'a5', orientation }
  if (size === 'letter') return { format: 'letter', orientation }
  if (size === 'business-card') {
    const def = PAPER_DEFINITIONS['business-card']
    const width = mmToPt(landscape ? def.heightMm! : def.widthMm!)
    const height = mmToPt(landscape ? def.widthMm! : def.heightMm!)
    return { format: [width, height], orientation: 'portrait' }
  }

  // auto / free: follow the warped image aspect.
  const maxSidePt = 595.28
  const scale = maxSidePt / Math.max(imageWidth, imageHeight)
  return {
    format: [Math.max(72, imageWidth * scale), Math.max(72, imageHeight * scale)],
    orientation: 'portrait'
  }
}

export const paperSizeLabel = (paperSize: PaperSize, corners?: [Point, Point, Point, Point]) => {
  if (paperSize === 'auto' && corners) return guessAutoPaper(corners).label
  if (paperSize === 'auto') return '自動'
  if (paperSize === 'free') return '自由'
  return PAPER_DEFINITIONS[paperSize]?.label ?? paperSize
}

/** Short label for the crop toolbar paper button (no auto-guess suffix). */
export const paperButtonLabel = (paperSize: PaperSize) => {
  if (paperSize === 'auto') return '自動'
  if (paperSize === 'free') return '自由'
  return PAPER_DEFINITIONS[paperSize]?.label ?? paperSize
}

/** Compact auto-detection hint shown beside the paper button, e.g. "Letter". */
export const paperAutoDetectionHint = (corners: [Point, Point, Point, Point]) => {
  const guess = guessAutoPaper(corners)
  if (guess.kind === 'a-series') return 'A判'
  if (guess.kind === 'letter') return 'Letter'
  if (guess.kind === 'business-card') return '名刺'
  if (guess.label === '自動（自由）') return '自由'
  return null
}

export const PAPER_OPTIONS: { key: PaperSize; label: string }[] = [
  { key: 'auto', label: '自動' },
  { key: 'a3', label: 'A3' },
  { key: 'a4', label: 'A4' },
  { key: 'a5', label: 'A5' },
  { key: 'business-card', label: '名刺' },
  { key: 'letter', label: 'Letter' },
  { key: 'free', label: '自由' }
]
