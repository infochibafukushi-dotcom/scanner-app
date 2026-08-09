import { describe, expect, it } from 'vitest'
import { detectSpineX, estimateCylinderParams, estimateTextLineCurl } from './bookDewarp'

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
  it('detects a dark spine column', () => {
    const width = 180
    const height = 100
    const data = makeFlatGray(width, height, 230)
    const spine = 100
    for (let y = 0; y < height; y += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const x = spine + dx
        const i = (y * width + x) * 4
        data[i] = data[i + 1] = data[i + 2] = 35
      }
    }
    expect(detectSpineX(data, width, height)).toBeGreaterThan(90)
    expect(detectSpineX(data, width, height)).toBeLessThan(110)
  })

  it('estimates stable cylinder params', () => {
    const params = estimateCylinderParams(800, 1000, 400, 8, 10, 0.4)
    expect(params.radius).toBeGreaterThan(200)
    expect(params.thetaMax).toBeGreaterThan(0.35)
    expect(params.thetaMax).toBeLessThan(1.1)
    expect(params.viewDistance).toBeGreaterThan(params.radius)
  })

  it('returns near-zero curl on flat noise-free page', () => {
    const width = 160
    const height = 120
    const data = makeFlatGray(width, height, 240)
    // Draw a straight dark text line
    for (let x = 10; x < width - 10; x += 1) {
      const i = (60 * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 20
    }
    const curl = estimateTextLineCurl(data, width, height, 80)
    expect(Math.abs(curl.left)).toBeLessThan(height * 0.05)
    expect(Math.abs(curl.right)).toBeLessThan(height * 0.05)
  })
})
