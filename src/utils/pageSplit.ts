import { defaultCorners } from './image'

/** Split a page image into left/right halves (facing-page / 見開き). */
export const splitDataUrlVertically = async (dataUrl: string): Promise<[string, string]> => {
  const image = await loadImage(dataUrl)
  const mid = Math.max(1, Math.floor(image.width / 2))
  const left = cropToDataUrl(image, 0, 0, mid, image.height)
  const right = cropToDataUrl(image, mid, 0, image.width - mid, image.height)
  return [left, right]
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('画像を読み込めませんでした'))
    image.src = src
  })

const cropToDataUrl = (
  image: HTMLImageElement,
  sx: number,
  sy: number,
  width: number,
  height: number
) => {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context could not be created.')
  ctx.drawImage(image, sx, sy, width, height, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.95)
}

export const freshCorners = () => defaultCorners()
