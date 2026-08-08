import type { HighResStitchProgress, HighResStitchResult, HighResTileId } from '../types'
import { HIGH_RES_LABELS } from '../types'
import { analyzeCoverageFromHomography, evaluateHomographyMatrix, inspectStitchQuality } from './highResQuality'
import { loadOpenCv } from './opencvLoader'

type CanvasImage = { canvas: HTMLCanvasElement; scale: number }
type Alignment = { id: HighResTileId; H: number[]; center: { x: number; y: number }; detailScale: number }

const tileIds: HighResTileId[] = ['tl', 'tr', 'br', 'bl']
const expectedRegions: Record<HighResTileId, [number, number, number, number]> = {
  tl: [0, 0, 0.65, 0.65],
  tr: [0.35, 0, 1, 0.65],
  br: [0.35, 0.35, 1, 1],
  bl: [0, 0.35, 0.65, 1]
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

const toCanvas = async (src: string, maxSide: number): Promise<CanvasImage> => {
  const image = await loadImage(src)
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas を作成できませんでした。')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return { canvas, scale }
}

const matValues = (mat: any) => Array.from(mat.data64F ?? mat.data32F ?? mat.data).slice(0, 9) as number[]

const multiply3 = (a: number[], b: number[]) => {
  const out = new Array<number>(9).fill(0)
  for (let row = 0; row < 3; row += 1) for (let col = 0; col < 3; col += 1) {
    out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[col + 3] + a[row * 3 + 2] * b[col + 6]
  }
  return out
}

const invert3 = (m: number[]) => {
  const d = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  if (Math.abs(d) < 1e-10) return undefined
  return [(m[4] * m[8] - m[5] * m[7]) / d, (m[2] * m[7] - m[1] * m[8]) / d, (m[1] * m[5] - m[2] * m[4]) / d, (m[5] * m[6] - m[3] * m[8]) / d, (m[0] * m[8] - m[2] * m[6]) / d, (m[2] * m[3] - m[0] * m[5]) / d, (m[3] * m[7] - m[4] * m[6]) / d, (m[1] * m[6] - m[0] * m[7]) / d, (m[0] * m[4] - m[1] * m[3]) / d]
}

const apply = (h: number[], x: number, y: number) => {
  const d = h[6] * x + h[7] * y + h[8]
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d }
}

const paperLuminance = (image: ImageData) => {
  let sum = 0
  let count = 0
  for (let index = 0; index < image.data.length; index += 64) {
    const luminance = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114
    if (luminance > 160) {
      sum += luminance
      count += 1
    }
  }
  return count ? sum / count : 220
}

/** Ensures the supposedly detailed tile is a useful quadrant close-up. */
export const checkTileDetailEnough = (homography: ArrayLike<number>, tileW: number, tileH: number, refW: number, refH: number, id?: HighResTileId) => {
  const coverage = analyzeCoverageFromHomography(homography, tileW, tileH, refW, refH)
  if (coverage.areaRatio > 0.92) return { ok: false, message: '基準画像全体が写っています。指定位置をもっと近づけて撮影してください。' }
  if (coverage.areaRatio < 0.04 || coverage.intersectionRatio < 0.45) return { ok: false, message: '基準画像との重なりが不足しています。' }
  if (id) {
    const [x0, y0, x1, y1] = expectedRegions[id]
    const cx = (coverage.bbox.x + coverage.bbox.width / 2) / refW
    const cy = (coverage.bbox.y + coverage.bbox.height / 2) / refH
    if (cx < x0 - 0.18 || cx > x1 + 0.18 || cy < y0 - 0.18 || cy > y1 + 0.18) return { ok: false, message: `${HIGH_RES_LABELS[id]}の位置に合わせて撮影してください。` }
  }
  return { ok: true, message: '' }
}

export async function stitchHighRes(params: {
  baseDataUrl: string
  tiles: Record<HighResTileId, string>
  onProgress?: (p: HighResStitchProgress) => void
}): Promise<HighResStitchResult> {
  const progress = (stage: string, current: number, total: number) => params.onProgress?.({ stage, current, total })
  try {
    progress('OpenCV を準備中', 0, 6)
    const cv: any = await loadOpenCv()
    const [baseAnalysis, ...tileAnalysis] = await Promise.all([params.baseDataUrl, ...tileIds.map((id) => params.tiles[id])].map((url) => toCanvas(url, 1150)))
    const baseGray = cv.imread(baseAnalysis.canvas)
    cv.cvtColor(baseGray, baseGray, cv.COLOR_RGBA2GRAY)
    const orb = new cv.ORB(2000)
    const baseKeys = new cv.KeyPointVector()
    const baseDescriptors = new cv.Mat()
    orb.detectAndCompute(baseGray, new cv.Mat(), baseKeys, baseDescriptors)
    if (baseKeys.size() < 80) throw new Error('基準画像の特徴点が不足しています。文字や模様が見えるように撮影してください。')

    const alignments: Alignment[] = []
    const failedTiles: HighResTileId[] = []
    for (let index = 0; index < tileIds.length; index += 1) {
      const id = tileIds[index]
      progress(`${HIGH_RES_LABELS[id]}を位置合わせ中`, index + 1, 6)
      const tileMat = cv.imread(tileAnalysis[index].canvas)
      cv.cvtColor(tileMat, tileMat, cv.COLOR_RGBA2GRAY)
      const keys = new cv.KeyPointVector()
      const descriptors = new cv.Mat()
      const matches = new cv.DMatchVectorVector()
      const good = new cv.DMatchVector()
      const mask = new cv.Mat()
      let homography: any
      try {
        orb.detectAndCompute(tileMat, new cv.Mat(), keys, descriptors)
        if (keys.size() < 80 || descriptors.empty()) throw new Error('特徴点が不足しています。')
        const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false)
        matcher.knnMatch(descriptors, baseDescriptors, matches, 2)
        for (let i = 0; i < matches.size(); i += 1) {
          const pair = matches.get(i)
          if (pair.size() >= 2 && pair.get(0).distance < pair.get(1).distance * 0.75) good.push_back(pair.get(0))
          pair.delete()
        }
        matcher.delete()
        if (good.size() < 24) throw new Error('一致する特徴が少なすぎます。')
        const src = [], dst = []
        for (let i = 0; i < good.size(); i += 1) {
          const match = good.get(i)
          const from = keys.get(match.queryIdx).pt
          const to = baseKeys.get(match.trainIdx).pt
          src.push(from.x, from.y); dst.push(to.x, to.y)
        }
        const srcMat = cv.matFromArray(good.size(), 1, cv.CV_32FC2, src)
        const dstMat = cv.matFromArray(good.size(), 1, cv.CV_32FC2, dst)
        homography = cv.findHomography(srcMat, dstMat, cv.RANSAC, 3, mask)
        srcMat.delete(); dstMat.delete()
        const inliers = Array.from(mask.data as Uint8Array).filter(Boolean).length
        if (!homography || homography.empty() || inliers < 16 || inliers / good.size() < 0.42) throw new Error('位置合わせの信頼度が不足しています。')
        const raw = matValues(homography)
        const matrixQuality = evaluateHomographyMatrix(raw)
        const detail = checkTileDetailEnough(raw, tileAnalysis[index].canvas.width, tileAnalysis[index].canvas.height, baseAnalysis.canvas.width, baseAnalysis.canvas.height, id)
        if (!matrixQuality.ok || !detail.ok) throw new Error(matrixQuality.reason ?? detail.message)
        const full = multiply3([1 / baseAnalysis.scale, 0, 0, 0, 1 / baseAnalysis.scale, 0, 0, 0, 1], multiply3(raw, [tileAnalysis[index].scale, 0, 0, 0, tileAnalysis[index].scale, 0, 0, 0, 1]))
        const center = apply(full, tileAnalysis[index].canvas.width / (2 * tileAnalysis[index].scale), tileAnalysis[index].canvas.height / (2 * tileAnalysis[index].scale))
        alignments.push({ id, H: full, center, detailScale: 1 / Math.max(1e-5, matrixQuality.scale) })
      } catch {
        failedTiles.push(id)
      } finally {
        homography?.delete(); mask.delete(); good.delete(); matches.delete(); descriptors.delete(); keys.delete(); tileMat.delete()
      }
    }
    baseDescriptors.delete(); baseKeys.delete(); baseGray.delete(); orb.delete()
    if (failedTiles.length) return { ok: false, message: `${failedTiles.map((id) => HIGH_RES_LABELS[id]).join('・')}の位置合わせができませんでした。書類との距離を保ち、前の撮影範囲を少し多めに含めて撮り直してください。`, failedTiles, retakeHint: '基準画像と30〜40%重ね、文字が見える状態で近づけて撮影してください。' }

    progress('高解像度画像を合成中', 5, 6)
    const [base, ...tiles] = await Promise.all([params.baseDataUrl, ...tileIds.map((id) => params.tiles[id])].map((url) => toCanvas(url, 2800)))
    const outputScale = Math.min(1, 2600 / Math.max(base.canvas.width / base.scale, base.canvas.height / base.scale))
    const output = document.createElement('canvas')
    output.width = Math.max(1, Math.round(base.canvas.width / base.scale * outputScale))
    output.height = Math.max(1, Math.round(base.canvas.height / base.scale * outputScale))
    const outputContext = output.getContext('2d', { willReadFrequently: true })
    if (!outputContext) throw new Error('出力 Canvas を作成できませんでした。')
    const sourceData = [base, ...tiles].map(({ canvas }) => canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height))
    const basePaper = paperLuminance(sourceData[0])
    const transforms = alignments.map((alignment, index) => ({
      ...alignment,
      inverse: invert3(multiply3(alignment.H, [1 / tiles[index].scale, 0, 0, 0, 1 / tiles[index].scale, 0, 0, 0, 1]))!,
      image: sourceData[index + 1],
      gain: Math.max(0.82, Math.min(1.18, basePaper / paperLuminance(sourceData[index + 1])))
    }))
    const result = outputContext.createImageData(output.width, output.height)
    for (let y = 0; y < output.height; y += 1) for (let x = 0; x < output.width; x += 1) {
      const refX = x / outputScale, refY = y / outputScale
      const baseX = Math.min(base.canvas.width - 1, Math.max(0, Math.round(refX * base.scale)))
      const baseY = Math.min(base.canvas.height - 1, Math.max(0, Math.round(refY * base.scale)))
      let selected: ImageData | undefined, sx = 0, sy = 0, selectedGain = 1, best = Number.POSITIVE_INFINITY
      let runnerUp: { image: ImageData; x: number; y: number; distance: number; gain: number } | undefined
      for (const tile of transforms) {
        if (!tile.inverse) continue
        const point = apply(tile.inverse, refX, refY)
        if (point.x < 0 || point.y < 0 || point.x >= tile.image.width || point.y >= tile.image.height) continue
        const distance = Math.hypot(refX - tile.center.x, refY - tile.center.y) / tile.detailScale
        if (distance < best) {
          if (selected) runnerUp = { image: selected, x: sx, y: sy, distance: best, gain: selectedGain }
          best = distance
          selected = tile.image
          sx = Math.round(point.x)
          sy = Math.round(point.y)
          selectedGain = tile.gain
        } else if (!runnerUp || distance < runnerUp.distance) {
          runnerUp = { image: tile.image, x: Math.round(point.x), y: Math.round(point.y), distance, gain: tile.gain }
        }
      }
      if (!selected) { selected = sourceData[0]; sx = baseX; sy = baseY; selectedGain = 1; runnerUp = undefined }
      const from = (Math.min(selected.height - 1, Math.max(0, sy)) * selected.width + Math.min(selected.width - 1, Math.max(0, sx))) * 4
      const to = (y * output.width + x) * 4
      const feather = runnerUp ? Math.max(0, Math.min(0.06, (3 - Math.abs(best - runnerUp.distance)) / 50)) : 0
      if (runnerUp && feather > 0) {
        const other = (Math.min(runnerUp.image.height - 1, Math.max(0, runnerUp.y)) * runnerUp.image.width + Math.min(runnerUp.image.width - 1, Math.max(0, runnerUp.x))) * 4
        result.data[to] = Math.min(255, selected.data[from] * selectedGain) * (1 - feather) + Math.min(255, runnerUp.image.data[other] * runnerUp.gain) * feather
        result.data[to + 1] = Math.min(255, selected.data[from + 1] * selectedGain) * (1 - feather) + Math.min(255, runnerUp.image.data[other + 1] * runnerUp.gain) * feather
        result.data[to + 2] = Math.min(255, selected.data[from + 2] * selectedGain) * (1 - feather) + Math.min(255, runnerUp.image.data[other + 2] * runnerUp.gain) * feather
      } else {
        result.data[to] = Math.min(255, selected.data[from] * selectedGain)
        result.data[to + 1] = Math.min(255, selected.data[from + 1] * selectedGain)
        result.data[to + 2] = Math.min(255, selected.data[from + 2] * selectedGain)
      }
      result.data[to + 3] = 255
    }
    outputContext.putImageData(result, 0, 0)
    const inspection = inspectStitchQuality(result)
    progress('完了', 6, 6)
    return { ok: true, dataUrl: output.toDataURL('image/jpeg', 0.94), width: output.width, height: output.height, warnings: inspection.issues, qualityNotes: ['タイル境界は最も近い詳細画像を優先して合成しました。'] }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '高解像度合成に失敗しました。', failedTiles: tileIds, retakeHint: '通常スキャンとして保存するか、撮影をやり直してください。' }
  }
}
