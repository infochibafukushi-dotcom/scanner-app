import type { ScanPage } from '../types'
import { RENDER_MAX, renderScanPage } from './image'

const cache = new Map<string, string>()

const pageThumbKey = (page: ScanPage) =>
  [
    page.id,
    page.dataUrl.length,
    page.rotation,
    page.filter,
    page.clean ? 1 : 0,
    page.paperSize,
    JSON.stringify(page.corners)
  ].join('|')

/** Low-res corrected thumbnail for Gallery; regenerates only when page content changes. */
export const getGalleryThumbUrl = async (page: ScanPage): Promise<string> => {
  const key = pageThumbKey(page)
  const hit = cache.get(key)
  if (hit) return hit

  const canvas = await renderScanPage(page, RENDER_MAX.gallery)
  const url = canvas.toDataURL('image/jpeg', 0.82)
  // Drop older keys for the same page id to limit memory.
  for (const existing of cache.keys()) {
    if (existing.startsWith(`${page.id}|`) && existing !== key) cache.delete(existing)
  }
  cache.set(key, url)
  return url
}

export const pruneGalleryThumbs = (pageIds: Set<string>) => {
  for (const key of cache.keys()) {
    const id = key.split('|')[0]
    if (!pageIds.has(id)) cache.delete(key)
  }
}
