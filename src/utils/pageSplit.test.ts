import { describe, expect, it } from 'vitest'
import { freshCorners } from './pageSplit'

describe('pageSplit', () => {
  it('returns default four corners', () => {
    const corners = freshCorners()
    expect(corners).toHaveLength(4)
    expect(corners[0].x).toBeLessThan(corners[1].x)
  })
})
