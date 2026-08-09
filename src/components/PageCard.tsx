import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ScanPage } from '../types'
import {
  galleryThumbKey,
  getGalleryPlaceholder,
  getGalleryThumbUrl,
  subscribeGalleryPlaceholder
} from '../utils/galleryThumbs'

type Props = {
  page: ScanPage
  index: number
  onOpen: () => void
  onMenu: () => void
}

export function PageCard({ page, index, onOpen, onMenu }: Props) {
  const thumbKey = galleryThumbKey(page)
  const [thumb, setThumb] = useState<string | null>(null)
  const [placeholder, setPlaceholder] = useState<string | null>(() => getGalleryPlaceholder(page.id))
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 3 : undefined
  }

  useEffect(() => {
    setPlaceholder(getGalleryPlaceholder(page.id))
    return subscribeGalleryPlaceholder(page.id, () => {
      setPlaceholder(getGalleryPlaceholder(page.id))
    })
  }, [page.id])

  useEffect(() => {
    let cancelled = false
    // Keep showing the previous corrected thumb (or placeholder) while regenerating —
    // never flash back to "…" on OCR / translation-only updates.
    void getGalleryThumbUrl(page).then((url) => {
      if (!cancelled) setThumb(url)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- image-affecting fields only via thumbKey
  }, [thumbKey])

  const preview = thumb ?? placeholder

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`gallery-card ${isDragging ? 'dragging' : ''}`}
    >
      <div className="gallery-card-top">
        <span className="gallery-page-no">{index + 1}</span>
        <button
          type="button"
          className="drag-handle"
          aria-label={`${index + 1}ページを並べ替え`}
          {...attributes}
          {...listeners}
        >
          ≡
        </button>
      </div>
      <button type="button" className="gallery-card-image" onClick={onOpen}>
        {preview ? (
          <img
            src={preview}
            alt={`${index + 1}ページ`}
            className={thumb ? undefined : 'gallery-card-placeholder'}
          />
        ) : (
          <span className="thumb-loading">…</span>
        )}
      </button>
      <button type="button" className="gallery-menu-btn" onClick={onMenu} aria-label={`${index + 1}ページのメニュー`}>
        ⋯
      </button>
    </article>
  )
}
