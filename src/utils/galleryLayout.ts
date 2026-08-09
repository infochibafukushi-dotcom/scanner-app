export type GalleryLayoutMode = 'single' | 'grid'

/** Choose gallery presentation: one large card vs multi-column grid. */
export const getGalleryLayout = (pageCount: number): GalleryLayoutMode =>
  pageCount === 1 ? 'single' : 'grid'
