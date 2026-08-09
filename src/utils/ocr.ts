import type { ScanPage } from '../types'
import { RENDER_MAX, renderScanPage } from './image'

type OcrProgressHandler = (message: string, progress: number) => void
type MissingOcrProgressHandler = (current: number, total: number, pageNumber: number) => void
type OcrWorker = Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>

let workerPromise: Promise<OcrWorker> | null = null
let activeProgressHandler: OcrProgressHandler | null = null

const getWorker = async () => {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) =>
      createWorker(['jpn', 'eng'], 1, {
        logger: (message) => {
          const progress = typeof message.progress === 'number' ? message.progress : 0
          activeProgressHandler?.(message.status || 'OCR処理中', progress)
        }
      })
    )
  }
  return workerPromise
}

export const pageNeedsOcr = (page: ScanPage) =>
  page.ocrStatus !== 'done' || typeof page.ocrText !== 'string'

export const getPageOcrText = (page: ScanPage) =>
  typeof page.ocrText === 'string' ? page.ocrText : ''

const recognizeCanvas = async (page: ScanPage) => {
  const worker = await getWorker()
  const canvas = await renderScanPage(page, RENDER_MAX.ocr)
  const source = canvas.toDataURL('image/png')
  const result = await worker.recognize(source)
  return result.data.text.trim()
}

export const recognizePage = async (
  page: ScanPage,
  onProgress?: OcrProgressHandler
): Promise<string> => {
  activeProgressHandler = onProgress ?? null
  try {
    onProgress?.('OCR: ページを準備中', 0)
    const text = await recognizeCanvas(page)
    onProgress?.('OCR: 完了', 1)
    return text
  } finally {
    activeProgressHandler = null
  }
}

export const recognizePages = async (
  pages: ScanPage[],
  onProgress?: OcrProgressHandler
): Promise<string[]> => {
  activeProgressHandler = onProgress ?? null
  const texts: string[] = []

  try {
    for (let index = 0; index < pages.length; index += 1) {
      const pageNumber = index + 1
      onProgress?.(`OCR: ${pageNumber}/${pages.length}ページを準備中`, index / pages.length)
      texts.push(await recognizeCanvas(pages[index]))
      onProgress?.(`OCR: ${pageNumber}/${pages.length}ページ完了`, pageNumber / pages.length)
    }

    return texts
  } finally {
    activeProgressHandler = null
  }
}

/** OCR only pages that do not already have a usable cached result. */
export const recognizeMissingPages = async (
  pages: ScanPage[],
  onProgress?: MissingOcrProgressHandler
): Promise<{ index: number; text: string }[]> => {
  const pendingIndexes = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => pageNeedsOcr(page))
    .map(({ index }) => index)

  if (!pendingIndexes.length) return []

  activeProgressHandler = null
  const results: { index: number; text: string }[] = []

  try {
    for (let step = 0; step < pendingIndexes.length; step += 1) {
      const index = pendingIndexes[step]
      onProgress?.(step + 1, pendingIndexes.length, index + 1)
      results.push({ index, text: await recognizeCanvas(pages[index]) })
    }
    return results
  } finally {
    activeProgressHandler = null
  }
}

export const collectPageTexts = async (
  pages: ScanPage[],
  onProgress?: MissingOcrProgressHandler
): Promise<{ texts: string[]; updates: { index: number; text: string }[] }> => {
  const updates = await recognizeMissingPages(pages, onProgress)
  const texts = pages.map((page, index) => {
    const update = updates.find((item) => item.index === index)
    return update ? update.text : getPageOcrText(page)
  })
  return { texts, updates }
}
