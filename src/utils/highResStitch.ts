import { loadImage } from './image'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const SHOT_ORDER = ['左上', '右上', '右下', '左下'] as const
export type HighResShotPosition = (typeof SHOT_ORDER)[number]

export const HIGH_RES_SHOT_ORDER = SHOT_ORDER

type EdgeMap = {
  width: number
  height: number
  data: Float32Array
}

type Alignment = {
  dx: number
  dy: number
  correlation: number
  overlapRatio: number
}

type TilePosition = {
  x: number
  y: number
}

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

  const cropRatio = 0.97
  const sourceWidth = image.width * cropRatio
  const sourceHeight = image.height * cropRatio
  const sourceX = (image.width - sourceWidth) / 2
  const sourceY = (image.height - sourceHeight) / 2
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

const createEdgeMap = (imageData: ImageData, maxSide = 190): EdgeMap => {
  const sourceWidth = imageData.width
  const sourceHeight = imageData.height
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(72, Math.round(sourceWidth * scale))
  const height = Math.max(72, Math.round(sourceHeight * scale))
  const gray = new Float32Array(width * height)
  const src = imageData.data

  for (let y = 0; y < height; y += 1) {
    const sy = clamp(Math.round(((y + 0.5) / height) * sourceHeight - 0.5), 0, sourceHeight - 1)
    for (let x = 0; x < width; x += 1) {
      const sx = clamp(Math.round(((x + 0.5) / width) * sourceWidth - 0.5), 0, sourceWidth - 1)
      const index = (sy * sourceWidth + sx) * 4
      gray[y * width + x] = src[index] * 0.299 + src[index + 1] * 0.587 + src[index + 2] * 0.114
    }
  }

  const edges = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const horizontal = gray[y * width + x + 1] - gray[y * width + x - 1]
      const vertical = gray[(y + 1) * width + x] - gray[(y - 1) * width + x]
      edges[y * width + x] = Math.min(255, Math.abs(horizontal) + Math.abs(vertical))
    }
  }

  return { width, height, data: edges }
}

const scoreOffset = (a: EdgeMap, b: EdgeMap, dx: number, dy: number, sampleStep: number) => {
  const xStart = Math.max(1, dx + 1)
  const yStart = Math.max(1, dy + 1)
  const xEnd = Math.min(a.width - 1, dx + b.width - 1)
  const yEnd = Math.min(a.height - 1, dy + b.height - 1)
  const overlapWidth = xEnd - xStart
  const overlapHeight = yEnd - yStart
  if (overlapWidth < a.width * 0.12 || overlapHeight < a.height * 0.12) return null

  let count = 0
  let sumA = 0
  let sumB = 0
  let sumAA = 0
  let sumBB = 0
  let sumAB = 0

  for (let y = yStart; y < yEnd; y += sampleStep) {
    const by = y - dy
    for (let x = xStart; x < xEnd; x += sampleStep) {
      const bx = x - dx
      const av = a.data[y * a.width + x]
      const bv = b.data[by * b.width + bx]
      sumA += av
      sumB += bv
      sumAA += av * av
      sumBB += bv * bv
      sumAB += av * bv
      count += 1
    }
  }

  if (count < 120) return null
  const numerator = count * sumAB - sumA * sumB
  const denominatorA = count * sumAA - sumA * sumA
  const denominatorB = count * sumBB - sumB * sumB
  const denominator = Math.sqrt(Math.max(1e-6, denominatorA * denominatorB))
  const correlation = numerator / denominator
  const overlapRatio = (overlapWidth * overlapHeight) / (a.width * a.height)

  return {
    correlation,
    overlapRatio,
    score: correlation + Math.min(0.04, overlapRatio * 0.06)
  }
}

const findBestAlignment = (a: EdgeMap, b: EdgeMap, direction: 'horizontal' | 'vertical'): Alignment => {
  const coarse = Math.max(2, Math.round(Math.min(a.width, a.height) / 45))
  const horizontal = direction === 'horizontal'

  const dxMin = horizontal ? Math.round(a.width * 0.04) : -Math.round(a.width * 0.38)
  const dxMax = horizontal ? Math.round(a.width * 0.9) : Math.round(a.width * 0.38)
  const dyMin = horizontal ? -Math.round(a.height * 0.38) : Math.round(a.height * 0.04)
  const dyMax = horizontal ? Math.round(a.height * 0.38) : Math.round(a.height * 0.9)

  let best: (Alignment & { score: number }) | null = null

  for (let dy = dyMin; dy <= dyMax; dy += coarse) {
    for (let dx = dxMin; dx <= dxMax; dx += coarse) {
      const result = scoreOffset(a, b, dx, dy, 3)
      if (!result) continue
      if (!best || result.score > best.score) best = { dx, dy, ...result }
    }
  }

  if (!best) throw new Error('重複部分を検出できませんでした。隣の範囲を40%ほど重ねて撮影してください。')

  const refineRadius = coarse * 2
  const coarseBest = best
  for (let dy = coarseBest.dy - refineRadius; dy <= coarseBest.dy + refineRadius; dy += 1) {
    for (let dx = coarseBest.dx - refineRadius; dx <= coarseBest.dx + refineRadius; dx += 1) {
      const result = scoreOffset(a, b, dx, dy, 2)
      if (!result) continue
      if (result.score > best.score) best = { dx, dy, ...result }
    }
  }

  if (best.correlation < 0.12 || best.overlapRatio < 0.12) {
    throw new Error('4枚の位置合わせ精度が不足しています。距離と角度を保ち、隣の範囲を40%ほど重ねて撮影してください。')
  }

  return best
}

const featherWeight = (x: number, y: number, width: number, height: number) => {
  const featherX = Math.max(24, width * 0.16)
  const featherY = Math.max(24, height * 0.16)
  const wx = Math.min(1, x / featherX, (width - 1 - x) / featherX)
  const wy = Math.min(1, y / featherY, (height - 1 - y) / featherY)
  return Math.max(0.035, Math.min(wx, wy))
}

const alignmentToPixels = (alignment: Alignment, map: EdgeMap, tileWidth: number, tileHeight: number) => ({
  x: alignment.dx * (tileWidth / map.width),
  y: alignment.dy * (tileHeight / map.height)
})

const weightedAverage = (a: number, aWeight: number, b: number, bWeight: number) => {
  const total = Math.max(1e-6, aWeight + bWeight)
  return (a * aWeight + b * bWeight) / total
}

export const stitchHighResCaptures = async (dataUrls: string[]) => {
  if (dataUrls.length !== 4) throw new Error('高精細スキャンには4枚の写真が必要です。')

  const first = await loadImage(dataUrls[0])
  const sourceMax = Math.max(first.width, first.height)
  const tileScale = Math.min(1, 1800 / Math.max(1, sourceMax))
  const tileWidth = Math.max(640, Math.round(first.width * tileScale))
  const tileHeight = Math.max(640, Math.round(first.height * tileScale))

  const tiles = await Promise.all(dataUrls.map((dataUrl) => createTile(dataUrl, tileWidth, tileHeight)))
  const maps = tiles.map((tile) => createEdgeMap(tile))

  const top = findBestAlignment(maps[0], maps[1], 'horizontal')
  const left = findBestAlignment(maps[0], maps[3], 'vertical')
  const right = findBestAlignment(maps[1], maps[2], 'vertical')
  const bottom = findBestAlignment(maps[3], maps[2], 'horizontal')

  const topShift = alignmentToPixels(top, maps[0], tileWidth, tileHeight)
  const leftShift = alignmentToPixels(left, maps[0], tileWidth, tileHeight)
  const rightShift = alignmentToPixels(right, maps[1], tileWidth, tileHeight)
  const bottomShift = alignmentToPixels(bottom, maps[3], tileWidth, tileHeight)

  const positions: TilePosition[] = [
    { x: 0, y: 0 },
    { x: topShift.x, y: topShift.y },
    { x: 0, y: 0 },
    { x: leftShift.x, y: leftShift.y }
  ]

  const brFromTopRight = {
    x: positions[1].x + rightShift.x,
    y: positions[1].y + rightShift.y
  }
  const brFromBottomLeft = {
    x: positions[3].x + bottomShift.x,
    y: positions[3].y + bottomShift.y
  }

  const disagreement = Math.hypot(
    brFromTopRight.x - brFromBottomLeft.x,
    brFromTopRight.y - brFromBottomLeft.y
  )
  if (disagreement > Math.min(tileWidth, tileHeight) * 0.2) {
    throw new Error('4枚の位置関係が一致しません。端末の距離と傾きをなるべく一定にして撮影し直してください。')
  }

  const rightWeight = Math.max(0.05, right.correlation)
  const bottomWeight = Math.max(0.05, bottom.correlation)
  positions[2] = {
    x: weightedAverage(brFromTopRight.x, rightWeight, brFromBottomLeft.x, bottomWeight),
    y: weightedAverage(brFromTopRight.y, rightWeight, brFromBottomLeft.y, bottomWeight)
  }

  const minX = Math.floor(Math.min(...positions.map((position) => position.x)))
  const minY = Math.floor(Math.min(...positions.map((position) => position.y)))
  const maxX = Math.ceil(Math.max(...positions.map((position) => position.x + tileWidth)))
  const maxY = Math.ceil(Math.max(...positions.map((position) => position.y + tileHeight)))
  const outputWidth = Math.max(1, maxX - minX)
  const outputHeight = Math.max(1, maxY - minY)
  const offsetPositions = positions.map((position) => ({
    x: position.x - minX,
    y: position.y - minY
  }))

  const luminances = tiles.map((tile) => averageLuminance(tile.data))
  const sorted = [...luminances].sort((a, b) => a - b)
  const targetLuminance = (sorted[1] + sorted[2]) / 2
  const exposure = luminances.map((value) => clamp(targetLuminance / Math.max(18, value), 0.8, 1.25))

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = outputWidth
  outputCanvas.height = outputHeight
  const outputCtx = outputCanvas.getContext('2d')
  if (!outputCtx) throw new Error('Canvas context could not be created.')
  const output = outputCtx.createImageData(outputWidth, outputHeight)
  const dst = output.data

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      let totalWeight = 0
      let red = 0
      let green = 0
      let blue = 0

      for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
        const position = offsetPositions[tileIndex]
        const localX = x - position.x
        const localY = y - position.y
        if (localX < 0 || localY < 0 || localX >= tileWidth || localY >= tileHeight) continue

        const sx = Math.floor(localX)
        const sy = Math.floor(localY)
        const sourceIndex = (sy * tileWidth + sx) * 4
        const source = tiles[tileIndex].data
        const gain = exposure[tileIndex]
        const weight = featherWeight(localX, localY, tileWidth, tileHeight)

        red += clamp(source[sourceIndex] * gain, 0, 255) * weight
        green += clamp(source[sourceIndex + 1] * gain, 0, 255) * weight
        blue += clamp(source[sourceIndex + 2] * gain, 0, 255) * weight
        totalWeight += weight
      }

      const outputIndex = (y * outputWidth + x) * 4
      if (totalWeight <= 0.001) {
        dst[outputIndex] = 245
        dst[outputIndex + 1] = 245
        dst[outputIndex + 2] = 245
        dst[outputIndex + 3] = 255
        continue
      }

      dst[outputIndex] = Math.round(red / totalWeight)
      dst[outputIndex + 1] = Math.round(green / totalWeight)
      dst[outputIndex + 2] = Math.round(blue / totalWeight)
      dst[outputIndex + 3] = 255
    }
  }

  outputCtx.putImageData(output, 0, 0)
  return outputCanvas.toDataURL('image/jpeg', 0.96)
}
