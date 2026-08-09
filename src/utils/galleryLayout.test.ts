import { describe, expect, it } from 'vitest'
import { getGalleryLayout } from './galleryLayout'

describe('getGalleryLayout', () => {
  it('uses single layout for one page', () => {
    expect(getGalleryLayout(1)).toBe('single')
  })

  it('uses grid for two or more pages', () => {
    expect(getGalleryLayout(2)).toBe('grid')
    expect(getGalleryLayout(3)).toBe('grid')
    expect(getGalleryLayout(12)).toBe('grid')
  })

  it('uses grid for empty galleries', () => {
    expect(getGalleryLayout(0)).toBe('grid')
  })
})
