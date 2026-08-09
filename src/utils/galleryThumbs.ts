import type { ScanPage } from '../types'
import { RENDER_MAX, downscaleDataUrl, renderScanPage } from './image'

const cache = new Map<string, string>()
const placeholders = new Map<string, string>()
const placeholderListeners = new Map<string, Set<() => void>>()

/** Image-affecting key for gallery thumbs (excludes OCR / translation / names). */
export const galleryThumbKey = (page: ScanPage) =>
  [
    page.id,
    page.dataUrl.length,
    page.rotation,
    page.filter,
    page.clean ? 1 : 0,
    page.bookFlatten ?? 'off',
    page.paperSize,
    JSON.stringify(page.corners)
  ].join('|')

const notifyPlaceholder = (pageId: string) => {
  const listeners = placeholderListeners.get(pageId)
  if (!listeners) return
  for (const listener of listeners) listener()
}

export const subscribeGalleryPlaceholder = (pageId: string, listener: () => void) => {
  let set = placeholderListeners.get(pageId)
  if (!set) {
    set = new Set()
    placeholderListeners.set(pageId, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
    if (set && set.size === 0) placeholderListeners.delete(pageId)
  }
}

export const getGalleryPlaceholder = (pageId: string) => placeholders.get(pageId) ?? null

/** Store a cheap raw still for instant gallery / camera-stack feedback. */
export const seedGalleryPlaceholder = async (pageId: string, dataUrl: string, maxSide = 280) => {
  try {
    const url = await downscaleDataUrl(dataUrl, maxSide, 0.7)
    placeholders.set(pageId, url)
    notifyPlaceholder(pageId)
    return url
  } catch {
    placeholders.set(pageId, dataUrl)
    notifyPlaceholder(pageId)
    return dataUrl
  }
}

/** Low-res corrected thumbnail for Gallery; regenerates only when page content changes. */
export const getGalleryThumbUrl = async (page: ScanPage): Promise<string> => {
  const key = galleryThumbKey(page)
  const hit = cache.get(key)
  if (hit) return hit

  const canvas = await renderScanPage(page, RENDER_MAX.gallery)
  const url = canvas.toDataURL('image/jpeg', 0.78)
  for (const existing of cache.keys()) {
    if (existing.startsWith(`${page.id}|`) && existing !== key) cache.delete(existing)
  }
  cache.set(key, url)
  return url
}

export const prefetchGalleryThumb = (page: ScanPage) => {
  void getGalleryThumbUrl(page)
}

export const pruneGalleryThumbs = (pageIds: Set<string>) => {
  for (const key of cache.keys()) {
    const id = key.split('|')[0]
    if (!pageIds.has(id)) cache.delete(key)
  }
  for (const id of placeholders.keys()) {
    if (!pageIds.has(id)) placeholders.delete(id)
  }
}
