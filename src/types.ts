export type FilterMode = 'auto' | 'color' | 'gray' | 'bw'

/** UI exposes auto/color/gray only; legacy `bw` maps to gray. */
export const normalizeFilter = (filter: unknown): FilterMode => {
  if (filter === 'bw') return 'gray'
  if (filter === 'auto' || filter === 'color' || filter === 'gray') return filter
  return 'color'
}

export const UI_FILTER_OPTIONS: { key: Exclude<FilterMode, 'bw'>; label: string; hint: string }[] = [
  { key: 'auto', label: '自動', hint: '書類を読みやすく自動補正' },
  { key: 'color', label: 'カラー', hint: '元の色を自然に残す' },
  { key: 'gray', label: 'グレー', hint: '色を消して文字を見やすく' }
]
/** @deprecated Use PaperSize. Kept for migration of older persisted data. */
export type PaperRatio = 'auto' | 'a4' | 'letter' | 'free'
export type PaperSize =
  | 'auto'
  | 'a3'
  | 'a4'
  | 'a5'
  | 'business-card'
  | 'letter'
  | 'free'
export type CornerDetectionMode = 'auto' | 'fallback' | 'manual'
export type ProcessStatus = 'idle' | 'processing' | 'done' | 'error' | 'stale'
export type HighResTileId = 'tl' | 'tr' | 'br' | 'bl'
export type HighResCaptureStep = 'base' | HighResTileId
/** @deprecated Replaced by ViewMode for the linear camera → gallery → edit flow. */
export type AppTab = 'capture' | 'pages' | 'edit' | 'save'
export type ViewMode = 'camera' | 'gallery' | 'edit'
export type EditTool = 'crop' | 'rotate' | 'filter' | 'enhance' | 'ocr'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'unavailable' | 'error'

export type Point = {
  x: number
  y: number
}

export type CornerDetectionResult = {
  corners: [Point, Point, Point, Point]
  detected: boolean
  confidence: number
}

export type ScanPage = {
  id: string
  name: string
  dataUrl: string
  corners: [Point, Point, Point, Point]
  cornerDetection: CornerDetectionMode
  cornerConfidence?: number
  rotation: number
  filter: FilterMode
  clean: boolean
  paperSize: PaperSize
  /** @deprecated Migrated into paperSize on load. */
  paperRatio?: PaperRatio
  ocrText?: string
  ocrStatus?: ProcessStatus
  ocrError?: string
  translationText?: string
  translationTarget?: string
  translationStatus?: ProcessStatus
  translationError?: string
}

export type HighResShot = {
  id: HighResCaptureStep
  dataUrl: string
  thumbnailUrl: string
}

export type HomographyQuality = {
  keypointCount: number
  goodMatchCount: number
  inlierCount: number
  inlierRatio: number
  scale: number
  rotationDeg: number
  projectedAreaRatio: number
  ok: boolean
  reason?: string
}

export type TileAlignResult = {
  tileId: HighResTileId
  quality: HomographyQuality
  /** 3x3 row-major homography mapping tile pixels → reference pixels */
  homography?: number[]
}

export type HighResStitchProgress = {
  stage: string
  current: number
  total: number
}

export type HighResStitchResult =
  | {
      ok: true
      dataUrl: string
      width: number
      height: number
      warnings: string[]
      qualityNotes: string[]
    }
  | {
      ok: false
      message: string
      failedTiles: HighResTileId[]
      retakeHint?: string
    }

/** Mark OCR/translation as needing refresh when the corrected image changes. */
export const invalidateOcrForImageChange = (page: ScanPage): ScanPage => {
  const hadOcr = Boolean(page.ocrText) || page.ocrStatus === 'done' || page.ocrStatus === 'stale' || page.ocrStatus === 'error'
  const hadTranslation =
    Boolean(page.translationText) ||
    page.translationStatus === 'done' ||
    page.translationStatus === 'stale' ||
    page.translationStatus === 'error'

  return {
    ...page,
    ocrStatus: hadOcr ? 'stale' : page.ocrStatus === 'processing' ? 'stale' : (page.ocrStatus ?? 'idle'),
    ocrError: undefined,
    translationStatus: hadTranslation
      ? 'stale'
      : page.translationStatus === 'processing'
        ? 'stale'
        : (page.translationStatus ?? 'idle'),
    translationError: undefined
  }
}

export const HIGH_RES_TILE_ORDER: HighResTileId[] = ['tl', 'tr', 'br', 'bl']

export const HIGH_RES_LABELS: Record<HighResCaptureStep, string> = {
  base: '基準',
  tl: '左上',
  tr: '右上',
  br: '右下',
  bl: '左下'
}
