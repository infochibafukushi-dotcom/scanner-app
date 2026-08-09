/** Shared book-spine / gutter detection used by page split and book dewarp. */

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export type SpineDetection = {
  spineX: number
  confidence: number
}

/**
 * Find the darkest vertical gutter and score how spine-like it is.
 * Confidence uses contrast vs band median, uniqueness vs runner-up,
 * centrality, and vertical continuity of the dark column.
 */
export const detectSpineFromSampler = (
  width: number,
  height: number,
  sampleGray: (x: number, y: number) => number
): SpineDetection => {
  if (width < 8 || height < 8) {
    return { spineX: Math.floor(width / 2), confidence: 0 }
  }

  const start = Math.floor(width * 0.28)
  const end = Math.ceil(width * 0.72)
  const stepY = Math.max(1, Math.floor(height / 96))
  const scores: { x: number; mean: number; continuity: number }[] = []

  for (let x = start; x <= end; x += 1) {
    let sum = 0
    let count = 0
    let darkRuns = 0
    let run = 0
    for (let y = 0; y < height; y += stepY) {
      const g = sampleGray(x, y)
      sum += g
      count += 1
      if (g < 110) {
        run += 1
        darkRuns = Math.max(darkRuns, run)
      } else {
        run = 0
      }
    }
    const mean = sum / Math.max(1, count)
    const continuity = clamp(darkRuns / Math.max(1, count * 0.35), 0, 1)
    scores.push({ x, mean, continuity })
  }

  scores.sort((a, b) => a.mean - b.mean || b.continuity - a.continuity)
  const best = scores[0] ?? { x: Math.floor(width / 2), mean: 128, continuity: 0 }
  const second = scores[1] ?? best
  const median = scores[Math.floor(scores.length / 2)]?.mean ?? best.mean

  const contrast = clamp((median - best.mean) / 64, 0, 1)
  const margin = clamp((second.mean - best.mean) / 28, 0, 1)
  const centerBias = 1 - Math.min(1, Math.abs(best.x - width / 2) / (width * 0.28))
  // Extreme edges of the search band are less trustworthy.
  const edgePenalty =
    best.x <= start + 2 || best.x >= end - 2 ? 0.72 : 1

  const confidence = clamp(
    (contrast * 0.42 + margin * 0.22 + centerBias * 0.16 + best.continuity * 0.2) * edgePenalty,
    0,
    1
  )

  return {
    spineX: clamp(best.x, 1, width - 2),
    confidence
  }
}

export const detectSpineFromRgba = (
  data: Uint8ClampedArray,
  width: number,
  height: number
): SpineDetection =>
  detectSpineFromSampler(width, height, (x, y) => {
    const i = (y * width + x) * 4
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  })

/** Minimum spine confidence to auto-split a facing-page capture in book mode. */
export const SPINE_SPLIT_AUTO_CONFIDENCE = 0.5
