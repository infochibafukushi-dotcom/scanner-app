import type { ScanPage } from '../types'
import { renderScanPage } from './image'

type OcrProgressHandler = (message: string, progress: number) => void
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

export const recognizePages = async (
  pages: ScanPage[],
  onProgress?: OcrProgressHandler
): Promise<string[]> => {
  activeProgressHandler = onProgress ?? null
  const worker = await getWorker()
  const texts: string[] = []

  try {
    for (let index = 0; index < pages.length; index += 1) {
      const pageNumber = index + 1
      onProgress?.(`OCR: ${pageNumber}/${pages.length}ページを準備中`, index / pages.length)
      const canvas = await renderScanPage(pages[index], 1800)
      const source = canvas.toDataURL('image/png')
      const result = await worker.recognize(source)
      texts.push(result.data.text.trim())
      onProgress?.(`OCR: ${pageNumber}/${pages.length}ページ完了`, pageNumber / pages.length)
    }

    return texts
  } finally {
    activeProgressHandler = null
  }
}
