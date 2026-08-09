import { CornerEditor } from '../components/CornerEditor'
import { CorrectedPreview } from '../components/CorrectedPreview'
import { EditToolbar } from '../components/EditToolbar'
import { FilterToolbar } from '../components/FilterToolbar'
import { PAPER_OPTIONS } from '../utils/paper'
import type { EditTool, FilterMode, PaperSize, ScanPage } from '../types'

type Props = {
  page: ScanPage
  pageIndex: number
  pageCount: number
  editTool: EditTool
  detecting: boolean
  onBack: () => void
  onDone: () => void
  onToolChange: (tool: EditTool) => void
  onCornersChange: (corners: ScanPage['corners']) => void
  onRedetect: () => void
  onPaperSize: (size: PaperSize) => void
  onFilter: (filter: FilterMode) => void
  onToggleClean: () => void
  onRotate: (delta: number) => void
  onOpenTextRecognition: () => void
}

export function EditView({
  page,
  pageIndex,
  pageCount,
  editTool,
  detecting,
  onBack,
  onDone,
  onToolChange,
  onCornersChange,
  onRedetect,
  onPaperSize,
  onFilter,
  onToggleClean,
  onRotate,
  onOpenTextRecognition
}: Props) {
  const handleTool = (tool: EditTool) => {
    if (tool === 'ocr') {
      onOpenTextRecognition()
      return
    }
    onToolChange(tool)
  }

  return (
    <div className="edit-view">
      <header className="edit-view-header">
        <button type="button" className="text-button" onClick={onBack}>
          ←
        </button>
        <h1>
          {pageIndex + 1} / {pageCount}ページ
        </h1>
        <button type="button" className="text-button strong" onClick={onDone}>
          完了
        </button>
      </header>

      <main className="edit-view-main">
        {editTool === 'crop' ? (
          <CornerEditor
            imageUrl={page.dataUrl}
            filter={page.filter}
            clean={page.clean}
            corners={page.corners}
            detectionMode={page.cornerDetection}
            confidence={page.cornerConfidence}
            detecting={detecting}
            onChange={onCornersChange}
            onRedetect={onRedetect}
          />
        ) : (
          <CorrectedPreview page={page} />
        )}

        {editTool === 'crop' && (
          <div className="paper-chip-row chip-scroll">
            {PAPER_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={page.paperSize === option.key ? 'chip active' : 'chip'}
                onClick={() => onPaperSize(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {editTool === 'filter' && (
          <FilterToolbar
            filter={page.filter}
            clean={page.clean}
            onFilter={onFilter}
            onToggleClean={onToggleClean}
          />
        )}

        {editTool === 'rotate' && (
          <div className="rotate-toolbar">
            <button type="button" className="chip" onClick={() => onRotate(-90)}>
              左90°
            </button>
            <button type="button" className="chip" onClick={() => onRotate(90)}>
              右90°
            </button>
          </div>
        )}
      </main>

      <EditToolbar value={editTool === 'enhance' ? 'crop' : editTool} onChange={handleTool} />
    </div>
  )
}
