import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { PageCard } from '../components/PageCard'
import type { ScanPage } from '../types'
import { getGalleryLayout } from '../utils/galleryLayout'
import { pruneGalleryThumbs } from '../utils/galleryThumbs'

type Props = {
  pages: ScanPage[]
  saveStatusLabel?: string
  storageWarning?: string | null
  onBackToCamera: () => void
  onOpenPage: (pageId: string) => void
  onReorder: (pages: ScanPage[]) => void
  onRetake: (pageId: string) => void
  onDelete: (pageId: string) => void
  onSplitPage: (pageId: string) => void
  onAddPages: () => void
  onSave: () => void
  onNewDocument: () => void
}

export function GalleryView({
  pages,
  saveStatusLabel,
  storageWarning,
  onBackToCamera,
  onOpenPage,
  onReorder,
  onRetake,
  onDelete,
  onSplitPage,
  onAddPages,
  onSave,
  onNewDocument
}: Props) {
  const [menuPageId, setMenuPageId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    pruneGalleryThumbs(new Set(pages.map((page) => page.id)))
  }, [pages])

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pages.findIndex((page) => page.id === active.id)
    const newIndex = pages.findIndex((page) => page.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onReorder(arrayMove(pages, oldIndex, newIndex))
  }

  const menuIndex = menuPageId ? pages.findIndex((page) => page.id === menuPageId) : -1
  const layout = getGalleryLayout(pages.length)

  return (
    <div className={`gallery-view layout-${layout}`}>
      <header className="gallery-header">
        <button type="button" className="text-button" onClick={onBackToCamera}>
          ← 撮影
        </button>
        <div className="gallery-title-block">
          <h1>{pages.length}ページ</h1>
          {(storageWarning || saveStatusLabel) && (
            <p className="save-status">{storageWarning ?? saveStatusLabel}</p>
          )}
        </div>
        <button type="button" className="text-button" onClick={onNewDocument}>
          新規
        </button>
      </header>

      <main className="gallery-main">
        {!pages.length ? (
          <div className="empty-state gallery-empty">
            <p>まだページがありません</p>
            <button type="button" className="primary-button" onClick={onBackToCamera}>
              撮影を開始
            </button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={pages.map((page) => page.id)} strategy={rectSortingStrategy}>
              <div className={`gallery-grid ${layout === 'single' ? 'gallery-single-page' : ''}`}>
                {pages.map((page, index) => (
                  <PageCard
                    key={page.id}
                    page={page}
                    index={index}
                    layout={layout}
                    onOpen={() => onOpenPage(page.id)}
                    onMenu={() => setMenuPageId(page.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

      <footer className="gallery-footer">
        <button type="button" className="secondary-button" onClick={onAddPages}>
          ＋ ページ追加
        </button>
        <button type="button" className="primary-button" onClick={onSave} disabled={!pages.length}>
          保存・共有
        </button>
      </footer>

      <BottomSheet
        open={Boolean(menuPageId)}
        title={menuIndex >= 0 ? `${menuIndex + 1}ページ` : 'ページ'}
        onClose={() => setMenuPageId(null)}
      >
        <div className="sheet-action-list">
          <button
            type="button"
            onClick={() => {
              if (menuPageId) onRetake(menuPageId)
              setMenuPageId(null)
            }}
          >
            撮り直し
          </button>
          <button
            type="button"
            onClick={() => {
              if (menuPageId) onSplitPage(menuPageId)
              setMenuPageId(null)
            }}
          >
            左右に分割（背を自動検出）
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (menuPageId) onDelete(menuPageId)
              setMenuPageId(null)
            }}
          >
            削除
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
