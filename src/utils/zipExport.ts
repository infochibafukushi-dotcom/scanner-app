import JSZip from 'jszip'
import type { ScanPage } from '../types'
import { RENDER_MAX, renderScanPage } from './image'

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('画像を作成できませんでした'))
        else resolve(blob)
      },
      type,
      quality
    )
  })

/** Build a ZIP of corrected JPEG pages (vFlat-like batch export). */
export const buildPagesZipBlob = async (
  pages: ScanPage[],
  onProgress?: (current: number, total: number) => void
) => {
  const zip = new JSZip()
  const total = pages.length
  for (let index = 0; index < pages.length; index += 1) {
    onProgress?.(index + 1, total)
    const canvas = await renderScanPage(pages[index], RENDER_MAX.export)
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95)
    const name = `${String(index + 1).padStart(3, '0')}_${pages[index].name || 'page'}.jpg`
    zip.file(name.replace(/[\\/:*?"<>|]/g, '_'), blob)
  }
  return zip.generateAsync({ type: 'blob' })
}
