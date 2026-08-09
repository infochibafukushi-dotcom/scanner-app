import type { HighResStitchProgress, HighResStitchResult, HighResTileId } from '../types'
import { dataUrlToBitmap } from './highResStitchEngine'
import { stitchHighRes } from './highResStitch'
import type { HighResWorkerOutbound, HighResWorkerRequest } from '../workers/highResWorker'

type Job = {
  resolve: (result: HighResStitchResult) => void
  onProgress?: (p: HighResStitchProgress) => void
}

let activeWorker: Worker | null = null
let activeJobId: string | null = null
const jobs = new Map<string, Job>()

const supportsWorker = () => typeof Worker !== 'undefined' && typeof createImageBitmap === 'function'

const terminateWorker = () => {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }
  activeJobId = null
}

const ensureWorker = () => {
  if (activeWorker) return activeWorker
  const worker = new Worker(new URL('../workers/highResWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<HighResWorkerOutbound>) => {
    const message = event.data
    const job = jobs.get(message.id)
    if (!job) return
    if (message.type === 'progress') {
      job.onProgress?.({ stage: message.stage, current: message.current, total: message.total })
      return
    }
    jobs.delete(message.id)
    if (activeJobId === message.id) activeJobId = null
    job.resolve(message.result)
  }
  worker.onerror = () => {
    if (activeJobId) {
      const job = jobs.get(activeJobId)
      jobs.delete(activeJobId)
      job?.resolve({
        ok: false,
        message: 'Worker でエラーが発生したため、メイン処理へ切り替えます。',
        failedTiles: ['tl', 'tr', 'br', 'bl']
      })
      activeJobId = null
    }
    terminateWorker()
  }
  activeWorker = worker
  return worker
}

export const cancelHighResStitch = () => {
  const jobId = activeJobId
  terminateWorker()
  if (jobId) {
    const job = jobs.get(jobId)
    jobs.delete(jobId)
    job?.resolve({
      ok: false,
      message: 'キャンセルされました。',
      failedTiles: [],
      retakeHint: '必要ならもう一度高精細撮影を開始してください。'
    })
  }
}

/** Prefer Web Worker + ImageBitmap transfer; fall back to main-thread stitch. */
export async function stitchHighResAdaptive(params: {
  baseDataUrl: string
  tiles: Record<HighResTileId, string>
  onProgress?: (p: HighResStitchProgress) => void
}): Promise<HighResStitchResult> {
  if (!supportsWorker()) {
    return stitchHighRes(params)
  }

  let base: ImageBitmap | null = null
  let tiles: Partial<Record<HighResTileId, ImageBitmap>> = {}
  try {
    base = await dataUrlToBitmap(params.baseDataUrl)
    tiles = {
      tl: await dataUrlToBitmap(params.tiles.tl),
      tr: await dataUrlToBitmap(params.tiles.tr),
      br: await dataUrlToBitmap(params.tiles.br),
      bl: await dataUrlToBitmap(params.tiles.bl)
    }

    const id = crypto.randomUUID()
    const worker = ensureWorker()
    const result = await new Promise<HighResStitchResult>((resolve) => {
      jobs.set(id, { resolve, onProgress: params.onProgress })
      activeJobId = id
      const request: HighResWorkerRequest = {
        type: 'stitch',
        id,
        base: base!,
        tiles: tiles as Record<HighResTileId, ImageBitmap>
      }
      const transfer = [
        base!,
        tiles.tl!,
        tiles.tr!,
        tiles.br!,
        tiles.bl!
      ] as Transferable[]
      worker.postMessage(request, transfer)
      // Ownership transferred; avoid double-close in this branch.
      base = null
      tiles = {}
    })

    // Soft worker runtime failure → try main thread. Do not retry cancels.
    if (!result.ok && result.message.includes('Worker') && result.message !== 'キャンセルされました。') {
      return stitchHighRes(params)
    }
    return result
  } catch (error) {
    console.warn('High-res worker unavailable, falling back to main thread.', error)
    if (base) base.close()
    for (const bitmap of Object.values(tiles)) bitmap?.close()
    return stitchHighRes(params)
  }
}
