import { describe, expect, it } from 'vitest'
import type { Point } from '../types'
import { shouldAcceptRefinedCorners } from './cornerRefine'

const quad = (inset: number): [Point, Point, Point, Point] => [
  { x: inset, y: inset },
  { x: 1 - inset, y: inset },
  { x: 1 - inset, y: 1 - inset },
  { x: inset, y: 1 - inset }
]

const live = quad(0.12)
const near = quad(0.13)
const far = quad(0.35)

describe('shouldAcceptRefinedCorners', () => {
  it('keeps live corners when still detection fails', () => {
    expect(
      shouldAcceptRefinedCorners({
        cornerDetection: 'auto',
        currentDataUrl: 'a',
        refineDataUrl: 'a',
        currentCorners: live,
        currentConfidence: 0.8,
        still: { corners: far, detected: false, confidence: 0 }
      })
    ).toBe(false)
  })

  it('rejects a weak far still detection against strong live corners', () => {
    expect(
      shouldAcceptRefinedCorners({
        cornerDetection: 'auto',
        currentDataUrl: 'a',
        refineDataUrl: 'a',
        currentCorners: live,
        currentConfidence: 0.75,
        still: { corners: far, detected: true, confidence: 0.4 }
      })
    ).toBe(false)
  })

  it('accepts a much stronger still detection near a reasonable position', () => {
    expect(
      shouldAcceptRefinedCorners({
        cornerDetection: 'auto',
        currentDataUrl: 'a',
        refineDataUrl: 'a',
        currentCorners: live,
        currentConfidence: 0.5,
        still: { corners: near, detected: true, confidence: 0.9 }
      })
    ).toBe(true)
  })

  it('never changes manual corners', () => {
    expect(
      shouldAcceptRefinedCorners({
        cornerDetection: 'manual',
        currentDataUrl: 'a',
        refineDataUrl: 'a',
        currentCorners: live,
        currentConfidence: 0.2,
        still: { corners: near, detected: true, confidence: 0.99 }
      })
    ).toBe(false)
  })

  it('ignores stale refine results after dataUrl changes', () => {
    expect(
      shouldAcceptRefinedCorners({
        cornerDetection: 'auto',
        currentDataUrl: 'new-url',
        refineDataUrl: 'old-url',
        currentCorners: live,
        currentConfidence: 0.5,
        still: { corners: near, detected: true, confidence: 0.99 }
      })
    ).toBe(false)
  })

  it('accepts still success when current corners are fallback', () => {
    expect(
      shouldAcceptRefinedCorners({
        cornerDetection: 'fallback',
        currentDataUrl: 'a',
        refineDataUrl: 'a',
        currentCorners: live,
        currentConfidence: 0,
        still: { corners: far, detected: true, confidence: 0.55 }
      })
    ).toBe(true)
  })
})
