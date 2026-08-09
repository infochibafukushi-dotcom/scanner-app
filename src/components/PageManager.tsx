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
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ScanPage } from '../types'

type Props = {
  pages: ScanPage[]
  selectedId: string | null
  onSelect: (pageId: string) => void
  onEdit: (pageId: string) => void
  onRetake: (pageId: string) => void
  onDelete: (pageId: string) => void
  onReorder: (pages: ScanPage[]) => void
  onOpenCamera: () => void
}

const SortablePageCard = ({
  page,
  index,
  active,
  onEdit,
  onRetake,
  onDelete
}: {
  page: ScanPage
  index: number
  active: boolean
  onEdit: () => void
  onRetake: () => void
  onDelete: () => void
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`page-card sortable ${active ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
    >
      <div className="page-card-top">
        <button
          type="button"
          className="drag-handle"
          aria-label={`${index + 1}ページを並べ替え`}
          {...attributes}
          {...listeners}
        >
          ≡
        </button>
        <strong className="page-card-number">{index + 1}ページ</strong>
      </div>
      <button type="button" className="page-card-image" onClick={onEdit}>
        <img src={page.dataUrl} alt={`ページ ${index + 1}`} />
      </button>
      <div className="page-card-actions">
        <button type="button" onClick={onEdit}>
          編集
        </button>
        <button type="button" onClick={onRetake}>
          撮り直し
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          削除
        </button>
      </div>
    </article>
  )
}

export const PageManager = ({
  pages,
  selectedId,
  onSelect,
  onEdit,
  onRetake,
  onDelete,
  onReorder,
  onOpenCamera
}: Props) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pages.findIndex((page) => page.id === active.id)
    const newIndex = pages.findIndex((page) => page.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onReorder(arrayMove(pages, oldIndex, newIndex))
    onSelect(String(active.id))
  }

  return (
    <section className="page-list card">
      <div className="section-title-row">
        <h2>ページ</h2>
        <span>{pages.length}枚</span>
      </div>
      {!pages.length ? (
        <div className="empty-state">
          <p>まだページがありません。</p>
          <p>下部の「撮影」からスキャンを開始してください。</p>
          <button type="button" className="primary-button" onClick={onOpenCamera}>
            撮影を開始
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={pages.map((page) => page.id)} strategy={verticalListSortingStrategy}>
            <div className="page-grid page-grid-sortable">
              {pages.map((page, index) => (
                <SortablePageCard
                  key={page.id}
                  page={page}
                  index={index}
                  active={selectedId === page.id}
                  onEdit={() => onEdit(page.id)}
                  onRetake={() => onRetake(page.id)}
                  onDelete={() => onDelete(page.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  )
}
