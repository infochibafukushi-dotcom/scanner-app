import type { HighResStitchProgress, HighResStitchResult, HighResTileId } from '../types'
import { stitchHighResFromBitmaps } from '../utils/highResStitchEngine'

export type HighResWorkerRequest = {
  type: 'stitch'
  id: string
  base: ImageBitmap
  tiles: Record<HighResTileId, ImageBitmap>
}

export type HighResWorkerProgress = {
  type: 'progress'
  id: string
} & HighResStitchProgress

export type HighResWorkerSuccess = {
  type: 'success'
  id: string
  result: Extract<HighResStitchResult, { ok: true }>
}

export type HighResWorkerError = {
  type: 'error'
  id: string
  result: Extract<HighResStitchResult, { ok: false }>
}

export type HighResWorkerOutbound = HighResWorkerProgress | HighResWorkerSuccess | HighResWorkerError

const closeBitmaps = (base: ImageBitmap, tiles: Record<HighResTileId, ImageBitmap>) => {
  try {
    base.close()
  } catch {
    /* ignore */
  }
  for (const id of Object.keys(tiles) as HighResTileId[]) {
    try {
      tiles[id].close()
    } catch {
      /* ignore */
    }
  }
}

self.onmessage = async (event: MessageEvent<HighResWorkerRequest>) => {
  const message = event.data
  if (!message || message.type !== 'stitch') return

  const { id, base, tiles } = message
  try {
    const result = await stitchHighResFromBitmaps({
      base,
      tiles,
      onProgress: (progress) => {
        const outbound: HighResWorkerProgress = { type: 'progress', id, ...progress }
        ;(self as DedicatedWorkerGlobalScope).postMessage(outbound)
      }
    })

    if (result.ok) {
      const outbound: HighResWorkerSuccess = { type: 'success', id, result }
      ;(self as DedicatedWorkerGlobalScope).postMessage(outbound)
    } else {
      const outbound: HighResWorkerError = { type: 'error', id, result }
      ;(self as DedicatedWorkerGlobalScope).postMessage(outbound)
    }
  } catch (error) {
    const outbound: HighResWorkerError = {
      type: 'error',
      id,
      result: {
        ok: false,
        message: error instanceof Error ? error.message : 'Worker 内で合成に失敗しました。',
        failedTiles: ['tl', 'tr', 'br', 'bl'],
        retakeHint: '通常スキャンとして保存するか、撮影をやり直してください。'
      }
    }
    ;(self as DedicatedWorkerGlobalScope).postMessage(outbound)
  } finally {
    closeBitmaps(base, tiles)
  }
}
