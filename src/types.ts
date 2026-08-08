export type FilterMode = 'color' | 'gray' | 'bw'
export type CornerDetectionMode = 'auto' | 'fallback' | 'manual'
export type ProcessStatus = 'idle' | 'processing' | 'done' | 'error' | 'stale'

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
  ocrText?: string
  ocrStatus?: ProcessStatus
  ocrError?: string
  translationText?: string
  translationTarget?: string
  translationStatus?: ProcessStatus
  translationError?: string
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
