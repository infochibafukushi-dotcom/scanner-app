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

type PixelCandidate = {
  score: number
  r: number
  g: number
  b: number
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

  const dxMin = horizontal ? Math.round(a.width * 0.04) : -Math.round(a.width * 0.32)
  const dxMax = horizontal ? Math.round(a.width * 0.88) : Math.round(a.width * 0.32)
  const dyMin = horizontal ? -Math.round(a.height * 0.32) : Math.round(a.height * 0.04)
  const dyMax = horizontal ? Math.round(a.height * 0.32) : Math.round(a.height * 0.88)

  let best: (Alignment & { score: number }) | null = null

  for (let dy = dyMin; dy <= dyMax; dy += coarse) {
    for (let dx = dxMin; dx <= dxMax; dx += coarse) {
      const result = scoreOffset(a, b, dx, dy, 3)
      if (!result) continue
      if (!best || result.score > best.score) best = { dx, dy, ...result }
    }
  }

  if (!best) throw new Error('重複部分を検出できませんでした。隣の範囲を35〜45%ほど重ねて撮影してください。')

  const refineRadius = coarse * 2
  const coarseBest = best
  for (let dy = coarseBest.dy - refineRadius; dy <= coarseBest.dy + refineRadius; dy += 1) {
    for (let dx = coarseBest.dx - refineRadius; dx <= coarseBest.dx + refineRadius; dx += 1) {
      const result = scoreOffset(a, b, dx, dy, 2)
      if (!result) continue
      if (result.score > best.score) best = { dx, dy, ...result }
    }
  }

  if (best.correlation < 0.18 || best.overlapRatio < 0.12) {
    throw new Error('4枚の位置合わせ精度が不足しています。紙の1/4を大きく写し、隣の範囲を35〜45%重ねてください。')
  }

  return best
}

const alignmentToPixels = (alignment: Alignment, map: EdgeMap, tileWidth: number, tileHeight: number) => ({
  x: alignment.dx * (tileWidth / map.width),
  y: alignment.dy * (tileHeight / map.height)
})

const validateGuidedShift = (
  shift: { x: number; y: number },
  direction: 'horizontal' | 'vertical',
  tileWidth: number,
  tileHeight: number
) => {
  if (direction === 'horizontal') {
    const movement = shift.x / tileWidth
    const cross = Math.abs(shift.y) / tileHeight
    if (movement < 0.2) {
      throw new Error('同じ範囲を撮りすぎています。紙全体ではなく、左上・右上など各1/4を画面いっぱいに大きく撮影してください。')
    }
    if (movement > 0.82) {
      throw new Error('左右の写真の重なりが不足しています。隣の写真と35〜45%重なるように撮影してください。')
    }
    if (cross > 0.24) {
      throw new Error('左右移動時の上下ずれが大きすぎます。スマホの高さと傾きを保って横へ移動してください。')
    }
    return
  }

  const movement = shift.y / tileHeight
  const cross = Math.abs(shift.x) / tileWidth
  if (movement < 0.2) {
    throw new Error('同じ範囲を撮りすぎています。紙全体ではなく、上側・下側の各1/4を画面いっぱいに大きく撮影してください。')
  }
  if (movement > 0.82) {
    throw new Error('上下の写真の重なりが不足しています。隣の写真と35〜45%重なるように撮影してください。')
  }
  if (cross > 0.24) {
    throw new Error('上下移動時の左右ずれが大きすぎます。スマホの高さと傾きを保って縦へ移動してください。')
  }
}

const weightedAverage = (a: number, aWeight: number, b: number, bWeight: number) => {
  const total = Math.max(1e-6, aWeight + bWeight)
  return (a * aWeight + b * bWeight) / total
}

const centerScore = (x: number, y: number, width: number, height: number) => {
  const nx = Math.abs(x - (width - 1) / 2) / Math.max(1, width / 2)
  const ny = Math.abs(y - (height - 1) / 2) / Math.max(1, height / 2)
  return clamp(1 - Math.max(nx, ny), 0.001, 1)
}

const pushCandidate = (
  candidates: PixelCandidate[],
  source: Uint8ClampedArray,
  sourceIndex: number,
  gain: number,
  score: number
) => {
  candidates.push({
    score,
    r: clamp(source[sourceIndex] * gain, 0, 255),
    g: clamp(source[sourceIndex + 1] * gain, 0, 255),
    b: clamp(source[sourceIndex + 2] * gain, 0, 255)
  })
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

  validateGuidedShift(topShift, 'horizontal', tileWidth, tileHeight)
  validateGuidedShift(leftShift, 'vertical', tileWidth, tileHeight)
  validateGuidedShift(rightShift, 'vertical', tileWidth, tileHeight)
  validateGuidedShift(bottomShift, 'horizontal', tileWidth, tileHeight)

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
  if (disagreement > Math.min(tileWidth, tileHeight) * 0.14) {
    throw new Error('4枚の位置関係が一致しません。スマホの高さ・距離・傾きをなるべく一定にして撮影し直してください。')
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
  const exposure = luminances.map((value) => clamp(targetLuminance / Math.max(18, value), 0.82, 1.22))

  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = outputWidth
  outputCanvas.height = outputHeight
  const outputCtx = outputCanvas.getContext('2d')
  if (!outputCtx) throw new Error('Canvas context could not be created.')
  const output = outputCtx.createImageData(outputWidth, outputHeight)
  const dst = output.data

  for (let y = 0; y < outputHeight; y += 1) {
    for (let x = 0; x < outputWidth; x += 1) {
      const candidates: PixelCandidate[] = []

      for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
        const position = offsetPositions[tileIndex]
        const localX = x - position.x
        const localY = y - position.y
        if (localX < 0 || localY < 0 || localX >= tileWidth || localY >= tileHeight) continue

        const sx = Math.floor(localX)
        const sy = Math.floor(localY)
        const sourceIndex = (sy * tileWidth + sx) * 4
        const score = centerScore(localX, localY, tileWidth, tileHeight)
        pushCandidate(candidates, tiles[tileIndex].data, sourceIndex, exposure[tileIndex], score)
      }

      const outputIndex = (y * outputWidth + x) * 4
      if (!candidates.length) {
        dst[outputIndex] = 245
        dst[outputIndex + 1] = 245
        dst[outputIndex + 2] = 245
        dst[outputIndex + 3] = 255
        continue
      }

      candidates.sort((a, b) => b.score - a.score)
      const best = candidates[0]
      const second = candidates[1]

      // Prefer one sharp source in overlap areas. Only blend inside a very narrow
      // score tie zone; broad averaging was the cause of doubled/blurred text.
      if (second && Math.abs(best.score - second.score) < 0.025) {
        dst[outputIndex] = Math.round((best.r + second.r) / 2)
        dst[outputIndex + 1] = Math.round((best.g + second.g) / 2)
        dst[outputIndex + 2] = Math.round((best.b + second.b) / 2)
      } else {
        dst[outputIndex] = Math.round(best.r)
        dst[outputIndex + 1] = Math.round(best.g)
        dst[outputIndex + 2] = Math.round(best.b)
      }
      dst[outputIndex + 3] = 255
    }
  }

  outputCtx.putImageData(output, 0, 0)
  return outputCanvas.toDataURL('image/jpeg', 0.97)
}
