export type FilterMode = 'color' | 'gray' | 'bw'

export type Point = {
  x: number
  y: number
}

export type ScanPage = {
  id: string
  name: string
  dataUrl: string
  corners: [Point, Point, Point, Point]
  rotation: number
  filter: FilterMode
}
