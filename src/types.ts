export type FilterMode = 'color' | 'gray' | 'bw'
export type CornerDetectionMode = 'auto' | 'fallback' | 'manual'

export type Point = {
  x: number
  y: number
}

export type ScanPage = {
  id: string
  name: string
  dataUrl: string
  corners: [Point, Point, Point, Point]
  cornerDetection: CornerDetectionMode
  rotation: number
  filter: FilterMode
}
