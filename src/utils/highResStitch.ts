import { loadImage } from './image'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const SHOT_ORDER = ['左上', '右上', '右下', '左下'] as const
export type HighResShotPosition = (typeof SHOT_ORDER)[number]

export const HIGH_RES_SHOT_ORDER = SHOT_ORDER

const averageLuminance = (data: Uint8ClampedArray) => {
  let total = 0
  let count = 0
  const step = 16
  for (let i = 0; i < data.length; i += 4 * step) {
    total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    count += 1
  }
  return count ? total / count : 128
}

const createTile = async (dataUrl: string, width: number, height: number) => {
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas context could not be created.')

  // Keep the center of every capture. The guide asks the user to overlap adjacent
  // areas, so cropping a small outer margin removes the least reliable borders.
  const cropRatio = 0.94
  const sourceWidth = image.width * cropRatio
  const sourceHeight = image.height * cropRatio
  const sourceX = (image.width - sourceWidth) / 2
  const sourceY = (image.height - sourceHeight) / 2
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

const edgeWeight = (
  coordinate: number,
  size: number,
  overlap: number,
  fadeStart: boolean,
  fadeEnd: boolean
) => {
  let weight = 1
  if (fadeStart && coordinate < overlap) weight *= clamp(coordinate / Math.max(1, overlap), 0.05, 1)
  if (fadeEnd && coordinate > size - overlap) weight *= clamp((size - coordinate) / Math.max(1, overlap), 0.05, 1)
  return weight
}

/**
 * Combine four guided captures in this order:
 * 0: top-left, 1: top-right, 2: bottom-right, 3: bottom-left.
 *
 * This first implementation intentionally avoids a large OpenCV dependency.
 * It assumes the user follows the on-screen guide and keeps about 30% overlap.
 * The overlapping zones are exposure-balanced and feather blended so seams are
 * less visible before the existing document-corner and perspective pipeline.
 */
export const stitchHighResCaptures = async (dataUrls: string[]) => {
  if (dataUrls.length !== 4) throw new Error('高精細スキャンには4枚の写真が必要です。')

  const first = await loadImage(dataUrls[0])
  const sourceMax = Math.max(first.width, first.height)
  const tileScale = Math.min(1, 1800 / Math.max(1, sourceMax))
  const tileWidth = Math.max(640, Math.round(first.width * tileScale))
  const tileHeight = Math.max(640, Math.round(first.height * tileScale))
  const overlapRatio = 0.3
  const overlapX = Math.max(80, Math.round(tileWidth * overlapRatio))
  const overlapY = Math.max(80, Math.round(tileHeight * overlapRatio))
  const stepX = tileWidth - overlapX
  const stepY = tileHeight - overlapY
  const outputWidth = tileWidth + stepX
  const outputHeight = tileHeight + stepY

  const tiles = await Promise.all(dataUrls.map((dataUrl) => createTile(dataUrl, tileWidth, tileHeight)))
  const luminances = tiles.map((tile) => averageLuminance(tile.data))
  const sorted = [...luminances].sort((a, b) => a - b)
  const targetLuminance = (sorted[1] + sorted[2]) / 2
  const exposure = luminances.map((value) => clamp(targetLuminance / Math.max(18, value), 0.78, 1.28))

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = outputWidth
  outputCanvas.height = outputHeight
  const outputCtx = outputCanvas.getContext('2d')
  if (!outputCtx) throw new Error('Canvas context could not be created.')
  const output = outputCtx.createImageData(outputWidth, outputHeight)

  // Tile positions: TL, TR, BR, BL.
  const positions = [
    { x: 0, y: 0, col: 0, row: 0 },
    { x: stepX, y: 0, col: 1, row: 0 },
    { x: stepX, y: stepY, col: 1, row: 1 },
    { x: 0, y: stepY, col: 0, row: 1 }
  ]

  const dst = output.data
  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      let totalWeight = 0
      let red = 0
      let green = 0
      let blue = 0

      for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
        const position = positions[tileIndex]
        const localX = x - position.x
        const localY = y - position.y
        if (localX < 0 || localY < 0 || localX >= tileWidth || localY >= tileHeight) continue

        const wx = edgeWeight(localX, tileWidth, overlapX, position.col === 1, position.col === 0)
        const wy = edgeWeight(localY, tileHeight, overlapY, position.row === 1, position.row === 0)
        const weight = wx * wy
        const sourceIndex = (Math.floor(localY) * tileWidth + Math.floor(localX)) * 4
        const source = tiles[tileIndex].data
        const gain = exposure[tileIndex]

        red += clamp(source[sourceIndex] * gain, 0, 255) * weight
        green += clamp(source[sourceIndex + 1] * gain, 0, 255) * weight
        blue += clamp(source[sourceIndex + 2] * gain, 0, 255) * weight
        totalWeight += weight
      }

      const outputIndex = (y * outputWidth + x) * 4
      const divisor = Math.max(0.001, totalWeight)
      dst[outputIndex] = Math.round(red / divisor)
      dst[outputIndex + 1] = Math.round(green / divisor)
      dst[outputIndex + 2] = Math.round(blue / divisor)
      dst[outputIndex + 3] = 255
    }
  }

  outputCtx.putImageData(output, 0, 0)
  return outputCanvas.toDataURL('image/jpeg', 0.96)
}
