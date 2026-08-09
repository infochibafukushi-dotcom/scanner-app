import { describe, expect, it, vi } from 'vitest'
import type { CornerDetectionResult } from '../types'

vi.mock('./corners', () => ({
  detectDocumentCorners: vi.fn(async (dataUrl: string): Promise<CornerDetectionResult> => {
    if (dataUrl.includes('fail')) {
      return {
        corners: [
          { x: 0.05, y: 0.05 },
          { x: 0.95, y: 0.05 },
          { x: 0.95, y: 0.95 },
          { x: 0.05, y: 0.95 }
        ],
        detected: false,
        confidence: 0
      }
    }
    return {
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 }
      ],
      detected: true,
      confidence: 0.82
    }
  })
}))

vi.mock('./pageSplit', async () => {
  const actual = await vi.importActual<typeof import('./pageSplit')>('./pageSplit')
  return {
    ...actual,
    splitDataUrlVertically: vi.fn(async (dataUrl: string) => {
      if (dataUrl.includes('weak-spine')) {
        return {
          leftDataUrl: 'left-ok',
          rightDataUrl: 'right-ok',
          spineX: 100,
          width: 200,
          confidence: 0.2
        }
      }
      if (dataUrl.includes('right-fail')) {
        return {
          leftDataUrl: 'left-ok',
          rightDataUrl: 'right-fail',
          spineX: 100,
          width: 200,
          confidence: 0.8
        }
      }
      return {
        leftDataUrl: 'left-ok',
        rightDataUrl: 'right-ok',
        spineX: 100,
        width: 200,
        confidence: 0.8
      }
    })
  }
})

import { createPagesFromBookCapture } from './bookCapture'

describe('createPagesFromBookCapture', () => {
  it('keeps a raw spread page when spine confidence is low', async () => {
    const result = await createPagesFromBookCapture('weak-spine', '本-1', 'ltr')
    expect(result.kind).toBe('spread')
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].dataUrl).toBe('weak-spine')
    expect(result.pages[0].bookFlatten).toBe('off')
  })

  it('creates two precise book pages in ltr order', async () => {
    const result = await createPagesFromBookCapture('strong', '本-2', 'ltr')
    expect(result.kind).toBe('split')
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0].name).toContain('左')
    expect(result.pages[1].name).toContain('右')
    expect(result.pages[0].bookFlatten).toBe('precise')
    expect(result.pages[0].paperSize).toBe('free')
    expect(result.pages[0].cornerDetection).toBe('auto')
  })

  it('orders rtl as right then left', async () => {
    const result = await createPagesFromBookCapture('strong', '本-3', 'rtl')
    expect(result.pages[0].name).toContain('右')
    expect(result.pages[1].name).toContain('左')
  })

  it('keeps both pages when one side corner detection fails', async () => {
    const result = await createPagesFromBookCapture('right-fail', '本-4', 'ltr')
    expect(result.kind).toBe('split')
    expect(result.pages).toHaveLength(2)
    expect(result.pages[0].cornerDetection).toBe('auto')
    expect(result.pages[1].cornerDetection).toBe('fallback')
  })
})
