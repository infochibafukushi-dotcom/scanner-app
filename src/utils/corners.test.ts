import { describe, expect, it } from 'vitest'
import {
  AUTO_CAPTURE_CONFIDENCE,
  AUTO_CAPTURE_STABLE_DELTA,
  AUTO_CAPTURE_STABLE_FRAMES,
  runCornerDetectionOnGray
} from './corners'
import { smoothCorners } from './liveCorners'

const fillRect = (
  gray: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number
) => {
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(width, x1); x += 1) {
      gray[y * width + x] = value
    }
  }
}

const makeDocumentGray = (width: number, height: number, inset = 0.18) => {
  const gray = new Uint8Array(width * height)
  gray.fill(48)
  const x0 = Math.round(width * inset)
  const y0 = Math.round(height * inset)
  const x1 = Math.round(width * (1 - inset))
  const y1 = Math.round(height * (1 - inset))
  fillRect(gray, width, height, x0, y0, x1, y1, 235)
  return { gray, x0, y0, x1, y1 }
}

describe('corners', () => {
  it('exports sensible auto-capture thresholds', () => {
    expect(AUTO_CAPTURE_CONFIDENCE).toBeGreaterThan(0.5)
    expect(AUTO_CAPTURE_STABLE_DELTA).toBeLessThan(0.04)
    expect(AUTO_CAPTURE_STABLE_FRAMES).toBeGreaterThanOrEqual(2)
  })

  it('detects a bright page on a dark background near the true bounds', () => {
    const width = 240
    const height = 300
    const { gray, x0, y0, x1, y1 } = makeDocumentGray(width, height, 0.2)
    const result = runCornerDetectionOnGray(gray, width, height)

    expect(result.detected).toBe(true)
    expect(result.confidence).toBeGreaterThan(0.4)

    const [tl, tr, br, bl] = result.corners
    const tolerance = 0.08
    expect(tl.x).toBeGreaterThan(x0 / width - tolerance)
    expect(tl.x).toBeLessThan(x0 / width + tolerance)
    expect(tl.y).toBeGreaterThan(y0 / height - tolerance)
    expect(tl.y).toBeLessThan(y0 / height + tolerance)
    expect(tr.x).toBeGreaterThan(x1 / width - tolerance)
    expect(br.y).toBeGreaterThan(y1 / height - tolerance)
    expect(bl.x).toBeLessThan(x0 / width + tolerance)
  })

  it('rejects a blank / uniform frame', () => {
    const width = 160
    const height = 200
    const gray = new Uint8Array(width * height)
    gray.fill(180)
    const result = runCornerDetectionOnGray(gray, width, height)
    expect(result.detected).toBe(false)
    expect(result.confidence).toBe(0)
  })

  it('still finds low-contrast paper after midtone stretch passes', () => {
    const width = 220
    const height = 280
    const gray = new Uint8Array(width * height)
    gray.fill(150)
    fillRect(gray, width, height, 40, 45, 180, 235, 178)
    const result = runCornerDetectionOnGray(gray, width, height)
    expect(result.detected).toBe(true)
    expect(result.confidence).toBeGreaterThan(0.32)
  })
})

describe('liveCorners smoothCorners', () => {
  it('blends toward the next sample without overshooting', () => {
    const previous = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 }
    ] as const
    const next = [
      { x: 0.2, y: 0.15 },
      { x: 0.85, y: 0.12 },
      { x: 0.88, y: 0.88 },
      { x: 0.12, y: 0.86 }
    ] as const
    const smoothed = smoothCorners([...previous], [...next], 0.5)
    expect(smoothed[0].x).toBeCloseTo(0.15, 5)
    expect(smoothed[0].y).toBeCloseTo(0.125, 5)
    expect(smoothed[2].x).toBeLessThanOrEqual(1)
    expect(smoothed[2].y).toBeLessThanOrEqual(1)
  })
})
