/**
 * Book-mode page-turn detector: compare small grayscale frames after mean-brightness removal
 * so global lighting shifts alone do not re-arm auto capture.
 */

export const BOOK_PAGE_CHANGE_DELTA = 18
export const BOOK_PAGE_CHANGE_FRAMES = 2

const grayAt = (data: Uint8ClampedArray, index: number) =>
  data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114

/** Mean absolute residual difference after subtracting each frame's mean luminance. */
export const bookPageDifference = (previous: ImageData, current: ImageData): number => {
  if (previous.data.length !== current.data.length) return Infinity

  const step = 4
  let prevMean = 0
  let currMean = 0
  let samples = 0
  for (let i = 0; i < current.data.length; i += step * 4) {
    prevMean += grayAt(previous.data, i)
    currMean += grayAt(current.data, i)
    samples += 1
  }
  prevMean /= Math.max(1, samples)
  currMean /= Math.max(1, samples)

  let total = 0
  for (let i = 0; i < current.data.length; i += step * 4) {
    const prev = grayAt(previous.data, i) - prevMean
    const curr = grayAt(current.data, i) - currMean
    total += Math.abs(curr - prev)
  }
  return total / Math.max(1, samples)
}

export const isBookPageChange = (difference: number, threshold = BOOK_PAGE_CHANGE_DELTA) =>
  difference >= threshold

/** Consecutive-frame streak helper for CameraView re-arm gating. */
export const nextBookChangeStreak = (streak: number, changed: boolean) => (changed ? streak + 1 : 0)

export const shouldReArmBookPage = (streak: number, needed = BOOK_PAGE_CHANGE_FRAMES) =>
  streak >= needed
