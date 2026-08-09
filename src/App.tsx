import { ChangeEvent, useMemo, useRef, useState } from 'react'
import { CameraCapture } from './components/CameraCapture'
import { CornerEditor } from './components/CornerEditor'
import { CorrectedPreview } from './components/CorrectedPreview'
import { HighResCapture } from './components/HighResCapture'
import { HighResPreview } from './components/HighResPreview'
import { OcrTextPanel } from './components/OcrTextPanel'
import { PreviewModal } from './components/PreviewModal'
import { TranslationPanel } from './components/TranslationPanel'
import { invalidateOcrForImageChange, type AppTab, type FilterMode, type HighResTileId, type ScanPage } from './types'
import { detectDocumentCorners } from './utils/corners'
import { RENDER_MAX, renderScanPage } from './utils/image'
import { collectPageTexts, recognizePage } from './utils/ocr'
import { buildPdfBlob, downloadPdf } from './utils/pdf'
import { sharePagesWithGpt } from './utils/share'
import { stitchHighRes } from './utils/highResStitch'
import { downloadTextFile, downloadWordFile } from './utils/textExport'

type PreviewIntent = 'preview' | 'save' | 'share' | 'text' | 'word'
type HighResShots = { base: string; tiles: Record<HighResTileId, string> }
type StitchPreview = { dataUrl: string; warnings: string[]; qualityFailed: boolean; failedTiles: HighResTileId[] }

const initialFileName = () => {
  const date = new Date()
  return `scan-${date.getFullYear()}${`${date.getMonth() + 1}`.padStart(2, '0')}${`${date.getDate()}`.padStart(2, '0')}-${`${date.getHours()}`.padStart(2, '0')}${`${date.getMinutes()}`.padStart(2, '0')}.pdf`
}

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = reject
  reader.readAsDataURL(file)
})

const makePage = async (dataUrl: string, name: string): Promise<ScanPage> => {
  const detection = await detectDocumentCorners(dataUrl)
  return { id: crypto.randomUUID(), name, dataUrl, corners: detection.corners, cornerDetection: detection.detected ? 'auto' : 'fallback', rotation: 0, filter: 'color', clean: false, ocrStatus: 'idle', translationStatus: 'idle' }
}

const applyOcrUpdates = (pages: ScanPage[], updates: { index: number; text: string }[]) => pages.map((page, index) => {
  const update = updates.find((item) => item.index === index)
  return update ? { ...page, ocrText: update.text, ocrStatus: 'done' as const, ocrError: undefined } : page
})

const filters: { key: FilterMode; label: string }[] = [
  { key: 'auto', label: '自動' }, { key: 'color', label: 'カラー' }, { key: 'gray', label: 'グレー' }, { key: 'bw', label: '白黒' }
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
  const cornerEditorRef = useRef<HTMLDivElement | null>(null)
  const translationPanelRef = useRef<HTMLDivElement | null>(null)
  const selectedPage = useMemo(() => pages.find((page) => page.id === selectedId) ?? null, [pages, selectedId])
  const selectedIndex = useMemo(() => selectedPage ? pages.findIndex((page) => page.id === selectedPage.id) : -1, [pages, selectedPage])
  const anyBusy = isBusy || panelBusy || Boolean(stitchProgress)

  const appendPage = (page: ScanPage) => {
    setPages((current) => [...current, page])
    setSelectedId(page.id)
  }
  const addCapturedPage = async (dataUrl: string) => {
    setIsBusy(true)
    try { appendPage(await makePage(dataUrl, `撮影-${pages.length + 1}`)); setTab('edit') } finally { setIsBusy(false) }
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
    } finally { setIsBusy(false); event.target.value = '' }
  }
  const updatePage = (pageId: string, updater: (page: ScanPage) => ScanPage) => setPages((current) => current.map((page) => page.id === pageId ? updater(page) : page))
  const updatePageImage = (pageId: string, updater: (page: ScanPage) => ScanPage) => updatePage(pageId, (page) => invalidateOcrForImageChange(updater(page)))
  const removePage = (pageId: string) => setPages((current) => {
    const next = current.filter((page) => page.id !== pageId)
    if (selectedId === pageId) setSelectedId(next[0]?.id ?? null)
    return next
  })
  const movePage = (pageId: string, direction: -1 | 1) => setPages((current) => {
    const index = current.findIndex((page) => page.id === pageId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= current.length) return current
    const next = [...current]; const [page] = next.splice(index, 1); next.splice(target, 0, page); return next
  })
  const redetectCorners = async (page: ScanPage) => {
    setDetectingId(page.id)
    try {
      const detection = await detectDocumentCorners(page.dataUrl)
      updatePageImage(page.id, (current) => ({ ...current, corners: detection.corners, cornerDetection: detection.detected ? 'auto' : 'fallback' }))
      if (!detection.detected) window.alert('書類の輪郭を自動判定できませんでした。青い四隅を手動で合わせてください。')
    } finally { setDetectingId(null) }
  }
  const openPreview = (intent: PreviewIntent) => { if (pages.length) { setPreviewIntent(intent); setOcrStatus(''); setPreviewOpen(true); setSaveSheetOpen(false) } }
  const performExportPdf = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try { await downloadPdf(pages, fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`); setPreviewOpen(false) }
    catch (error) { console.error(error); window.alert('PDFの作成に失敗しました。四隅の位置を確認してください。') }
    finally { setIsBusy(false) }
  }
  const performSharePdf = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      const finalName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`
      const file = new File([await buildPdfBlob(pages)], finalName, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: finalName }); setPreviewOpen(false); return }
      await downloadPdf(pages, finalName); setPreviewOpen(false); window.alert('この端末ではファイル共有に対応していないため、PDFを保存しました。')
    } catch (error) { if ((error as DOMException)?.name !== 'AbortError') { console.error(error); window.alert('共有に失敗しました。') } }
    finally { setIsBusy(false) }
  }
  const ensureTextsForExport = async (progressPrefix: string) => {
    const { texts, updates } = await collectPageTexts(pages, (current, total) => setOcrStatus(`${progressPrefix}\n${current} / ${total}ページ`))
    if (updates.length) setPages((current) => applyOcrUpdates(current, updates))
    return texts
  }
  const performSaveText = async () => { setIsBusy(true); try { downloadTextFile(await ensureTextsForExport('文字を読み取っています…'), fileName); setPreviewOpen(false) } catch (error) { console.error(error); window.alert('テキスト保存に失敗しました。') } finally { setOcrStatus(''); setIsBusy(false) } }
  const performSaveWord = async () => { setIsBusy(true); try { const texts = await ensureTextsForExport('文字を読み取っています…'); setOcrStatus('Wordファイルを作成しています…'); await downloadWordFile(texts, fileName); setPreviewOpen(false) } catch (error) { console.error(error); window.alert('Word保存に失敗しました。') } finally { setOcrStatus(''); setIsBusy(false) } }
  const performSaveJpeg = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      await Promise.all(pages.map(async (page, index) => {
        const canvas = await renderScanPage(page, RENDER_MAX.export)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.96))
        if (!blob) throw new Error('JPEGを作成できませんでした。')
        downloadBlob(blob, `${fileName.replace(/\.pdf$/i, '')}-${index + 1}.jpg`)
      }))
      setSaveSheetOpen(false)
    } catch (error) { console.error(error); window.alert('JPEG保存に失敗しました。') } finally { setIsBusy(false) }
  }
  const runPageOcr = async (page: ScanPage, force: boolean) => {
    if (anyBusy) return
    setPanelBusy(true); setPageOcrStatus('文字を読み取っています…')
    updatePage(page.id, (current) => ({ ...current, ocrStatus: 'processing', ocrError: undefined }))
    try {
      const text = await recognizePage(page, (message, progress) => setPageOcrStatus(`文字を読み取っています…${progress > 0 ? ` ${Math.round(progress * 100)}%` : ''}\n${message}`))
      updatePage(page.id, (current) => ({ ...current, ocrText: text, ocrStatus: 'done', ocrError: undefined, translationStatus: current.translationText || current.translationStatus === 'done' ? 'stale' : current.translationStatus }))
    } catch (error) { console.error(error); updatePage(page.id, (current) => ({ ...current, ocrStatus: 'error', ocrError: '文字の読み取りに失敗しました。', ...(force ? { ocrText: undefined } : {}) })) }
    finally { setPageOcrStatus(''); setPanelBusy(false) }
  }
  const handleShareGpt = async () => {
    if (!pages.length || anyBusy) return
    setPanelBusy(true); setGptFallbackVisible(false); setPageOcrStatus('GPT共有のため文字を読み取っています…')
    const workingPages = pages
    try {
      const { texts, updates } = await collectPageTexts(workingPages, (current, total) => setPageOcrStatus(`GPT共有のため文字を読み取っています\n${current} / ${total}ページ`))
      const nextPages = applyOcrUpdates(workingPages, updates); setPages(nextPages); setPageOcrStatus('共有準備中…')
      const result = await sharePagesWithGpt(nextPages, texts)
      if (result.type === 'clipboard') setGptFallbackVisible(true)
      else if (result.type === 'failed') window.alert(result.message || 'GPT共有に失敗しました。')
    } catch (error) { if ((error as DOMException)?.name !== 'AbortError') { console.error(error); window.alert('GPT共有に失敗しました。') } }
    finally { setPageOcrStatus(''); setPanelBusy(false) }
  }
  const openTranslationPanel = () => { setTranslationOpenSignal((value) => value + 1); window.setTimeout(() => translationPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50) }
  const scrollToCorners = () => cornerEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const requestHighRes = () => { setCameraOpen(false); setHighResShots(undefined); setHighResStartStep('base'); setHighResOpen(true) }
  const completeHighRes = async (shots: HighResShots) => {
    setHighResShots(shots); setHighResOpen(false); setStitchProgress('高精細画像を作成しています…')
    try {
      const result = await stitchHighRes({ baseDataUrl: shots.base, tiles: shots.tiles, onProgress: ({ stage, current, total }) => setStitchProgress(`高精細画像を作成しています…\n${stage} (${current}/${total})`) })
      if (result.ok) setStitchPreview({ dataUrl: result.dataUrl, warnings: result.warnings, qualityFailed: result.warnings.length > 0, failedTiles: [] })
      else setStitchFailure({ message: result.message, failedTiles: result.failedTiles })
    } finally { setStitchProgress('') }
  }
  const acceptHighRes = async () => {
    if (!stitchPreview) return
    setIsBusy(true)
    try { appendPage(await makePage(stitchPreview.dataUrl, `高精細-${pages.length + 1}`)); setStitchPreview(undefined); setHighResShots(undefined); setTab('edit') } finally { setIsBusy(false) }
  }
  const reopenHighRes = (tiles?: HighResTileId[]) => {
    if (tiles?.length && highResShots) {
      const nextTiles = { ...highResShots.tiles }; tiles.forEach((tile) => delete nextTiles[tile])
      setHighResShots({ base: highResShots.base, tiles: nextTiles as Record<HighResTileId, string> }); setHighResStartStep(tiles[0])
    } else { setHighResShots(undefined); setHighResStartStep('base') }
    setStitchPreview(undefined); setStitchFailure(undefined); setHighResOpen(true)
  }

  const renderPageList = () => <section className="page-list card"><div className="section-title-row"><h2>ページ</h2><span>{pages.length}枚</span></div>{!pages.length ? <div className="empty-state"><p>まだページがありません。</p><p>スキャンまたは写真を追加してください。</p></div> : <div className="thumbnail-list">{pages.map((page, index) => <button key={page.id} type="button" className={`thumbnail-card ${selectedId === page.id ? 'active' : ''}`} onClick={() => { setSelectedId(page.id); setTab('edit') }}><img src={page.dataUrl} alt={page.name} /><div className="thumbnail-meta"><strong>{index + 1}. {page.name}</strong><span>{filterLabel(page.filter)} {page.clean ? '・クリーン' : ''}</span><span>{page.cornerDetection === 'auto' ? '四隅: 自動' : page.cornerDetection === 'manual' ? '四隅: 手動' : '四隅: 要確認'}</span></div></button>)}</div>}</section>

  return <div className="app-shell">
    <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(dataUrl) => void addCapturedPage(dataUrl)} onRequestHighRes={requestHighRes} />
    <HighResCapture open={highResOpen} onClose={() => setHighResOpen(false)} onShotsReady={(shots) => void completeHighRes(shots)} initialShots={highResShots} startStep={highResStartStep} />
    {stitchPreview && <HighResPreview {...stitchPreview} onAccept={() => void acceptHighRes()} onPartialRetake={(tiles) => reopenHighRes(tiles)} onFullRetake={() => reopenHighRes()} onClose={() => setStitchPreview(undefined)} />}
    {stitchProgress && <div className="processing-overlay" role="status"><div>{stitchProgress}</div></div>}
    {stitchFailure && <div className="dialog-scrim"><section className="failure-dialog"><h2>高精細画像を作成できませんでした</h2><p>{stitchFailure.message}</p><div><button type="button" className="primary-button" onClick={() => reopenHighRes(stitchFailure.failedTiles)}>撮り直す</button><button type="button" className="secondary-button" onClick={() => { void addCapturedPage(highResShots?.base ?? ''); setStitchFailure(undefined) }} disabled={!highResShots?.base}>通常スキャンで続ける</button></div></section></div>}
    <PreviewModal open={previewOpen} pages={pages} fileName={fileName} intent={previewIntent} busy={isBusy} ocrStatus={ocrStatus} onClose={() => setPreviewOpen(false)} onSave={performExportPdf} onShare={performSharePdf} onSaveText={performSaveText} onSaveWord={performSaveWord} />

    <header className="hero"><div><span className="badge">書類をすばやくデジタル化</span><h1>Scanner</h1><p>撮影したページを整えて、OCR・翻訳・各形式で保存できます。</p></div><div className="hero-actions"><button type="button" className="primary-button" onClick={() => setCameraOpen(true)}>＋ スキャン</button><label className="secondary-button file-button"><input type="file" accept="image/*" multiple onChange={(event) => void addFiles(event)} hidden />写真を追加</label></div></header>

    <main className="mobile-workspace">
      {(tab === 'capture' || tab === 'pages') && renderPageList()}
      {tab === 'edit' && (selectedPage ? <section className="workspace"><div className="card controls-card"><div className="section-title-row"><h2>編集</h2><span>{selectedPage.name}</span></div><div className="edit-controls"><div className="button-row wrap">{filters.map((filter) => <button key={filter.key} type="button" className={selectedPage.filter === filter.key ? 'chip active' : 'chip'} onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, filter: filter.key }))}>{filter.label}</button>)}</div><button type="button" className={selectedPage.clean ? 'chip active' : 'chip'} onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, clean: !page.clean }))}>クリーン {selectedPage.clean ? 'オン' : 'オフ'}</button><div className="button-row wrap"><button type="button" className="chip" onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation - 90 }))}>左回転</button><button type="button" className="chip" onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation + 90 }))}>右回転</button><button type="button" className="chip" onClick={() => movePage(selectedPage.id, -1)}>前へ</button><button type="button" className="chip" onClick={() => movePage(selectedPage.id, 1)}>次へ</button><button type="button" className="chip danger" onClick={() => removePage(selectedPage.id)}>削除</button></div></div></div><div ref={cornerEditorRef}><CornerEditor imageUrl={selectedPage.dataUrl} filter={selectedPage.filter} clean={selectedPage.clean} corners={selectedPage.corners} detectionMode={selectedPage.cornerDetection} detecting={detectingId === selectedPage.id} onChange={(corners) => updatePageImage(selectedPage.id, (page) => ({ ...page, corners, cornerDetection: 'manual' }))} onRedetect={() => void redetectCorners(selectedPage)} /></div><CorrectedPreview page={selectedPage} /><OcrTextPanel page={selectedPage} pageIndex={Math.max(0, selectedIndex)} pageCount={pages.length} busy={panelBusy} statusMessage={pageOcrStatus} onTextChange={(text) => updatePage(selectedPage.id, (page) => ({ ...page, ocrText: text, ocrStatus: 'done', translationStatus: page.translationText || page.translationStatus === 'done' ? 'stale' : page.translationStatus }))} onRecognize={() => void runPageOcr(selectedPage, false)} onRerecognize={() => void runPageOcr(selectedPage, true)} onShareGpt={() => void handleShareGpt()} onOpenTranslation={openTranslationPanel} gptFallbackVisible={gptFallbackVisible} onDismissGptFallback={() => setGptFallbackVisible(false)} /><div ref={translationPanelRef}><TranslationPanel page={selectedPage} busy={panelBusy} openSignal={translationOpenSignal} onBusyChange={setPanelBusy} onUpdate={(updater) => updatePage(selectedPage.id, updater)} /></div></section> : <section className="card placeholder-card"><h2>ページを選んでください</h2><p>撮影した書類の補正、OCR、翻訳をここで行えます。</p></section>)}
    </main>

    {tab === 'edit' && selectedPage && <div className="edit-toolbar"><button type="button" onClick={scrollToCorners}>切抜き</button><button type="button" onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation + 90 }))}>回転</button><button type="button" onClick={() => document.querySelector('.edit-controls')?.scrollIntoView({ behavior: 'smooth' })}>フィルター</button><button type="button" onClick={() => updatePageImage(selectedPage.id, (page) => ({ ...page, clean: !page.clean }))}>補正</button><button type="button" onClick={() => void runPageOcr(selectedPage, false)}>OCR</button></div>}
    {saveSheetOpen && <div className="sheet-scrim" onClick={() => setSaveSheetOpen(false)}><section className="save-sheet" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><label className="field"><span>ファイル名</span><input value={fileName} onChange={(event) => setFileName(event.target.value)} /></label><div className="save-options"><button type="button" onClick={() => openPreview('save')} disabled={!pages.length || anyBusy}>PDF</button><button type="button" onClick={() => void performSaveJpeg()} disabled={!pages.length || anyBusy}>JPEG</button><button type="button" onClick={() => void performSaveText()} disabled={!pages.length || anyBusy}>TXT</button><button type="button" onClick={() => void performSaveWord()} disabled={!pages.length || anyBusy}>Word</button><button type="button" onClick={() => openPreview('share')} disabled={!pages.length || anyBusy}>共有</button><button type="button" onClick={() => { setSaveSheetOpen(false); void handleShareGpt() }} disabled={!pages.length || anyBusy}>GPT共有</button></div></section></div>}
    <nav className="bottom-tabs" aria-label="主な操作"><button type="button" className={tab === 'capture' ? 'active' : ''} onClick={() => { setTab('capture'); setCameraOpen(true) }}>撮影</button><button type="button" className={tab === 'pages' ? 'active' : ''} onClick={() => setTab('pages')}>ページ</button><button type="button" className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>編集</button><button type="button" className={tab === 'save' ? 'active' : ''} onClick={() => { setTab('save'); setSaveSheetOpen(true) }}>保存</button></nav>
  </div>
}