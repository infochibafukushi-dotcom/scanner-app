import { describe, expect, it } from 'vitest'
import { invalidateOcrForImageChange, type ScanPage } from '../types'
import { migratePaperSize, resolvePdfFormat, resolveTargetAspect } from './paper'
import { moveByOffset, reorderByIndex } from './pageOrder'
import { isQuotaExceededError } from './indexedDb'

const sampleCorners = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 }
] as ScanPage['corners']

const basePage = (): ScanPage => ({
  id: 'p1',
  name: 'page',
  dataUrl: 'data:image/jpeg;base64,xx',
  corners: sampleCorners,
  cornerDetection: 'auto',
  rotation: 0,
  filter: 'color',
  clean: false,
  paperSize: 'a4',
  ocrText: 'hello',
  ocrStatus: 'done'
})

describe('runtime smoke checks', () => {
  it('keeps explicit paper sizes for PDF formats', () => {
    expect(resolvePdfFormat('a3', 1000, 1400).format).toBe('a3')
    expect(resolvePdfFormat('a4', 1000, 1400).format).toBe('a4')
    expect(resolvePdfFormat('a5', 1000, 1400).format).toBe('a5')
    expect(resolvePdfFormat('letter', 1000, 1400).format).toBe('letter')
    expect(Array.isArray(resolvePdfFormat('business-card', 910, 550).format)).toBe(true)
    expect(Array.isArray(resolvePdfFormat('free', 800, 1200).format)).toBe(true)
  })

  it('migrates legacy paperRatio and invalidates OCR on image edits', () => {
    expect(migratePaperSize({ paperRatio: 'letter' })).toBe('letter')
    const stale = invalidateOcrForImageChange({ ...basePage(), paperSize: 'a5' })
    expect(stale.ocrStatus).toBe('stale')
    expect(resolveTargetAspect('business-card', sampleCorners)).not.toBeNull()
  })

  it('reorders pages for export order consistency helpers', () => {
    const pages = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]
    expect(reorderByIndex(pages, 0, 4).map((p) => p.id)).toEqual(['2', '3', '4', '5', '1'])
    expect(moveByOffset(pages, '5', -1).map((p) => p.id)).toEqual(['1', '2', '3', '5', '4'])
  })

  it('detects quota exceeded errors without throwing', () => {
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true)
    expect(isQuotaExceededError(new Error('nope'))).toBe(false)
    expect(isQuotaExceededError(null)).toBe(false)
  })
})
