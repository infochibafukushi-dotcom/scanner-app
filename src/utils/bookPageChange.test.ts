import { describe, expect, it } from 'vitest'
import {
  BOOK_PAGE_CHANGE_DELTA,
  BOOK_PAGE_CHANGE_FRAMES,
  bookPageDifference,
  isBookPageChange,
  nextBookChangeStreak,
  shouldReArmBookPage
} from './bookPageChange'

const makeFrame = (width: number, height: number, fill: (x: number, y: number) => number) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = fill(x, y)
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

describe('bookPageChange', () => {
  it('exports stable thresholds', () => {
    expect(BOOK_PAGE_CHANGE_DELTA).toBeGreaterThan(10)
    expect(BOOK_PAGE_CHANGE_FRAMES).toBeGreaterThanOrEqual(2)
  })

  it('stays low for nearly identical frames', () => {
    const a = makeFrame(32, 32, (x, y) => ((x + y) % 17) * 8 + 40)
    const b = makeFrame(32, 32, (x, y) => ((x + y) % 17) * 8 + 41)
    expect(isBookPageChange(bookPageDifference(a, b))).toBe(false)
  })

  it('is resistant to a global brightness shift', () => {
    const a = makeFrame(32, 32, (x, y) => ((x * 3 + y * 5) % 40) + 60)
    const b = makeFrame(32, 32, (x, y) => ((x * 3 + y * 5) % 40) + 90)
    expect(bookPageDifference(a, b)).toBeLessThan(BOOK_PAGE_CHANGE_DELTA)
  })

  it('detects a large content change', () => {
    const a = makeFrame(32, 32, (x) => (x < 16 ? 40 : 200))
    const b = makeFrame(32, 32, (x, y) => ((x + y) % 2 === 0 ? 30 : 220))
    expect(isBookPageChange(bookPageDifference(a, b))).toBe(true)
  })

  it('requires consecutive changed frames before re-arm', () => {
    expect(shouldReArmBookPage(nextBookChangeStreak(0, true))).toBe(false)
    expect(shouldReArmBookPage(nextBookChangeStreak(1, true))).toBe(true)
    expect(nextBookChangeStreak(1, false)).toBe(0)
  })
})
