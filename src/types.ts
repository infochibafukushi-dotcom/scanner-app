export type FilterMode = 'auto' | 'color' | 'gray' | 'bw'
export type PaperRatio = 'auto' | 'a4' | 'letter' | 'free'
export type CornerDetectionMode = 'auto' | 'fallback' | 'manual'
export type ProcessStatus = 'idle' | 'processing' | 'done' | 'error' | 'stale'
export type HighResTileId = 'tl' | 'tr' | 'br' | 'bl'
export type HighResCaptureStep = 'base' | HighResTileId
export type AppTab = 'capture' | 'pages' | 'edit' | 'save'
export type EditTool = 'crop' | 'rotate' | 'filter' | 'enhance' | 'ocr'

export type Point = {
  x: number
  y: number
}

export type ScanPage = {
  id: string
  name: string
  dataUrl: string
  corners: [Point, Point, Point, Point]
  cornerDetection: CornerDetectionMode
  rotation: number
  filter: FilterMode
  clean: boolean
  paperRatio: PaperRatio
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
