/** Rectangle of the actually rendered image under object-fit: contain. */
export type DisplayRect = {
  left: number
  top: number
  width: number
  height: number
}

export type NormPoint = { x: number; y: number }

export type ViewportTransform = { scale: number; x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * object-fit: contain equivalent — the image's painted box inside a container.
 * Portrait images get left/right letterbox; landscape gets top/bottom.
 */
export const getContainedImageRect = (
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
): DisplayRect => {
  const cw = Math.max(0, containerWidth)
  const ch = Math.max(0, containerHeight)
  if (cw <= 0 || ch <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { left: 0, top: 0, width: cw, height: ch }
  }

  const containerRatio = cw / ch
  const imageRatio = imageWidth / imageHeight

  if (imageRatio > containerRatio) {
    const width = cw
    const height = cw / imageRatio
    return { left: 0, top: (ch - height) / 2, width, height }
  }

  const height = ch
  const width = ch * imageRatio
  return { left: (cw - width) / 2, top: 0, width, height }
}

export const normalizedToLocalPoint = (normalized: NormPoint, rect: DisplayRect): NormPoint => ({
  x: rect.left + normalized.x * rect.width,
  y: rect.top + normalized.y * rect.height
})

export const localPointToNormalized = (local: NormPoint, rect: DisplayRect): NormPoint => {
  const width = Math.max(1e-6, rect.width)
  const height = Math.max(1e-6, rect.height)
  return {
    x: clamp((local.x - rect.left) / width, 0, 1),
    y: clamp((local.y - rect.top) / height, 0, 1)
  }
}

/** Map a pointer (client) position through pan/zoom into normalized image coords (clamped). */
export const screenPointToNormalized = (
  clientX: number,
  clientY: number,
  containerLeft: number,
  containerTop: number,
  displayRect: DisplayRect,
  view: ViewportTransform
): NormPoint => {
  const scale = Math.max(0.01, view.scale)
  const localX = (clientX - containerLeft - view.x) / scale
  const localY = (clientY - containerTop - view.y) / scale
  return localPointToNormalized({ x: localX, y: localY }, displayRect)
}

export const normalizedToScreenPoint = (
  normalized: NormPoint,
  containerLeft: number,
  containerTop: number,
  displayRect: DisplayRect,
  view: ViewportTransform
): NormPoint => {
  const local = normalizedToLocalPoint(normalized, displayRect)
  return {
    x: containerLeft + view.x + local.x * view.scale,
    y: containerTop + view.y + local.y * view.scale
  }
}

export const LOUPE_SIZE = {
  narrow: 160,
  phone: 170,
  wide: 180
} as const

export const LOUPE_OFFSET = 22

export const loupeSizeForWidth = (viewportWidth: number) => {
  if (viewportWidth >= 430) return LOUPE_SIZE.wide
  if (viewportWidth >= 390) return LOUPE_SIZE.phone
  return LOUPE_SIZE.narrow
}

/**
 * Place loupe opposite the active corner so it does not cover the handle.
 * Upper corners → below; lower → above; left → right; right → left.
 */
export const placeLoupeForCorner = (
  clientX: number,
  clientY: number,
  size: number,
  corner: NormPoint,
  viewportWidth: number,
  viewportHeight: number,
  options?: { topSafe?: number; bottomSafe?: number; margin?: number; offset?: number }
) => {
  const margin = options?.margin ?? 8
  const offset = options?.offset ?? LOUPE_OFFSET
  const topSafe = options?.topSafe ?? 48
  const bottomSafe = options?.bottomSafe ?? 96

  const preferBelow = corner.y < 0.5
  const preferRight = corner.x < 0.5

  let x = preferRight ? clientX + offset : clientX - size - offset
  let y = preferBelow ? clientY + offset : clientY - size - offset

  // If horizontal preference would clip heavily, flip once.
  if (x < margin) x = clientX + offset
  if (x + size > viewportWidth - margin) x = clientX - size - offset
  if (y < topSafe) y = clientY + offset
  if (y + size > viewportHeight - bottomSafe) y = clientY - size - offset

  x = clamp(x, margin, Math.max(margin, viewportWidth - size - margin))
  const maxY = Math.max(topSafe, viewportHeight - size - bottomSafe)
  y = clamp(y, topSafe, maxY)

  return { x, y }
}
