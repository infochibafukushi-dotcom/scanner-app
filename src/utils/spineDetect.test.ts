import { describe, expect, it } from 'vitest'
import { detectSpineFromSampler, SPINE_SPLIT_AUTO_CONFIDENCE } from './spineDetect'
import { findSpineWithConfidence } from './pageSplit'

describe('spineDetect', () => {
  it('scores a clear dark spine highly', () => {
    const width = 200
    const height = 120
    const spine = 110
    const result = detectSpineFromSampler(width, height, (x) => (Math.abs(x - spine) <= 2 ? 35 : 220))
    expect(result.spineX).toBeGreaterThan(100)
    expect(result.spineX).toBeLessThan(120)
    expect(result.confidence).toBeGreaterThanOrEqual(SPINE_SPLIT_AUTO_CONFIDENCE)
  })

  it('keeps confidence low on a uniform field', () => {
    const result = detectSpineFromSampler(180, 100, () => 170)
    expect(result.confidence).toBeLessThan(SPINE_SPLIT_AUTO_CONFIDENCE)
  })

  it('does not trust a thin dark line far from a convincing gutter', () => {
    const width = 220
    const height = 140
    // Bright pages with only a 1px dark scribble near the search edge.
    const result = detectSpineFromSampler(width, height, (x, y) => {
      if (x === Math.floor(width * 0.29) && y % 7 === 0) return 20
      return 210
    })
    expect(result.confidence).toBeLessThan(0.55)
  })

  it('exposes findSpineWithConfidence for pageSplit callers', () => {
    const detected = findSpineWithConfidence(160, 100, (x) => (Math.abs(x - 80) <= 1 ? 30 : 200))
    expect(detected.spineX).toBeGreaterThan(70)
    expect(detected.spineX).toBeLessThan(90)
    expect(detected.confidence).toBeGreaterThan(0.4)
  })
})
