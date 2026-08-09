/**
 * Book-mode page-turn detector: compare small grayscale frames after mean-brightness removal
 * and a tiny translational search so 1–2px camera wobble does not look like a new page.
 */

export const BOOK_PAGE_CHANGE_DELTA = 18
export const BOOK_PAGE_CHANGE_FRAMES = 2
export const BOOK_PAGE_CHANGE_MAX_SHIFT = 2
export const BOOK_PAGE_CHANGE_MARGIN = 3

const grayAt = (data: Uint8ClampedArray, index: number) =>
  data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114

const madAtShift = (
  previous: ImageData,
  current: ImageData,
  dx: number,
  dy: number,
  margin: number
) => {
  const { width, height } = current
  const x0 = Math.max(margin, margin - dx)
  const y0 = Math.max(margin, margin - dy)
  const x1 = Math.min(width - margin, width - margin - dx)
  const y1 = Math.min(height - margin, height - margin - dy)
  if (x1 <= x0 || y1 <= y0) return Infinity

  let prevMean = 0
  let currMean = 0
  let samples = 0
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const pi = (y * width + x) * 4
      const ci = ((y + dy) * width + (x + dx)) * 4
      prevMean += grayAt(previous.data, pi)
      currMean += grayAt(current.data, ci)
      samples += 1
    }
  }
  if (!samples) return Infinity
  prevMean /= samples
  currMean /= samples

  let total = 0
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const pi = (y * width + x) * 4
      const ci = ((y + dy) * width + (x + dx)) * 4
      const prev = grayAt(previous.data, pi) - prevMean
      const curr = grayAt(current.data, ci) - currMean
      total += Math.abs(curr - prev)
    }
  }
  return total / samples
}

/**
 * Best (lowest) mean-abs residual after trying ±MAX_SHIFT translations.
 * Brightness-normalized on the overlapping region for each shift.
 */
export const bookPageDifference = (
  previous: ImageData,
  current: ImageData,
  maxShift = BOOK_PAGE_CHANGE_MAX_SHIFT,
  margin = BOOK_PAGE_CHANGE_MARGIN
): number => {
  if (previous.data.length !== current.data.length) return Infinity
  if (previous.width !== current.width || previous.height !== current.height) return Infinity

  let best = Infinity
  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      const score = madAtShift(previous, current, dx, dy, margin)
      if (score < best) best = score
    }
  }
  return best
}

export const isBookPageChange = (difference: number, threshold = BOOK_PAGE_CHANGE_DELTA) =>
  difference >= threshold

/** Consecutive-frame streak helper for CameraView re-arm gating. */
export const nextBookChangeStreak = (streak: number, changed: boolean) => (changed ? streak + 1 : 0)

export const shouldReArmBookPage = (streak: number, needed = BOOK_PAGE_CHANGE_FRAMES) =>
  streak >= needed

/** Whether auto shutter may fire (manual/auto capture gate). */
export const canAutoCaptureFire = (capturing: boolean, captureProcessing: boolean) =>
  !capturing && !captureProcessing
