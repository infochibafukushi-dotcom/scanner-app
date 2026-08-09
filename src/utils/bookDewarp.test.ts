import { describe, expect, it } from 'vitest'
import {
  detectSpineWithConfidence,
  detectSpineX,
  estimateCylinderParams,
  estimateTextLineCurl,
  normalizeBookFlatten
} from './bookDewarp'

const makeFlatGray = (width: number, height: number, fill = 220) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill
    data[i + 1] = fill
    data[i + 2] = fill
    data[i + 3] = 255
  }
  return data
}

describe('bookDewarp', () => {
  it('normalizes legacy flatten flags', () => {
    expect(normalizeBookFlatten(undefined)).toBe('off')
    expect(normalizeBookFlatten(false)).toBe('off')
    expect(normalizeBookFlatten(true)).toBe('precise')
    expect(normalizeBookFlatten('simple')).toBe('simple')
    expect(normalizeBookFlatten('precise')).toBe('precise')
  })

  it('detects a dark spine column with higher confidence than a flat page', () => {
    const width = 180
    const height = 100
    const withSpine = makeFlatGray(width, height, 230)
    const spine = 100
    for (let y = 0; y < height; y += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = spine + dx
        const i = (y * width + x) * 4
        withSpine[i] = withSpine[i + 1] = withSpine[i + 2] = 35
      }
    }
    const detected = detectSpineWithConfidence(withSpine, width, height)
    expect(detected.spineX).toBeGreaterThan(90)
    expect(detected.spineX).toBeLessThan(110)
    expect(detected.confidence).toBeGreaterThan(0.35)

    const flat = detectSpineWithConfidence(makeFlatGray(width, height, 230), width, height)
    expect(flat.confidence).toBeLessThan(detected.confidence)
  })

  it('keeps detectSpineX compatible', () => {
    const width = 120
    const height = 80
    const data = makeFlatGray(width, height, 200)
    expect(detectSpineX(data, width, height)).toBeGreaterThan(0)
  })

  it('estimates stable cylinder params', () => {
    const params = estimateCylinderParams(800, 1000, 400, 8, 10, 0.4)
    expect(params.radius).toBeGreaterThan(200)
    expect(params.thetaMax).toBeGreaterThan(0.35)
    expect(params.thetaMax).toBeLessThan(1.1)
    expect(params.viewDistance).toBeGreaterThan(params.radius)
  })

  it('gives low curl confidence on flat pages', () => {
    const width = 160
    const height = 120
    const data = makeFlatGray(width, height, 240)
    for (let x = 10; x < width - 10; x += 1) {
      const i = (60 * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 20
    }
    const curl = estimateTextLineCurl(data, width, height, 80)
    expect(curl.confidence).toBeLessThan(0.55)
  })
})
