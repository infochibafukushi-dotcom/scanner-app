import { describe, expect, it } from 'vitest'
import type { Point } from '../types'
import {
  guessAutoPaper,
  migratePaperSize,
  normalizePaperSize,
  resolveTargetAspect
} from './paper'

const quad = (aspectWidth: number, aspectHeight: number): [Point, Point, Point, Point] => {
  const width = aspectWidth / (aspectWidth + aspectHeight)
  const height = aspectHeight / (aspectWidth + aspectHeight)
  const x0 = (1 - width) / 2
  const y0 = (1 - height) / 2
  return [
    { x: x0, y: y0 },
    { x: x0 + width, y: y0 },
    { x: x0 + width, y: y0 + height },
    { x: x0, y: y0 + height }
  ]
}

describe('paper size migration', () => {
  it('normalizes legacy paperRatio values', () => {
    expect(migratePaperSize({ paperRatio: 'a4' })).toBe('a4')
    expect(migratePaperSize({ paperRatio: 'letter' })).toBe('letter')
    expect(migratePaperSize({ paperRatio: 'free' })).toBe('free')
    expect(migratePaperSize({ paperRatio: 'auto' })).toBe('auto')
  })

  it('prefers paperSize when both exist', () => {
    expect(migratePaperSize({ paperSize: 'a3', paperRatio: 'a4' })).toBe('a3')
  })

  it('accepts new paper sizes', () => {
    expect(normalizePaperSize('a5')).toBe('a5')
    expect(normalizePaperSize('business-card')).toBe('business-card')
  })
})

describe('auto paper guess', () => {
  it('detects A-series as A判 (a4 warp)', () => {
    const corners = quad(210, 297)
    const guess = guessAutoPaper(corners)
    expect(guess.kind).toBe('a-series')
    expect(guess.warpSize).toBe('a4')
  })

  it('detects letter', () => {
    const corners = quad(215.9, 279.4)
    expect(guessAutoPaper(corners).kind).toBe('letter')
  })

  it('detects business card near 91x55', () => {
    const corners = quad(91, 55)
    expect(guessAutoPaper(corners).kind).toBe('business-card')
  })

  it('keeps long receipts free', () => {
    const corners = quad(80, 300)
    expect(guessAutoPaper(corners).kind).toBe('free')
  })
})

describe('resolveTargetAspect', () => {
  it('keeps explicit a3/a4/a5 selection distinct while sharing ratio', () => {
    const corners = quad(210, 297)
    const a3 = resolveTargetAspect('a3', corners)
    const a4 = resolveTargetAspect('a4', corners)
    const a5 = resolveTargetAspect('a5', corners)
    expect(a3).toBeCloseTo(a4!, 5)
    expect(a4).toBeCloseTo(a5!, 5)
    expect(migratePaperSize({ paperSize: 'a3' })).toBe('a3')
  })

  it('uses business-card aspect and free returns null', () => {
    const card = quad(91, 55)
    expect(resolveTargetAspect('business-card', card)).toBeCloseTo(91 / 55, 5)
    expect(resolveTargetAspect('free', card)).toBeNull()
  })
})
