import type { HighResStitchProgress, HighResStitchResult, HighResTileId } from '../types'
import { checkTileDetailEnough, dataUrlToBitmap, stitchHighResFromBitmaps } from './highResStitchEngine'

export { checkTileDetailEnough }

/** Main-thread high-res stitch (also used as Worker fallback). */
export async function stitchHighRes(params: {
  baseDataUrl: string
  tiles: Record<HighResTileId, string>
  onProgress?: (p: HighResStitchProgress) => void
  signal?: AbortSignal
}): Promise<HighResStitchResult> {
  const bitmaps = {
    base: await dataUrlToBitmap(params.baseDataUrl),
    tiles: {
      tl: await dataUrlToBitmap(params.tiles.tl),
      tr: await dataUrlToBitmap(params.tiles.tr),
      br: await dataUrlToBitmap(params.tiles.br),
      bl: await dataUrlToBitmap(params.tiles.bl)
    } as Record<HighResTileId, ImageBitmap>
  }

  try {
    return await stitchHighResFromBitmaps({
      base: bitmaps.base,
      tiles: bitmaps.tiles,
      onProgress: params.onProgress,
      signal: params.signal
    })
  } finally {
    bitmaps.base.close()
    for (const id of Object.keys(bitmaps.tiles) as HighResTileId[]) bitmaps.tiles[id].close()
  }
}
