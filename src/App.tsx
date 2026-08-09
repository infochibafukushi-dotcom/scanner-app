import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CameraCapture } from './components/CameraCapture'
import { CornerEditor } from './components/CornerEditor'
import { CorrectedPreview } from './components/CorrectedPreview'
import { HighResCapture } from './components/HighResCapture'
import { HighResPreview } from './components/HighResPreview'
import { OcrTextPanel } from './components/OcrTextPanel'
import { PageManager } from './components/PageManager'
import { PaperSizeSelector } from './components/PaperSizeSelector'
import { PreviewModal } from './components/PreviewModal'
import { ReplacePreview } from './components/ReplacePreview'
import { TranslationPanel } from './components/TranslationPanel'
import { useDocumentStorage } from './hooks/useDocumentStorage'
import {
  invalidateOcrForImageChange,
  type AppTab,
  type EditTool,
  type FilterMode,
  type HighResTileId,
  type PaperSize,
  type ScanPage
} from './types'
import { detectDocumentCorners } from './utils/corners'
import { cancelHighResStitch, stitchHighResAdaptive } from './utils/highResWorkerClient'
import { RENDER_MAX, renderScanPage } from './utils/image'
import { collectPageTexts, recognizePage } from './utils/ocr'
import { moveByOffset } from './utils/pageOrder'
import { paperSizeLabel } from './utils/paper'
import { buildPdfBlob, downloadPdf } from './utils/pdf'
import { sharePagesWithGpt } from './utils/share'
import { downloadTextFile, downloadWordFile } from './utils/textExport'

type PreviewIntent = 'preview' | 'save' | 'share' | 'text' | 'word'
type HighResShots = { base: string; tiles: Record<HighResTileId, string> }
type StitchPreview = { dataUrl: string; warnings: string[]; qualityFailed: boolean; failedTiles: HighResTileId[] }
type UndoState = { page: ScanPage; index: number; message: string }

const initialFileName = () => {
  const date = new Date()
  return `scan-${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}-${`${date.getHours()}`.padStart(2, '0')}${`${date.getMinutes()}`.padStart(2, '0')}.pdf`
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

const makePage = async (dataUrl: string, name: string): Promise<ScanPage> => {
  const detection = await detectDocumentCorners(dataUrl)
  return {
    id: crypto.randomUUID(),
    name,
    dataUrl,
    corners: detection.corners,
    cornerDetection: detection.detected ? 'auto' : 'fallback',
    cornerConfidence: detection.confidence,
    rotation: 0,
    filter: 'color',
    clean: false,
    paperSize: 'auto',
    ocrStatus: 'idle',
    translationStatus: 'idle'
  }
}

const applyOcrUpdates = (pages: ScanPage[], updates: { index: number; text: string }[]) =>
  pages.map((page, index) => {
    const update = updates.find((item) => item.index === index)
    return update ? { ...page, ocrText: update.text, ocrStatus: 'done' as const, ocrError: undefined } : page
  })

const filters: { key: FilterMode; label: string }[] = [
  { key: 'auto', label: '自動' },
  { key: 'color', label: 'カラー' },
  { key: 'gray', label: 'グレー' },
  { key: 'bw', label: '白黒' }
]

const filterLabel = (filter: FilterMode) => filters.find((item) => item.key === filter)?.label ?? 'カラー'

const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [pages, setPages] = useState<ScanPage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<AppTab>('capture')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [replacePageId, setReplacePageId] = useState<string | null>(null)
  const [pendingReplaceUrl, setPendingReplaceUrl] = useState<string | null>(null)
  const [saveSheetOpen, setSaveSheetOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [panelBusy, setPanelBusy] = useState(false)
  const [detectingId, setDetectingId] = useState<string | null>(null)
  const [fileName, setFileName] = useState(initialFileName())
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewIntent, setPreviewIntent] = useState<PreviewIntent>('preview')
  const [ocrStatus, setOcrStatus] = useState('')
  const [pageOcrStatus, setPageOcrStatus] = useState('')
  const [gptFallbackVisible, setGptFallbackVisible] = useState(false)
  const [translationOpenSignal, setTranslationOpenSignal] = useState(0)
  const [highResOpen, setHighResOpen] = useState(false)
  const [highResShots, setHighResShots] = useState<HighResShots | undefined>()
  const [highResStartStep, setHighResStartStep] = useState<'base' | HighResTileId>('base')
  const [stitchProgress, setStitchProgress] = useState('')
  const [stitchPreview, setStitchPreview] = useState<StitchPreview | undefined>()
  const [stitchFailure, setStitchFailure] = useState<{ message: string; failedTiles: HighResTileId[] } | undefined>()
  const [editTool, setEditTool] = useState<EditTool>('crop')
  const [undo, setUndo] = useState<UndoState | null>(null)
  const cornerEditorRef = useRef<HTMLDivElement | null>(null)
  const translationPanelRef = useRef<HTMLDivElement | null>(null)
  const pagesRef = useRef(pages)
  pagesRef.current = pages

  const handleRestore = useCallback(
    (payload: { pages: ScanPage[]; selectedId: string | null; fileName: string }) => {
      setPages(payload.pages)
      setSelectedId(payload.selectedId ?? payload.pages[0]?.id ?? null)
      setFileName(payload.fileName || initialFileName())
      setTab(payload.pages.length > 1 ? 'pages' : payload.pages.length === 1 ? 'edit' : 'capture')
    },
    []
  )

  const { saveStatus, storageWarning, restoreMessage, startNewDocument } = useDocumentStorage({
    pages,
    selectedId,
    fileName,
    onRestore: handleRestore
  })

  const selectedPage = useMemo(() => pages.find((page) => page.id === selectedId) ?? null, [pages, selectedId])
  const selectedIndex = useMemo(
    () => (selectedPage ? pages.findIndex((page) => page.id === selectedPage.id) : -1),
    [pages, selectedPage]
  )
  const replacePage = useMemo(() => pages.find((page) => page.id === replacePageId) ?? null, [pages, replacePageId])
  const anyBusy = isBusy || panelBusy || Boolean(stitchProgress)

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 4500)
    return () => window.clearTimeout(timer)
  }, [undo])

  const appendPage = (page: ScanPage) => {
    setPages((current) => [...current, page])
    setSelectedId(page.id)
  }

  const addCapturedPage = async (dataUrl: string) => {
    if (replacePageId) {
      setPendingReplaceUrl(dataUrl)
      setCameraOpen(false)
      return
    }
    setIsBusy(true)
    try {
      const page = await makePage(dataUrl, `撮影-${pagesRef.current.length + 1}`)
      appendPage(page)
    } finally {
      setIsBusy(false)
    }
  }

  const closeCamera = () => {
    const wasReplace = Boolean(replacePageId)
    setCameraOpen(false)
    setReplacePageId(null)
    if (wasReplace) return
    const count = pagesRef.current.length
    if (count <= 0) {
      setTab('capture')
      return
    }
    setTab(count <= 1 ? 'edit' : 'pages')
  }

  const startRetake = (pageId: string) => {
    setReplacePageId(pageId)
    setPendingReplaceUrl(null)
    setCameraOpen(true)
  }

  const confirmReplace = async () => {
    if (!replacePageId || !pendingReplaceUrl) return
    setIsBusy(true)
    try {
      const detection = await detectDocumentCorners(pendingReplaceUrl)
      updatePageImage(replacePageId, (page) => ({
        ...page,
        dataUrl: pendingReplaceUrl,
        corners: detection.corners,
        cornerDetection: detection.detected ? 'auto' : 'fallback',
        cornerConfidence: detection.confidence,
        rotation: 0
      }))
      setSelectedId(replacePageId)
      setTab('edit')
    } finally {
      setIsBusy(false)
      setPendingReplaceUrl(null)
      setReplacePageId(null)
    }
  }

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    setIsBusy(true)
    try {
      const nextPages = await Promise.all(files.map(async (file) => makePage(await readAsDataUrl(file), file.name)))
      setPages((current) => [...current, ...nextPages])
      setSelectedId(nextPages[0]?.id ?? null)
      setTab('pages')
    } finally {
      setIsBusy(false)
      event.target.value = ''
    }
  }

  const updatePage = (pageId: string, updater: (page: ScanPage) => ScanPage) =>
    setPages((current) => current.map((page) => (page.id === pageId ? updater(page) : page)))

  const updatePageImage = (pageId: string, updater: (page: ScanPage) => ScanPage) =>
    updatePage(pageId, (page) => invalidateOcrForImageChange(updater(page)))

  const removePage = (pageId: string, confirm = true) => {
    const index = pages.findIndex((page) => page.id === pageId)
    if (index < 0) return
    if (confirm && !window.confirm(`${index + 1}ページ目を削除しますか？`)) return
    const removed = pages[index]
    if (removed.dataUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(removed.dataUrl)
      } catch {
        /* ignore */
      }
    }
    setPages((current) => {
      const next = current.filter((page) => page.id !== pageId)
      if (selectedId === pageId) {
        const fallback = next[index] ?? next[index - 1] ?? null
        setSelectedId(fallback?.id ?? null)
      }
      return next
    })
    setUndo({ page: removed, index, message: `${index + 1}ページ目を削除しました` })
  }

  const undoDelete = () => {
    if (!undo) return
    setPages((current) => {
      const next = [...current]
      next.splice(Math.min(undo.index, next.length), 0, undo.page)
      return next
    })
    setSelectedId(undo.page.id)
    setUndo(null)
  }

  const movePage = (pageId: string, direction: -1 | 1) => setPages((current) => moveByOffset(current, pageId, direction))

  const redetectCorners = async (page: ScanPage) => {
    setDetectingId(page.id)
    try {
      const detection = await detectDocumentCorners(page.dataUrl)
      updatePageImage(page.id, (current) => ({
        ...current,
        corners: detection.corners,
        cornerDetection: detection.detected ? 'auto' : 'fallback',
        cornerConfidence: detection.confidence
      }))
      if (!detection.detected) window.alert('四隅を自動検出できませんでした。青い四隅を手動で合わせてください。')
    } finally {
      setDetectingId(null)
    }
  }

  const openPreview = (intent: PreviewIntent) => {
    if (!pages.length) return
    setPreviewIntent(intent)
    setOcrStatus('')
    setPreviewOpen(true)
    setSaveSheetOpen(false)
  }

  const performExportPdf = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      await downloadPdf(pages, fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
      setPreviewOpen(false)
    } catch (error) {
      console.error(error)
      window.alert('PDFの作成に失敗しました。四隅の位置を確認してください。')
    } finally {
      setIsBusy(false)
    }
  }

  const performSharePdf = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      const finalName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`
      const file = new File([await buildPdfBlob(pages)], finalName, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: finalName })
        setPreviewOpen(false)
        return
      }
      await downloadPdf(pages, finalName)
      setPreviewOpen(false)
      window.alert('この端末ではファイル共有に対応していないため、PDFを保存しました。')
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        console.error(error)
        window.alert('共有に失敗しました。')
      }
    } finally {
      setIsBusy(false)
    }
  }

  const ensureTextsForExport = async (progressPrefix: string) => {
    const { texts, updates } = await collectPageTexts(pages, (current, total) =>
      setOcrStatus(`${progressPrefix}\n${current} / ${total}ページ`)
    )
    if (updates.length) setPages((current) => applyOcrUpdates(current, updates))
    return texts
  }

  const performSaveText = async () => {
    setIsBusy(true)
    try {
      downloadTextFile(await ensureTextsForExport('文字を読み取っています…'), fileName)
      setPreviewOpen(false)
    } catch (error) {
      console.error(error)
      window.alert('テキスト保存に失敗しました。')
    } finally {
      setOcrStatus('')
      setIsBusy(false)
    }
  }

  const performSaveWord = async () => {
    setIsBusy(true)
    try {
      const texts = await ensureTextsForExport('文字を読み取っています…')
      setOcrStatus('Wordファイルを作成しています…')
      await downloadWordFile(texts, fileName)
      setPreviewOpen(false)
    } catch (error) {
      console.error(error)
      window.alert('Word保存に失敗しました。')
    } finally {
      setOcrStatus('')
      setIsBusy(false)
    }
  }

  const performSaveJpeg = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      await Promise.all(
        pages.map(async (page, index) => {
          const canvas = await renderScanPage(page, RENDER_MAX.export)
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.96))
          if (!blob) throw new Error('JPEGを作成できませんでした。')
          downloadBlob(blob, `${fileName.replace(/\.pdf$/i, '')}-${index + 1}.jpg`)
        })
      )
      setSaveSheetOpen(false)
    } catch (error) {
      console.error(error)
      window.alert('JPEG保存に失敗しました。')
    } finally {
      setIsBusy(false)
    }
  }

  const runPageOcr = async (page: ScanPage, force: boolean) => {
    if (anyBusy) return
    setPanelBusy(true)
    setPageOcrStatus('文字を読み取っています…')
    setEditTool('ocr')
    updatePage(page.id, (current) => ({ ...current, ocrStatus: 'processing', ocrError: undefined }))
    try {
      const text = await recognizePage(page, (message, progress) =>
        setPageOcrStatus(`文字を読み取っています…${progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}\n${message}`)
      )
      updatePage(page.id, (current) => ({
        ...current,
        ocrText: text,
        ocrStatus: 'done',
        ocrError: undefined,
        translationStatus:
          current.translationText || current.translationStatus === 'done' ? 'stale' : current.translationStatus
      }))
    } catch (error) {
      console.error(error)
      updatePage(page.id, (current) => ({
        ...current,
        ocrStatus: 'error',
        ocrError: '文字の読み取りに失敗しました。',
        ...(force ? { ocrText: undefined } : {})
      }))
    } finally {
      setPageOcrStatus('')
      setPanelBusy(false)
    }
  }

  const handleShareGpt = async () => {
    if (!pages.length || anyBusy) return
    setPanelBusy(true)
    setGptFallbackVisible(false)
    setPageOcrStatus('GPT共有のため文字を読み取っています…')
    const workingPages = pages
    try {
      const { texts, updates } = await collectPageTexts(workingPages, (current, total) =>
        setPageOcrStatus(`GPT共有のため文字を読み取っています\n${current} / ${total}ページ`)
      )
      const nextPages = applyOcrUpdates(workingPages, updates)
      setPages(nextPages)
      setPageOcrStatus('共有準備中…')
      const result = await sharePagesWithGpt(nextPages, texts)
      if (result.type === 'clipboard') setGptFallbackVisible(true)
      else if (result.type === 'failed') window.alert(result.message || 'GPT共有に失敗しました。')
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        console.error(error)
        window.alert('GPT共有に失敗しました。')
      }
    } finally {
      setPageOcrStatus('')
      setPanelBusy(false)
    }
  }

  const openTranslationPanel = () => {
    setEditTool('ocr')
    setTranslationOpenSignal((value) => value + 1)
    window.setTimeout(() => translationPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  }

  const requestHighRes = () => {
    setCameraOpen(false)
    setReplacePageId(null)
    setHighResShots(undefined)
    setHighResStartStep('base')
    setHighResOpen(true)
  }

  const completeHighRes = async (shots: HighResShots) => {
    setHighResShots(shots)
    setHighResOpen(false)
    setStitchProgress('高精細画像を作成しています…')
    try {
      const result = await stitchHighResAdaptive({
        baseDataUrl: shots.base,
        tiles: shots.tiles,
        onProgress: ({ stage, current, total }) =>
          setStitchProgress(`高精細画像を作成しています…\n${stage} (${current}/${total})`)
      })
      if (result.ok) {
        setStitchPreview({
          dataUrl: result.dataUrl,
          warnings: result.warnings,
          qualityFailed: result.warnings.length > 0,
          failedTiles: []
        })
      } else if (result.message === 'キャンセルされました。') {
        setStitchFailure(undefined)
      } else {
        setStitchFailure({ message: result.message, failedTiles: result.failedTiles })
      }
    } finally {
      setStitchProgress('')
    }
  }

  const acceptHighRes = async () => {
    if (!stitchPreview) return
    setIsBusy(true)
    try {
      appendPage(await makePage(stitchPreview.dataUrl, `高精細-${pages.length + 1}`))
      setStitchPreview(undefined)
      setHighResShots(undefined)
      setTab(pages.length >= 1 ? 'pages' : 'edit')
    } finally {
      setIsBusy(false)
    }
  }

  const reopenHighRes = (tiles?: HighResTileId[]) => {
    if (tiles?.length && highResShots) {
      const nextTiles = { ...highResShots.tiles }
      tiles.forEach((tile) => delete nextTiles[tile])
      setHighResShots({ base: highResShots.base, tiles: nextTiles as Record<HighResTileId, string> })
      setHighResStartStep(tiles[0])
    } else {
      setHighResShots(undefined)
      setHighResStartStep('base')
    }
    setStitchPreview(undefined)
    setStitchFailure(undefined)
    setHighResOpen(true)
  }

  const openCamera = () => {
    setReplacePageId(null)
    setPendingReplaceUrl(null)
    setTab('capture')
    setCameraOpen(true)
  }

  const handleNewDocument = async () => {
    if (pages.length > 0) {
      const ok = window.confirm(`現在の${pages.length}ページを終了して\n新しい文書を作成しますか？`)
      if (!ok) return
    }
    await startNewDocument()
    setPages([])
    setSelectedId(null)
    setFileName(initialFileName())
    setTab('capture')
    setUndo(null)
    setSaveSheetOpen(false)
  }

  const saveStatusLabel =
    saveStatus === 'saving'
      ? '保存中…'
      : saveStatus === 'saved'
        ? '✓ 自動保存済み'
        : saveStatus === 'unavailable'
          ? '自動保存オフ'
          : saveStatus === 'error'
            ? '保存失敗'
            : ''

  return (
    <div className="app-shell">
      <CameraCapture
        open={cameraOpen}
        onClose={closeCamera}
        onCapture={(dataUrl) => void addCapturedPage(dataUrl)}
        onRequestHighRes={requestHighRes}
        pageCount={pages.length}
        mode={replacePageId ? 'replace' : 'append'}
      />
      <HighResCapture
        open={highResOpen}
        onClose={() => setHighResOpen(false)}
        onShotsReady={(shots) => void completeHighRes(shots)}
        initialShots={highResShots}
        startStep={highResStartStep}
      />
      {stitchPreview && (
        <HighResPreview
          {...stitchPreview}
          onAccept={() => void acceptHighRes()}
          onPartialRetake={(tiles) => reopenHighRes(tiles)}
          onFullRetake={() => reopenHighRes()}
          onClose={() => setStitchPreview(undefined)}
        />
      )}
      {stitchProgress && (
        <div className="processing-overlay" role="status">
          <div>{stitchProgress}</div>
          <button
            type="button"
            className="secondary-button stitch-cancel"
            onClick={() => {
              cancelHighResStitch()
              setStitchProgress('')
            }}
          >
            キャンセル
          </button>
        </div>
      )}
      {stitchFailure && (
        <div className="dialog-scrim">
          <section className="failure-dialog">
            <h2>高精細画像を作成できませんでした</h2>
            <p>{stitchFailure.message}</p>
            <div>
              <button type="button" className="primary-button" onClick={() => reopenHighRes(stitchFailure.failedTiles)}>
                撮り直す
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  void addCapturedPage(highResShots?.base ?? '')
                  setStitchFailure(undefined)
                }}
                disabled={!highResShots?.base}
              >
                通常スキャンで続ける
              </button>
            </div>
          </section>
        </div>
      )}
      {pendingReplaceUrl && replacePage && (
        <ReplacePreview
          oldUrl={replacePage.dataUrl}
          newUrl={pendingReplaceUrl}
          pageNumber={pages.findIndex((page) => page.id === replacePage.id) + 1}
          onRetake={() => {
            setPendingReplaceUrl(null)
            setCameraOpen(true)
          }}
          onConfirm={() => void confirmReplace()}
          onCancel={() => {
            setPendingReplaceUrl(null)
            setReplacePageId(null)
          }}
        />
      )}
      <PreviewModal
        open={previewOpen}
        pages={pages}
        fileName={fileName}
        intent={previewIntent}
        busy={isBusy}
        ocrStatus={ocrStatus}
        onClose={() => setPreviewOpen(false)}
        onSave={performExportPdf}
        onShare={performSharePdf}
        onSaveText={performSaveText}
        onSaveWord={performSaveWord}
      />

      <header className="hero">
        <div>
          <span className="badge">書類をすばやくデジタル化</span>
          <h1>Scanner</h1>
          <p>撮影 → ページ管理 → 編集 → 保存 の順で進めます。</p>
          {(saveStatusLabel || storageWarning) && (
            <p className="save-status" aria-live="polite">
              {storageWarning ?? saveStatusLabel}
            </p>
          )}
        </div>
        <div className="hero-actions">
          <button type="button" className="primary-button" onClick={openCamera}>
            ＋ スキャン
          </button>
          <label className="secondary-button file-button">
            <input type="file" accept="image/*" multiple onChange={(event) => void addFiles(event)} hidden />
            写真を追加
          </label>
          <button type="button" className="secondary-button" onClick={() => void handleNewDocument()}>
            新しい文書
          </button>
        </div>
      </header>

      {restoreMessage && (
        <div className="restore-toast" role="status">
          {restoreMessage}
        </div>
      )}

      <main className="mobile-workspace">
        {(tab === 'capture' || tab === 'pages') && (
          <PageManager
            pages={pages}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEdit={(pageId) => {
              setSelectedId(pageId)
              setTab('edit')
              setEditTool('crop')
            }}
            onRetake={startRetake}
            onDelete={removePage}
            onReorder={setPages}
            onOpenCamera={openCamera}
          />
        )}

        {tab === 'edit' &&
          (selectedPage ? (
            <section className="workspace">
              <div className="card edit-header-card">
                <div className="section-title-row">
                  <button type="button" className="text-button" onClick={() => setTab('pages')}>
                    ← ページ一覧
                  </button>
                  <h2>
                    ページ {selectedIndex + 1} / {pages.length}
                  </h2>
                </div>
                <div className="button-row wrap">
                  <button type="button" className="chip" onClick={() => startRetake(selectedPage.id)}>
                    撮り直し
                  </button>
                  <button type="button" className="chip danger" onClick={() => removePage(selectedPage.id)}>
                    削除
                  </button>
                  <button type="button" className="chip" onClick={() => movePage(selectedPage.id, -1)}>
                    前へ
                  </button>
                  <button type="button" className="chip" onClick={() => movePage(selectedPage.id, 1)}>
                    次へ
                  </button>
                </div>
              </div>

              {(editTool === 'crop' || editTool === 'enhance') && (
                <div ref={cornerEditorRef}>
                  <CornerEditor
                    imageUrl={selectedPage.dataUrl}
                    filter={selectedPage.filter}
                    clean={selectedPage.clean}
                    corners={selectedPage.corners}
                    detectionMode={selectedPage.cornerDetection}
                    confidence={selectedPage.cornerConfidence}
                    detecting={detectingId === selectedPage.id}
                    onChange={(corners) =>
                      updatePageImage(selectedPage.id, (page) => ({ ...page, corners, cornerDetection: 'manual' }))
                    }
                    onRedetect={() => void redetectCorners(selectedPage)}
                  />
                </div>
              )}

              {(editTool === 'crop' || editTool === 'enhance' || editTool === 'filter' || editTool === 'rotate') && (
                <div className="card controls-card">
                  {editTool === 'filter' && (
                    <div className="button-row wrap">
                      {filters.map((filter) => (
                        <button
                          key={filter.key}
                          type="button"
                          className={selectedPage.filter === filter.key ? 'chip active' : 'chip'}
                          onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, filter: filter.key }))}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {editTool === 'rotate' && (
                    <div className="button-row wrap">
                      <button
                        type="button"
                        className="chip"
                        onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation - 90 }))}
                      >
                        左回転
                      </button>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation + 90 }))}
                      >
                        右回転
                      </button>
                    </div>
                  )}
                  {(editTool === 'crop' || editTool === 'enhance') && (
                    <>
                      <PaperSizeSelector
                        value={selectedPage.paperSize}
                        corners={selectedPage.corners}
                        onChange={(paperSize: PaperSize) =>
                          updatePageImage(selectedPage.id, (page) => ({ ...page, paperSize }))
                        }
                      />
                      <button
                        type="button"
                        className={selectedPage.clean ? 'chip active' : 'chip'}
                        onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, clean: !page.clean }))}
                      >
                        クリーン {selectedPage.clean ? 'オン' : 'オフ'}
                      </button>
                      <p className="helper-text">
                        現在: {filterLabel(selectedPage.filter)} / 用紙{' '}
                        {paperSizeLabel(selectedPage.paperSize, selectedPage.corners)}
                      </p>
                    </>
                  )}
                </div>
              )}

              <CorrectedPreview page={selectedPage} />

              {editTool === 'ocr' && (
                <>
                  <OcrTextPanel
                    page={selectedPage}
                    pageIndex={Math.max(0, selectedIndex)}
                    pageCount={pages.length}
                    busy={panelBusy}
                    statusMessage={pageOcrStatus}
                    onTextChange={(text) =>
                      updatePage(selectedPage.id, (page) => ({
                        ...page,
                        ocrText: text,
                        ocrStatus: 'done',
                        translationStatus:
                          page.translationText || page.translationStatus === 'done' ? 'stale' : page.translationStatus
                      }))
                    }
                    onRecognize={() => void runPageOcr(selectedPage, false)}
                    onRerecognize={() => void runPageOcr(selectedPage, true)}
                    onShareGpt={() => void handleShareGpt()}
                    onOpenTranslation={openTranslationPanel}
                    gptFallbackVisible={gptFallbackVisible}
                    onDismissGptFallback={() => setGptFallbackVisible(false)}
                  />
                  <div ref={translationPanelRef}>
                    <TranslationPanel
                      page={selectedPage}
                      busy={panelBusy}
                      openSignal={translationOpenSignal}
                      onBusyChange={setPanelBusy}
                      onUpdate={(updater) => updatePage(selectedPage.id, updater)}
                    />
                  </div>
                </>
              )}
            </section>
          ) : (
            <section className="card placeholder-card">
              <h2>ページを選んでください</h2>
              <p>ページ一覧から編集したいページを選びます。</p>
              <button type="button" className="primary-button" onClick={() => setTab('pages')}>
                ページ一覧へ
              </button>
            </section>
          ))}
      </main>

      {tab === 'edit' && selectedPage && (
        <div className="edit-toolbar">
          <button type="button" className={editTool === 'crop' ? 'active' : ''} onClick={() => setEditTool('crop')}>
            切抜き
          </button>
          <button
            type="button"
            className={editTool === 'rotate' ? 'active' : ''}
            onClick={() => {
              setEditTool('rotate')
              updatePageImage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation + 90 }))
            }}
          >
            回転
          </button>
          <button type="button" className={editTool === 'filter' ? 'active' : ''} onClick={() => setEditTool('filter')}>
            フィルター
          </button>
          <button type="button" className={editTool === 'enhance' ? 'active' : ''} onClick={() => setEditTool('enhance')}>
            補正
          </button>
          <button
            type="button"
            className={editTool === 'ocr' ? 'active' : ''}
            onClick={() => {
              setEditTool('ocr')
              void runPageOcr(selectedPage, false)
            }}
          >
            OCR
          </button>
        </div>
      )}

      {undo && (
        <div className="undo-toast">
          <span>{undo.message}</span>
          <button type="button" onClick={undoDelete}>
            元に戻す
          </button>
        </div>
      )}

      {saveSheetOpen && (
        <div className="sheet-scrim" onClick={() => setSaveSheetOpen(false)}>
          <section className="save-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-handle" />
            <label className="field">
              <span>ファイル名</span>
              <input value={fileName} onChange={(event) => setFileName(event.target.value)} />
            </label>
            <div className="save-options">
              <button type="button" onClick={() => openPreview('save')} disabled={!pages.length || anyBusy}>
                PDF
              </button>
              <button type="button" onClick={() => void performSaveJpeg()} disabled={!pages.length || anyBusy}>
                JPEG
              </button>
              <button type="button" onClick={() => void performSaveText()} disabled={!pages.length || anyBusy}>
                TXT
              </button>
              <button type="button" onClick={() => void performSaveWord()} disabled={!pages.length || anyBusy}>
                Word
              </button>
              <button type="button" onClick={() => openPreview('share')} disabled={!pages.length || anyBusy}>
                共有
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaveSheetOpen(false)
                  void handleShareGpt()
                }}
                disabled={!pages.length || anyBusy}
              >
                GPT共有
              </button>
            </div>
          </section>
        </div>
      )}

      <nav className="bottom-tabs" aria-label="主な操作">
        <button type="button" className={tab === 'capture' || cameraOpen ? 'active' : ''} onClick={openCamera}>
          撮影
        </button>
        <button type="button" className={tab === 'pages' ? 'active' : ''} onClick={() => setTab('pages')}>
          ページ
          {pages.length > 0 && <span className="tab-badge">{pages.length}</span>}
        </button>
        <button type="button" className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>
          編集
        </button>
        <button
          type="button"
          className={tab === 'save' ? 'active' : ''}
          onClick={() => {
            setTab('save')
            setSaveSheetOpen(true)
          }}
        >
          保存
        </button>
      </nav>
    </div>
  )
}
