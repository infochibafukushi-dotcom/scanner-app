import { useMemo, useState } from 'react'
import { CornerEditor } from '../components/CornerEditor'
import { CorrectedPreview } from '../components/CorrectedPreview'
import { EditToolbar } from '../components/EditToolbar'
import { FilterToolbar } from '../components/FilterToolbar'
import { normalizeFilter, type EditTool, type FilterMode, type PaperSize, type ScanPage } from '../types'
import { PAPER_OPTIONS, paperSizeLabel } from '../utils/paper'

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
  onToggleFlattenBook: () => void
  onRotate: (delta: number) => void
  onSplitPage: () => void
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
  onToggleFlattenBook,
  onRotate,
  onSplitPage,
  onOpenTextRecognition
}: Props) {
  const [paperOpen, setPaperOpen] = useState(false)
  const activeTool = editTool === 'enhance' ? 'crop' : editTool
  const pageFilter = normalizeFilter(page.filter)
  const paperLabel = useMemo(() => paperSizeLabel(page.paperSize, page.corners), [page.corners, page.paperSize])

  const handleTool = (tool: EditTool) => {
    if (tool === 'ocr') {
      onOpenTextRecognition()
      return
    }
    setPaperOpen(false)
    onToolChange(tool === 'enhance' ? 'crop' : tool)
  }

  const stageTool = activeTool === 'ocr' ? 'crop' : activeTool

  return (
    <div className={`edit-view tool-${activeTool === 'ocr' ? 'crop' : activeTool}`}>
      <header className="edit-view-header">
        <button type="button" className="text-button" onClick={onBack} aria-label="戻る">
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
        <div className="edit-stage">
          {stageTool === 'crop' ? (
            <CornerEditor
              imageUrl={page.dataUrl}
              filter={pageFilter}
              clean={page.clean}
              corners={page.corners}
              detectionMode={page.cornerDetection}
              confidence={page.cornerConfidence}
              detecting={detecting}
              compact
              onChange={onCornersChange}
              onRedetect={onRedetect}
            />
          ) : (
            <CorrectedPreview page={{ ...page, filter: pageFilter }} compact />
          )}
        </div>

        {stageTool === 'crop' && (
          <div className="crop-controls">
            <div className="crop-controls-row">
              <button type="button" className="chip" onClick={onRedetect} disabled={detecting}>
                {detecting ? '検出中…' : '再検出'}
              </button>
              <button
                type="button"
                className={`chip paper-toggle ${paperOpen ? 'active' : ''}`}
                onClick={() => setPaperOpen((value) => !value)}
              >
                用紙:{paperLabel}
              </button>
              <button type="button" className="chip" onClick={onSplitPage}>
                左右分割
              </button>
            </div>
            {paperOpen && (
              <div className="paper-chip-row chip-scroll" role="listbox" aria-label="用紙サイズ">
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
          </div>
        )}

        {stageTool === 'filter' && (
          <FilterToolbar
            filter={pageFilter}
            clean={page.clean}
            flattenBook={page.flattenBook}
            onFilter={onFilter}
            onToggleClean={onToggleClean}
            onToggleFlattenBook={onToggleFlattenBook}
          />
        )}

        {stageTool === 'rotate' && (
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

      <EditToolbar value={activeTool === 'ocr' ? 'ocr' : stageTool} onChange={handleTool} />
    </div>
  )
}
