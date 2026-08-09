import { describe, expect, it } from 'vitest'
import type { ScanPage } from '../types'
import { galleryThumbKey } from './galleryThumbs'

const base = (): ScanPage => ({
  id: 'p1',
  name: 'page',
  dataUrl: 'data:image/jpeg;base64,xx',
  corners: [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 }
  ],
  cornerDetection: 'auto',
  rotation: 0,
  filter: 'color',
  clean: false,
  bookFlatten: 'off',
  paperSize: 'a4',
  ocrText: 'hello',
  ocrStatus: 'done',
  translationText: 'hola',
  translationStatus: 'done'
})

describe('galleryThumbKey', () => {
  it('ignores OCR and translation-only changes', () => {
    const a = galleryThumbKey(base())
    const b = galleryThumbKey({ ...base(), ocrText: 'changed', ocrStatus: 'done' })
    const c = galleryThumbKey({ ...base(), translationText: 'changed', translationStatus: 'done' })
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('changes when corners or filter change', () => {
    const a = galleryThumbKey(base())
    const corners = galleryThumbKey({
      ...base(),
      corners: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.2, y: 0.8 }
      ]
    })
    const filter = galleryThumbKey({ ...base(), filter: 'gray' })
    expect(corners).not.toBe(a)
    expect(filter).not.toBe(a)
  })
})
