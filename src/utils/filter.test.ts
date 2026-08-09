import { describe, expect, it } from 'vitest'
import { normalizeFilter } from '../types'

describe('normalizeFilter', () => {
  it('maps legacy bw to gray', () => {
    expect(normalizeFilter('bw')).toBe('gray')
  })

  it('keeps supported filters', () => {
    expect(normalizeFilter('auto')).toBe('auto')
    expect(normalizeFilter('color')).toBe('color')
    expect(normalizeFilter('gray')).toBe('gray')
  })

  it('falls back for unknown values', () => {
    expect(normalizeFilter('sepia')).toBe('color')
    expect(normalizeFilter(undefined)).toBe('color')
  })
})
