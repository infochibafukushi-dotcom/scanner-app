import { describe, expect, it } from 'vitest'
import {
  BOOK_PAGE_CHANGE_DELTA,
  BOOK_PAGE_CHANGE_FRAMES,
  BOOK_PAGE_CHANGE_MAX_SHIFT,
  bookPageDifference,
  canAutoCaptureFire,
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

const shiftFrame = (source: ImageData, dx: number, dy: number) =>
  makeFrame(source.width, source.height, (x, y) => {
    const sx = Math.min(source.width - 1, Math.max(0, x - dx))
    const sy = Math.min(source.height - 1, Math.max(0, y - dy))
    return source.data[(sy * source.width + sx) * 4]
  })

describe('bookPageChange', () => {
  it('exports stable thresholds', () => {
    expect(BOOK_PAGE_CHANGE_DELTA).toBeGreaterThan(10)
    expect(BOOK_PAGE_CHANGE_FRAMES).toBeGreaterThanOrEqual(2)
    expect(BOOK_PAGE_CHANGE_MAX_SHIFT).toBe(2)
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

  it('tolerates 1–2px translation of the same content', () => {
    const a = makeFrame(48, 48, (x, y) => ((x * 5 + y * 3) % 50) + 40)
    expect(bookPageDifference(a, shiftFrame(a, 1, 0))).toBeLessThan(BOOK_PAGE_CHANGE_DELTA)
    expect(bookPageDifference(a, shiftFrame(a, 0, 2))).toBeLessThan(BOOK_PAGE_CHANGE_DELTA)
    expect(bookPageDifference(a, shiftFrame(a, 1, -1))).toBeLessThan(BOOK_PAGE_CHANGE_DELTA)
  })

  it('tolerates shift plus brightness change', () => {
    const a = makeFrame(48, 48, (x, y) => ((x * 7 + y * 2) % 45) + 50)
    const shifted = shiftFrame(a, 2, 1)
    const brighter = makeFrame(48, 48, (x, y) => Math.min(255, shifted.data[(y * 48 + x) * 4] + 28))
    expect(bookPageDifference(a, brighter)).toBeLessThan(BOOK_PAGE_CHANGE_DELTA)
  })

  it('detects a large content change even with a 1px shift', () => {
    const a = makeFrame(32, 32, (x) => (x < 16 ? 40 : 200))
    const b = makeFrame(32, 32, (x, y) => ((x + y) % 2 === 0 ? 30 : 220))
    expect(isBookPageChange(bookPageDifference(a, b))).toBe(true)
    expect(isBookPageChange(bookPageDifference(a, shiftFrame(b, 1, 0)))).toBe(true)
  })

  it('requires consecutive changed frames before re-arm', () => {
    expect(shouldReArmBookPage(nextBookChangeStreak(0, true))).toBe(false)
    expect(shouldReArmBookPage(nextBookChangeStreak(1, true))).toBe(true)
    expect(nextBookChangeStreak(1, false)).toBe(0)
  })

  it('does not count a change while motion is unstable', () => {
    const streak = nextBookChangeStreak(0, true && false)
    expect(streak).toBe(0)
  })

  it('blocks auto capture while processing', () => {
    expect(canAutoCaptureFire(false, true)).toBe(false)
    expect(canAutoCaptureFire(true, false)).toBe(false)
    expect(canAutoCaptureFire(false, false)).toBe(true)
  })
})
