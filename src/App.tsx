import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HighResCapture } from './components/HighResCapture'
import { HighResPreview } from './components/HighResPreview'
import { ReplacePreview } from './components/ReplacePreview'
import { SaveBottomSheet } from './components/SaveBottomSheet'
import { TextRecognitionBottomSheet } from './components/TextRecognitionBottomSheet'
import { Toast } from './components/Toast'
import { useDocumentStorage } from './hooks/useDocumentStorage'
import {
  invalidateOcrForImageChange,
  normalizeFilter,
  type BookFlattenMode,
  type CornerDetectionResult,
  type EditTool,
  type FilterMode,
  type HighResTileId,
  type PaperSize,
  type ScanPage,
  type ViewMode
} from './types'
import { detectDocumentCorners } from './utils/corners'
import { getGalleryPlaceholder, prefetchGalleryThumb, seedGalleryPlaceholder } from './utils/galleryThumbs'
import { cancelHighResStitch, stitchHighResAdaptive } from './utils/highResWorkerClient'
import { RENDER_MAX, defaultCorners, renderScanPage } from './utils/image'
import { collectPageTexts, recognizePage } from './utils/ocr'
import { splitDataUrlVertically } from './utils/pageSplit'
import { buildPdfBlob, downloadPdf } from './utils/pdf'
import { sharePagesWithGpt } from './utils/share'
import { downloadTextFile, downloadWordFile } from './utils/textExport'
import { buildPagesZipBlob } from './utils/zipExport'
import { CameraView, type CapturePayload } from './views/CameraView'
import { EditView } from './views/EditView'
import { GalleryView } from './views/GalleryView'
import { OnboardingView } from './views/OnboardingView'
import { isOnboardingComplete, markOnboardingComplete } from './utils/onboardingStorage'
import './redesign.css'

type HighResShots = { base: string; tiles: Record<HighResTileId, string> }
type StitchPreview = { dataUrl: string; warnings: string[]; qualityFailed: boolean; failedTiles: HighResTileId[] }
type UndoState = { page: ScanPage; index: number; message: string }

const initialFileName = () => {
  const date = new Date()
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}${m}${d}_スキャン`
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
    bookFlatten: 'off',
    paperSize: 'auto',
    ocrStatus: 'idle',
    translationStatus: 'idle'
  }
}

/** Instant page so shutter → stack/gallery never waits on still corner detection. */
const makePageOptimistic = (dataUrl: string, name: string, live?: CornerDetectionResult | null): ScanPage => {
  const useLive = Boolean(live?.detected && (live.confidence ?? 0) >= 0.45)
  return {
    id: crypto.randomUUID(),
    name,
    dataUrl,
    corners: useLive && live ? live.corners : defaultCorners(),
    cornerDetection: useLive ? 'auto' : 'fallback',
    cornerConfidence: useLive && live ? live.confidence : 0,
    rotation: 0,
    filter: 'color',
    clean: false,
    bookFlatten: 'off',
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

const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('camera')
  const [pages, setPages] = useState<ScanPage[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboardingComplete())
  const [saveSheetOpen, setSaveSheetOpen] = useState(false)
  const [textSheetOpen, setTextSheetOpen] = useState(false)
  const [replacePageId, setReplacePageId] = useState<string | null>(null)
  const [pendingReplaceUrl, setPendingReplaceUrl] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [panelBusy, setPanelBusy] = useState(false)
  const [detectingId, setDetectingId] = useState<string | null>(null)
  const [quickThumbs, setQuickThumbs] = useState<Record<string, string>>({})
  const [cameraWarm, setCameraWarm] = useState(true)
  const [fileName, setFileName] = useState(initialFileName())
  const [exportStatus, setExportStatus] = useState('')
  const [pageOcrStatus, setPageOcrStatus] = useState('')
  const [gptFallbackVisible, setGptFallbackVisible] = useState(false)
  const [highResOpen, setHighResOpen] = useState(false)
  const [highResShots, setHighResShots] = useState<HighResShots | undefined>()
  const [highResStartStep, setHighResStartStep] = useState<'base' | HighResTileId>('base')
  const [stitchProgress, setStitchProgress] = useState('')
  const [stitchPreview, setStitchPreview] = useState<StitchPreview | undefined>()
  const [stitchFailure, setStitchFailure] = useState<{ message: string; failedTiles: HighResTileId[] } | undefined>()
  const [editTool, setEditTool] = useState<EditTool>('crop')
  const [undo, setUndo] = useState<UndoState | null>(null)
  const pagesRef = useRef(pages)
  pagesRef.current = pages

  const handleRestore = useCallback(
    (payload: { pages: ScanPage[]; selectedId: string | null; fileName: string }) => {
      setPages(payload.pages)
      setSelectedPageId(payload.selectedId ?? payload.pages[0]?.id ?? null)
      setFileName(payload.fileName || initialFileName())
      const nextMode = payload.pages.length ? 'gallery' : 'camera'
      setViewMode(nextMode)
      setCameraWarm(nextMode === 'camera')
    },
    []
  )

  const { saveStatus, storageWarning, restoreMessage, hydrated, startNewDocument } = useDocumentStorage({
    pages,
    selectedId: selectedPageId,
    fileName,
    onRestore: handleRestore
  })

  // Existing saved documents take priority over first-launch onboarding.
  useEffect(() => {
    if (!hydrated || !showOnboarding || pages.length === 0) return
    markOnboardingComplete()
    setShowOnboarding(false)
  }, [hydrated, pages.length, showOnboarding])

  useEffect(() => {
    if (viewMode === 'camera') setCameraWarm(true)
  }, [viewMode])

  useEffect(() => {
    if (viewMode !== 'gallery') return
    for (const page of pages) prefetchGalleryThumb(page)
  }, [viewMode, pages])

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? null,
    [pages, selectedPageId]
  )
  const selectedIndex = useMemo(
    () => (selectedPage ? pages.findIndex((page) => page.id === selectedPage.id) : -1),
    [pages, selectedPage]
  )
  const replacePage = useMemo(() => pages.find((page) => page.id === replacePageId) ?? null, [pages, replacePageId])
  const anyBusy = isBusy || panelBusy || Boolean(stitchProgress)
  const latestPage = pages.length ? pages[pages.length - 1] : null
  const latestThumbUrl = latestPage
    ? (quickThumbs[latestPage.id] ?? getGalleryPlaceholder(latestPage.id) ?? null)
    : null

  const rememberQuickThumb = useCallback((pageId: string, url: string) => {
    setQuickThumbs((current) => (current[pageId] === url ? current : { ...current, [pageId]: url }))
  }, [])

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), 4500)
    return () => window.clearTimeout(timer)
  }, [undo])

  const updatePage = (pageId: string, updater: (page: ScanPage) => ScanPage) =>
    setPages((current) => current.map((page) => (page.id === pageId ? updater(page) : page)))

  const updatePageImage = (pageId: string, updater: (page: ScanPage) => ScanPage) =>
    updatePage(pageId, (page) => invalidateOcrForImageChange(updater(page)))

  const appendPage = (page: ScanPage) => {
    setPages((current) => [...current, page])
    setSelectedPageId(page.id)
  }

  const refineCapturedCorners = async (pageId: string, dataUrl: string) => {
    try {
      const detection = await detectDocumentCorners(dataUrl)
      updatePageImage(pageId, (page) => {
        if (page.cornerDetection === 'manual') return page
        return {
          ...page,
          corners: detection.corners,
          cornerDetection: detection.detected ? 'auto' : 'fallback',
          cornerConfidence: detection.confidence
        }
      })
      const refined = pagesRef.current.find((page) => page.id === pageId)
      if (refined && refined.cornerDetection !== 'manual') {
        prefetchGalleryThumb({
          ...refined,
          corners: detection.corners,
          cornerDetection: detection.detected ? 'auto' : 'fallback',
          cornerConfidence: detection.confidence
        })
      }
    } catch (error) {
      console.warn('Background corner refine failed.', error)
    }
  }

  const addCapturedPage = async (payload: CapturePayload | string) => {
    const dataUrl = typeof payload === 'string' ? payload : payload.dataUrl
    const liveDetection = typeof payload === 'string' ? null : payload.liveDetection
    if (replacePageId) {
      setPendingReplaceUrl(dataUrl)
      setViewMode('gallery')
      return
    }

    const page = makePageOptimistic(dataUrl, `撮影-${pagesRef.current.length + 1}`, liveDetection)
    appendPage(page)
    setViewMode('camera')

    // Seed a lightweight stack thumb while corrected gallery thumbs generate.
    void seedGalleryPlaceholder(page.id, dataUrl).then((url) => {
      if (url) rememberQuickThumb(page.id, url)
    })
    prefetchGalleryThumb(page)
    void refineCapturedCorners(page.id, dataUrl)
  }

  const finishCamera = () => {
    const wasReplace = Boolean(replacePageId)
    setReplacePageId(null)
    if (wasReplace) {
      setViewMode('gallery')
      return
    }
    const count = pagesRef.current.length
    if (count <= 0) {
      setViewMode('camera')
      return
    }
    if (count === 1) {
      setSelectedPageId(pagesRef.current[0].id)
      setEditTool('crop')
      setViewMode('edit')
      return
    }
    setViewMode('gallery')
  }

  const startRetake = (pageId: string) => {
    setReplacePageId(pageId)
    setPendingReplaceUrl(null)
    setViewMode('camera')
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
      setSelectedPageId(replacePageId)
      setEditTool('crop')
      setViewMode('edit')
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
      setSelectedPageId(nextPages[0]?.id ?? null)
      if (replacePageId) {
        setReplacePageId(null)
      }
      setViewMode(nextPages.length === 1 && pagesRef.current.length === 0 ? 'edit' : 'gallery')
      if (nextPages.length === 1 && pagesRef.current.length === 0) setEditTool('crop')
    } finally {
      setIsBusy(false)
      event.target.value = ''
    }
  }

  const removePage = (pageId: string) => {
    const index = pages.findIndex((page) => page.id === pageId)
    if (index < 0) return
    const removed = pages[index]
    setPages((current) => {
      const next = current.filter((page) => page.id !== pageId)
      if (selectedPageId === pageId) {
        const fallback = next[index] ?? next[index - 1] ?? null
        setSelectedPageId(fallback?.id ?? null)
      }
      return next
    })
    setUndo({ page: removed, index, message: `${index + 1}ページ目を削除しました` })
    setQuickThumbs((current) => {
      if (!(pageId in current)) return current
      const next = { ...current }
      delete next[pageId]
      return next
    })
  }

  const undoDelete = () => {
    if (!undo) return
    setPages((current) => {
      const next = [...current]
      next.splice(Math.min(undo.index, next.length), 0, undo.page)
      return next
    })
    setSelectedPageId(undo.page.id)
    setUndo(null)
  }

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
      if (!detection.detected) setExportStatus('四隅を自動検出できませんでした。青い四隅を手動で合わせてください。')
    } finally {
      setDetectingId(null)
    }
  }

  const ensureTextsForExport = async (progressPrefix: string) => {
    const { texts, updates } = await collectPageTexts(pages, (current, total) =>
      setExportStatus(`${progressPrefix}\n${current} / ${total}ページ`)
    )
    if (updates.length) setPages((current) => applyOcrUpdates(current, updates))
    return texts
  }

  const performExportPdf = async () => {
    if (!pages.length) return
    setIsBusy(true)
    setExportStatus('PDFを作成しています…')
    try {
      const name = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`
      await downloadPdf(pages, name)
      setSaveSheetOpen(false)
    } catch (error) {
      console.error(error)
      setExportStatus('PDFの作成に失敗しました。四隅の位置を確認してください。')
    } finally {
      setIsBusy(false)
      window.setTimeout(() => setExportStatus(''), 2500)
    }
  }

  const performSharePdf = async () => {
    if (!pages.length) return
    setIsBusy(true)
    setExportStatus('共有ファイルを準備しています…')
    try {
      const finalName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`
      const file = new File([await buildPdfBlob(pages)], finalName, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: finalName })
        setSaveSheetOpen(false)
        return
      }
      await downloadPdf(pages, finalName)
      setExportStatus('この端末では共有できないため、PDFを保存しました。')
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        console.error(error)
        setExportStatus('共有に失敗しました。')
      }
    } finally {
      setIsBusy(false)
      window.setTimeout(() => setExportStatus(''), 2500)
    }
  }

  const performSaveText = async () => {
    setIsBusy(true)
    try {
      downloadTextFile(await ensureTextsForExport('文字を読み取っています…'), fileName)
      setSaveSheetOpen(false)
    } catch (error) {
      console.error(error)
      setExportStatus('テキスト保存に失敗しました。')
    } finally {
      setExportStatus('')
      setIsBusy(false)
    }
  }

  const performSaveWord = async () => {
    setIsBusy(true)
    try {
      const texts = await ensureTextsForExport('文字を読み取っています…')
      setExportStatus('Wordファイルを作成しています…')
      await downloadWordFile(texts, fileName)
      setSaveSheetOpen(false)
    } catch (error) {
      console.error(error)
      setExportStatus('Word保存に失敗しました。')
    } finally {
      setExportStatus('')
      setIsBusy(false)
    }
  }

  const performSaveJpeg = async () => {
    if (!pages.length) return
    setIsBusy(true)
    setExportStatus('JPEGを作成しています…')
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
      setExportStatus('JPEG保存に失敗しました。')
    } finally {
      setIsBusy(false)
      window.setTimeout(() => setExportStatus(''), 2500)
    }
  }

  const performSaveZip = async () => {
    if (!pages.length) return
    setIsBusy(true)
    setExportStatus('ZIPを作成しています…')
    try {
      const blob = await buildPagesZipBlob(pages, (current, total) => {
        setExportStatus(`ZIPを作成しています…\n${current} / ${total}ページ`)
      })
      downloadBlob(blob, `${fileName.replace(/\.(pdf|zip)$/i, '') || 'scan'}.zip`)
      setSaveSheetOpen(false)
    } catch (error) {
      console.error(error)
      setExportStatus('ZIP保存に失敗しました。')
    } finally {
      setIsBusy(false)
      window.setTimeout(() => setExportStatus(''), 2500)
    }
  }

  const splitPage = async (pageId: string) => {
    const index = pagesRef.current.findIndex((page) => page.id === pageId)
    const source = pagesRef.current[index]
    if (!source || index < 0) return
    setIsBusy(true)
    setExportStatus('見開きの背を検出して分割しています…')
    try {
      const split = await splitDataUrlVertically(source.dataUrl)
      const [leftDetection, rightDetection] = await Promise.all([
        detectDocumentCorners(split.leftDataUrl),
        detectDocumentCorners(split.rightDataUrl)
      ])

      const makeHalf = (
        dataUrl: string,
        suffix: string,
        detection: Awaited<ReturnType<typeof detectDocumentCorners>>
      ): ScanPage => ({
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name}-${suffix}`,
        dataUrl,
        corners: detection.corners,
        cornerDetection: detection.detected ? 'auto' : 'fallback',
        cornerConfidence: detection.confidence,
        ocrText: undefined,
        ocrStatus: 'idle',
        ocrError: undefined,
        translationText: undefined,
        translationStatus: 'idle',
        translationError: undefined
      })

      const left = makeHalf(split.leftDataUrl, '左', leftDetection)
      const right = makeHalf(split.rightDataUrl, '右', rightDetection)

      try {
        URL.revokeObjectURL(source.dataUrl)
      } catch {
        /* ignore blob urls */
      }
      setPages((current) => {
        const next = [...current]
        next.splice(index, 1, left, right)
        return next
      })
      setSelectedPageId(left.id)
      setExportStatus('左右に分割しました（背位置を自動検出）')
    } catch (error) {
      console.error(error)
      setExportStatus('分割に失敗しました')
    } finally {
      setIsBusy(false)
      window.setTimeout(() => setExportStatus(''), 2200)
    }
  }

  const runPageOcr = async (page: ScanPage, force: boolean) => {
    if (anyBusy) return
    if (!force && page.ocrStatus === 'done' && typeof page.ocrText === 'string') return
    setPanelBusy(true)
    setPageOcrStatus('文字を読み取っています…')
    updatePage(page.id, (current) => ({ ...current, ocrStatus: 'processing', ocrError: undefined }))
    try {
      const text = await recognizePage(page, (message, progress) =>
        setPageOcrStatus(
          `文字を読み取っています…${progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}${
            message && !message.includes('文字を読み取') ? `\n${message}` : ''
          }`
        )
      )
      updatePage(page.id, (current) => ({
        ...current,
        ocrText: text,
        ocrStatus: 'done',
        ocrError: undefined,
        translationStatus:
          current.translationText || current.translationStatus === 'done' ? 'stale' : current.translationStatus
      }))
      setPageOcrStatus('文字を読み取りました')
    } catch (error) {
      console.error(error)
      updatePage(page.id, (current) => ({
        ...current,
        ocrStatus: 'error',
        ocrError: '文字の読み取りに失敗しました。\n画像を確認して、もう一度お試しください。',
        ...(force ? { ocrText: undefined } : {})
      }))
      setPageOcrStatus('文字の読み取りに失敗しました')
    } finally {
      setPanelBusy(false)
      window.setTimeout(() => setPageOcrStatus(''), 2000)
    }
  }

  const handleShareGpt = async () => {
    if (!pages.length || anyBusy) return
    setPanelBusy(true)
    setGptFallbackVisible(false)
    setPageOcrStatus('ChatGPTへ共有するため、\n文字を読み取っています…')
    setExportStatus('ChatGPTへ共有するため、\n文字を読み取っています…')
    const workingPages = pages
    try {
      const { texts, updates } = await collectPageTexts(workingPages, (current, total) => {
        const message = `ChatGPTへ共有するため、\n文字を読み取っています…\n${current} / ${total}ページ`
        setPageOcrStatus(message)
        setExportStatus(message)
      })
      const nextPages = applyOcrUpdates(workingPages, updates)
      setPages(nextPages)
      setPageOcrStatus('共有準備中…')
      setExportStatus('共有準備中…')
      const result = await sharePagesWithGpt(nextPages, texts)
      if (result.type === 'clipboard') setGptFallbackVisible(true)
      else if (result.type === 'failed') setExportStatus(result.message || 'ChatGPTへの共有に失敗しました。')
    } catch (error) {
      if ((error as DOMException)?.name !== 'AbortError') {
        console.error(error)
        setExportStatus('ChatGPTへの共有に失敗しました。')
      }
    } finally {
      setPageOcrStatus('')
      setPanelBusy(false)
      window.setTimeout(() => setExportStatus(''), 2500)
    }
  }

  const requestHighRes = () => {
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
      } else if (result.message !== 'キャンセルされました。') {
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
      setViewMode('gallery')
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

  const handleNewDocument = async () => {
    if (pages.length > 0) {
      const ok = window.confirm(`現在の${pages.length}ページを終了して\n新しい文書を作成しますか？`)
      if (!ok) return
    }
    await startNewDocument()
    setPages([])
    setSelectedPageId(null)
    setQuickThumbs({})
    setFileName(initialFileName())
    setViewMode('camera')
    setCameraWarm(true)
    setUndo(null)
    setSaveSheetOpen(false)
    setTextSheetOpen(false)
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

  const openEdit = (pageId: string) => {
    setSelectedPageId(pageId)
    setEditTool('crop')
    setTextSheetOpen(false)
    setViewMode('edit')
  }

  if (!hydrated) {
    return (
      <div className="app-shell redesign-shell mode-boot" aria-busy="true">
        <div className="boot-splash" role="status">
          読み込み中…
        </div>
      </div>
    )
  }

  if (showOnboarding && pages.length === 0) {
    return (
      <OnboardingView
        onComplete={() => {
          setShowOnboarding(false)
          setViewMode('camera')
        }}
      />
    )
  }

  return (
    <div className={`app-shell redesign-shell mode-${viewMode}`}>
      {hydrated && cameraWarm && (
        <CameraView
          active={viewMode === 'camera'}
          pageCount={pages.length}
          latestThumbUrl={latestThumbUrl}
          mode={replacePageId ? 'replace' : 'append'}
          onCapture={(payload) => void addCapturedPage(payload)}
          onClose={finishCamera}
          onOpenGallery={() => setViewMode('gallery')}
          onDone={finishCamera}
          onRequestHighRes={requestHighRes}
          onAddPhotos={(event) => void addFiles(event)}
        />
      )}

      {viewMode === 'gallery' && (
        <GalleryView
          pages={pages}
          saveStatusLabel={saveStatusLabel}
          storageWarning={storageWarning}
          onBackToCamera={() => {
            setReplacePageId(null)
            setViewMode('camera')
          }}
          onOpenPage={openEdit}
          onReorder={setPages}
          onRetake={startRetake}
          onDelete={removePage}
          onSplitPage={(pageId) => void splitPage(pageId)}
          onAddPages={() => {
            setReplacePageId(null)
            setViewMode('camera')
          }}
          onSave={() => {
            setExportStatus('')
            setSaveSheetOpen(true)
          }}
          onNewDocument={() => void handleNewDocument()}
        />
      )}

      {viewMode === 'edit' && selectedPage && (
        <EditView
          page={selectedPage}
          pageIndex={Math.max(0, selectedIndex)}
          pageCount={pages.length}
          editTool={editTool}
          detecting={detectingId === selectedPage.id}
          onBack={() => setViewMode('gallery')}
          onDone={() => setViewMode('gallery')}
          onToolChange={setEditTool}
          onCornersChange={(corners) =>
            updatePageImage(selectedPage.id, (page) => ({ ...page, corners, cornerDetection: 'manual' }))
          }
          onRedetect={() => void redetectCorners(selectedPage)}
          onPaperSize={(paperSize: PaperSize) => updatePageImage(selectedPage.id, (page) => ({ ...page, paperSize }))}
          onFilter={(filter: FilterMode) =>
            updatePageImage(selectedPage.id, (page) => ({ ...page, filter: normalizeFilter(filter) }))
          }
          onToggleClean={() => updatePageImage(selectedPage.id, (page) => ({ ...page, clean: !page.clean }))}
          onBookFlatten={(mode: BookFlattenMode) =>
            updatePageImage(selectedPage.id, (page) => ({ ...page, bookFlatten: mode }))
          }
          onRotate={(delta) => updatePageImage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation + delta }))}
          onSplitPage={() => void splitPage(selectedPage.id)}
          onOpenTextRecognition={() => {
            setEditTool('ocr')
            setTextSheetOpen(true)
            if (selectedPage.ocrStatus !== 'done' || typeof selectedPage.ocrText !== 'string') {
              void runPageOcr(selectedPage, false)
            }
          }}
        />
      )}

      {viewMode === 'edit' && !selectedPage && (
        <div className="card placeholder-card">
          <h2>ページを選んでください</h2>
          <button type="button" className="primary-button" onClick={() => setViewMode('gallery')}>
            ページ一覧へ
          </button>
        </div>
      )}

      <SaveBottomSheet
        open={saveSheetOpen}
        fileName={fileName}
        busy={anyBusy}
        statusMessage={exportStatus}
        disabled={!pages.length}
        onClose={() => setSaveSheetOpen(false)}
        onFileNameChange={setFileName}
        onSavePdf={() => void performExportPdf()}
        onSaveJpeg={() => void performSaveJpeg()}
        onSaveZip={() => void performSaveZip()}
        onSaveText={() => void performSaveText()}
        onSaveWord={() => void performSaveWord()}
        onShare={() => void performSharePdf()}
        onShareGpt={() => void handleShareGpt()}
      />

      {selectedPage && (
        <TextRecognitionBottomSheet
          open={textSheetOpen && viewMode === 'edit'}
          page={selectedPage}
          pageIndex={Math.max(0, selectedIndex)}
          pageCount={pages.length}
          busy={panelBusy}
          statusMessage={pageOcrStatus}
          gptFallbackVisible={gptFallbackVisible}
          onClose={() => {
            setTextSheetOpen(false)
            setEditTool((current) => (current === 'ocr' ? 'crop' : current))
          }}
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
          onDismissGptFallback={() => setGptFallbackVisible(false)}
          onUpdatePage={(updater) => updatePage(selectedPage.id, updater)}
          onBusyChange={setPanelBusy}
        />
      )}

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
            setViewMode('camera')
          }}
          onConfirm={() => void confirmReplace()}
          onCancel={() => {
            setPendingReplaceUrl(null)
            setReplacePageId(null)
            setViewMode('gallery')
          }}
        />
      )}

      {restoreMessage && <Toast message={restoreMessage} />}
      {undo && <Toast message={undo.message} actionLabel="元に戻す" onAction={undoDelete} />}
      {isBusy && !stitchProgress && (
        <div className="busy-dot" aria-live="polite">
          処理中…
        </div>
      )}
    </div>
  )
}
