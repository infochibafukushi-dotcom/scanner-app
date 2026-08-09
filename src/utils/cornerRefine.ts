import type { CornerDetectionMode, CornerDetectionResult, Point } from '../types'

export const averageCornerDistance = (
  a: [Point, Point, Point, Point],
  b: [Point, Point, Point, Point]
) => {
  let sum = 0
  for (let i = 0; i < 4; i += 1) sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y)
  return sum / 4
}

export type RefineCornersInput = {
  cornerDetection: CornerDetectionMode
  currentDataUrl: string
  refineDataUrl: string
  currentCorners: [Point, Point, Point, Point]
  currentConfidence: number
  still: CornerDetectionResult
}

/**
 * Decide whether a background still-frame detection should replace live/optimistic corners.
 * Only accept improvements — never demote a good live detection to defaults.
 */
export const shouldAcceptRefinedCorners = (input: RefineCornersInput): boolean => {
  if (input.cornerDetection === 'manual') return false
  if (input.currentDataUrl !== input.refineDataUrl) return false
  if (!input.still.detected) return false

  // Fallback / no live lock-in: accept any successful still detection.
  if (input.cornerDetection === 'fallback') return true

  const distance = averageCornerDistance(input.currentCorners, input.still.corners)
  if (distance <= 0.06) return true
  if (distance > 0.08) {
    return input.still.confidence >= input.currentConfidence + 0.12
  }
  // Mild drift (0.06–0.08): accept only if confidence does not get worse.
  return input.still.confidence >= input.currentConfidence
}
