import type { CornerDetectionResult, ScanPage } from '../types'
import { detectDocumentCorners } from './corners'
import type { BookPageOrder } from './bookPageOrderStorage'
import { defaultCorners } from './image'
import { splitDataUrlVertically, SPINE_SPLIT_AUTO_CONFIDENCE } from './pageSplit'

export type BookCaptureResult =
  | {
      kind: 'split'
      pages: ScanPage[]
      spineConfidence: number
    }
  | {
      kind: 'spread'
      pages: ScanPage[]
      spineConfidence: number
      message: string
    }

const makeBookHalfPage = (
  dataUrl: string,
  name: string,
  detection: CornerDetectionResult
): ScanPage => ({
  id: crypto.randomUUID(),
  name,
  dataUrl,
  corners: detection.detected ? detection.corners : defaultCorners(),
  cornerDetection: detection.detected ? 'auto' : 'fallback',
  cornerConfidence: detection.confidence,
  rotation: 0,
  filter: 'color',
  clean: false,
  bookFlatten: 'precise',
  paperSize: 'free',
  ocrStatus: 'idle',
  translationStatus: 'idle'
})

const makeSpreadPage = (dataUrl: string, name: string): ScanPage => ({
  id: crypto.randomUUID(),
  name,
  dataUrl,
  corners: defaultCorners(),
  cornerDetection: 'fallback',
  cornerConfidence: 0,
  rotation: 0,
  filter: 'color',
  clean: false,
  bookFlatten: 'off',
  paperSize: 'free',
  ocrStatus: 'idle',
  translationStatus: 'idle'
})

/** Build one or two ScanPages from a facing-page still. Never drops the raw capture. */
export const createPagesFromBookCapture = async (
  dataUrl: string,
  baseName: string,
  pageOrder: BookPageOrder
): Promise<BookCaptureResult> => {
  const split = await splitDataUrlVertically(dataUrl)

  if (split.confidence < SPINE_SPLIT_AUTO_CONFIDENCE) {
    return {
      kind: 'spread',
      spineConfidence: split.confidence,
      message: '見開きを検出できませんでした。左右分割を確認してください',
      pages: [makeSpreadPage(dataUrl, baseName)]
    }
  }

  const [leftDetection, rightDetection] = await Promise.all([
    detectDocumentCorners(split.leftDataUrl),
    detectDocumentCorners(split.rightDataUrl)
  ])

  const left = makeBookHalfPage(split.leftDataUrl, `${baseName}-左`, leftDetection)
  const right = makeBookHalfPage(split.rightDataUrl, `${baseName}-右`, rightDetection)
  const pages = pageOrder === 'rtl' ? [right, left] : [left, right]

  return {
    kind: 'split',
    spineConfidence: split.confidence,
    pages
  }
}

export { SPINE_SPLIT_AUTO_CONFIDENCE }
