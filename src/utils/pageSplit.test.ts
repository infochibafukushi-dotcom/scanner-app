import { describe, expect, it } from 'vitest'
import { findSpineX, freshCorners } from './pageSplit'

describe('pageSplit', () => {
  it('returns default four corners', () => {
    const corners = freshCorners()
    expect(corners).toHaveLength(4)
    expect(corners[0].x).toBeLessThan(corners[1].x)
  })

  it('detects a dark vertical spine near the true center band', () => {
    const width = 200
    const height = 120
    const spine = 118
    const gray = (x: number, _y: number) => (Math.abs(x - spine) <= 2 ? 40 : 220)
    expect(findSpineX(width, height, gray)).toBeGreaterThan(100)
    expect(findSpineX(width, height, gray)).toBeLessThan(130)
  })
})
