import { describe, expect, it } from 'vitest'
import {
  getContainedImageRect,
  localPointToNormalized,
  normalizedToLocalPoint,
  normalizedToScreenPoint,
  placeLoupeForCorner,
  screenPointToNormalized
} from './displayRect'

describe('getContainedImageRect', () => {
  it('computes left/right letterbox for portrait images', () => {
    // Container wider than A4 (400×500 ≈ 0.8 vs 210/297 ≈ 0.707) → pillarbox sides.
    const rect = getContainedImageRect(400, 500, 210, 297)
    expect(rect.height).toBeCloseTo(500, 5)
    expect(rect.width).toBeCloseTo(500 * (210 / 297), 5)
    expect(rect.top).toBeCloseTo(0, 5)
    expect(rect.left).toBeCloseTo((400 - rect.width) / 2, 5)
  })

  it('computes top/bottom letterbox for landscape images', () => {
    const rect = getContainedImageRect(400, 800, 400, 200)
    expect(rect.width).toBeCloseTo(400, 5)
    expect(rect.height).toBeCloseTo(200, 5)
    expect(rect.left).toBeCloseTo(0, 5)
    expect(rect.top).toBeCloseTo(300, 5)
  })

  it('fills the container for square images in a square container', () => {
    const rect = getContainedImageRect(300, 300, 100, 100)
    expect(rect).toEqual({ left: 0, top: 0, width: 300, height: 300 })
  })

  it('handles square image in a tall container (pillarbox)', () => {
    const rect = getContainedImageRect(200, 400, 100, 100)
    expect(rect.width).toBeCloseTo(200, 5)
    expect(rect.height).toBeCloseTo(200, 5)
    expect(rect.left).toBeCloseTo(0, 5)
    expect(rect.top).toBeCloseTo(100, 5)
  })

  it('letterboxes a portrait page in a very tall stage (top/bottom)', () => {
    // Stage taller/narrower than A4 → fit to width, pad vertically.
    const rect = getContainedImageRect(360, 720, 210, 297)
    expect(rect.width).toBeCloseTo(360, 5)
    expect(rect.height).toBeCloseTo(360 / (210 / 297), 5)
    expect(rect.left).toBeCloseTo(0, 5)
    expect(rect.top).toBeCloseTo((720 - rect.height) / 2, 5)
  })
})

describe('normalized ↔ screen transforms', () => {
  const rect = getContainedImageRect(400, 500, 210, 297)
  const identity = { scale: 1, x: 0, y: 0 }

  it('maps normalized (0,0) to the image top-left', () => {
    const local = normalizedToLocalPoint({ x: 0, y: 0 }, rect)
    expect(local.x).toBeCloseTo(rect.left, 5)
    expect(local.y).toBeCloseTo(rect.top, 5)
  })

  it('maps normalized (1,1) to the image bottom-right', () => {
    const local = normalizedToLocalPoint({ x: 1, y: 1 }, rect)
    expect(local.x).toBeCloseTo(rect.left + rect.width, 5)
    expect(local.y).toBeCloseTo(rect.top + rect.height, 5)
  })

  it('round-trips normalized → screen → normalized with small error', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0.25, y: 0.75 },
      { x: 0.5, y: 0.5 }
    ]
    for (const point of samples) {
      const screen = normalizedToScreenPoint(point, 10, 20, rect, identity)
      const back = screenPointToNormalized(screen.x, screen.y, 10, 20, rect, identity)
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
  })

  it('clamps letterbox pointer hits into 0..1', () => {
    // Click in the left pillarbox (outside the image).
    const normalized = screenPointToNormalized(10 + rect.left - 20, 20 + rect.top + 10, 10, 20, rect, identity)
    expect(normalized.x).toBe(0)
    expect(normalized.y).toBeGreaterThanOrEqual(0)
    expect(normalized.y).toBeLessThanOrEqual(1)

    // Click in the right pillarbox.
    const right = screenPointToNormalized(
      10 + rect.left + rect.width + 30,
      20 + rect.top + rect.height / 2,
      10,
      20,
      rect,
      identity
    )
    expect(right.x).toBe(1)
  })

  it('accounts for pan/zoom viewport transform', () => {
    const view = { scale: 2, x: 15, y: -8 }
    const point = { x: 0.4, y: 0.6 }
    const screen = normalizedToScreenPoint(point, 0, 0, rect, view)
    const back = screenPointToNormalized(screen.x, screen.y, 0, 0, rect, view)
    expect(back.x).toBeCloseTo(point.x, 6)
    expect(back.y).toBeCloseTo(point.y, 6)
  })

  it('localPointToNormalized clamps outside the display rect', () => {
    const outside = localPointToNormalized({ x: rect.left - 50, y: rect.top + rect.height + 10 }, rect)
    expect(outside.x).toBe(0)
    expect(outside.y).toBe(1)
  })
})

describe('placeLoupeForCorner', () => {
  it('keeps the loupe inside a 360px-wide viewport', () => {
    const size = 160
    const placed = placeLoupeForCorner(40, 80, size, { x: 0.1, y: 0.1 }, 360, 800)
    expect(placed.x).toBeGreaterThanOrEqual(0)
    expect(placed.x + size).toBeLessThanOrEqual(360)
    expect(placed.y).toBeGreaterThanOrEqual(0)
    expect(placed.y + size).toBeLessThanOrEqual(800)
  })

  it('prefers below for upper corners and above for lower corners', () => {
    const size = 160
    const upper = placeLoupeForCorner(180, 200, size, { x: 0.2, y: 0.15 }, 390, 844, {
      topSafe: 0,
      bottomSafe: 0,
      margin: 0,
      offset: 22
    })
    expect(upper.y).toBeGreaterThanOrEqual(200)

    const lower = placeLoupeForCorner(180, 600, size, { x: 0.8, y: 0.85 }, 390, 844, {
      topSafe: 0,
      bottomSafe: 0,
      margin: 0,
      offset: 22
    })
    expect(lower.y + size).toBeLessThanOrEqual(600)
  })
})
