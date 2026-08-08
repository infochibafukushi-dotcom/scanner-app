import { ChangeEvent, useMemo, useState } from 'react'
import { CameraCapture } from './components/CameraCapture'
import { CornerEditor } from './components/CornerEditor'
import { CorrectedPreview } from './components/CorrectedPreview'
import { PreviewModal } from './components/PreviewModal'
import type { FilterMode, ScanPage } from './types'
import { detectDocumentCorners } from './utils/corners'
import { recognizePages } from './utils/ocr'
import { buildPdfBlob, downloadPdf } from './utils/pdf'
import { downloadTextFile, downloadWordFile } from './utils/textExport'

type PreviewIntent = 'preview' | 'save' | 'share' | 'text' | 'word'

const initialFileName = () => {
  const date = new Date()
  const yyyy = date.getFullYear()
  const mm = `${date.getMonth() + 1}`.padStart(2, '0')
  const dd = `${date.getDate()}`.padStart(2, '0')
  const hh = `${date.getHours()}`.padStart(2, '0')
  const min = `${date.getMinutes()}`.padStart(2, '0')
  return `scan-${yyyy}${mm}${dd}-${hh}${min}.pdf`
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
    rotation: 0,
    filter: 'color'
  }
}

const filters: { key: FilterMode; label: string }[] = [
  { key: 'color', label: 'カラー' },
  { key: 'gray', label: 'グレー' },
  { key: 'bw', label: '白黒' }
]

export default function App() {
  const [pages, setPages] = useState<ScanPage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [detectingId, setDetectingId] = useState<string | null>(null)
  const [fileName, setFileName] = useState(initialFileName())
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewIntent, setPreviewIntent] = useState<PreviewIntent>('preview')
  const [ocrStatus, setOcrStatus] = useState('')
  const selectedPage = useMemo(() => pages.find((page) => page.id === selectedId) ?? null, [pages, selectedId])

  const appendPage = (page: ScanPage) => {
    setPages((current) => [...current, page])
    setSelectedId((current) => current ?? page.id)
  }

  const addCapturedPage = async (dataUrl: string) => {
    const pageNumber = pages.length + 1
    const page = await makePage(dataUrl, `撮影-${pageNumber}`)
    appendPage(page)
  }

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    setIsBusy(true)
    try {
      const nextPages = await Promise.all(
        files.map(async (file) => makePage(await readAsDataUrl(file), file.name))
      )
      setPages((current) => [...current, ...nextPages])
      setSelectedId((current) => current ?? nextPages[0]?.id ?? null)
    } finally {
      setIsBusy(false)
      event.target.value = ''
    }
  }

  const updatePage = (pageId: string, updater: (page: ScanPage) => ScanPage) => {
    setPages((current) => current.map((page) => (page.id === pageId ? updater(page) : page)))
  }

  const removePage = (pageId: string) => {
    setPages((current) => {
      const next = current.filter((page) => page.id !== pageId)
      if (selectedId === pageId) setSelectedId(next[0]?.id ?? null)
      return next
    })
  }

  const movePage = (pageId: string, direction: -1 | 1) => {
    setPages((current) => {
      const index = current.findIndex((page) => page.id === pageId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [page] = next.splice(index, 1)
      next.splice(targetIndex, 0, page)
      return next
    })
  }

  const redetectCorners = async (page: ScanPage) => {
    setDetectingId(page.id)
    try {
      const detection = await detectDocumentCorners(page.dataUrl)
      updatePage(page.id, (current) => ({
        ...current,
        corners: detection.corners,
        cornerDetection: detection.detected ? 'auto' : 'fallback'
      }))
      if (!detection.detected) window.alert('書類の輪郭を自動判定できませんでした。青い四隅を手動で合わせてください。')
    } finally {
      setDetectingId(null)
    }
  }

  const openPreview = (intent: PreviewIntent) => {
    if (!pages.length) return
    setPreviewIntent(intent)
    setOcrStatus('')
    setPreviewOpen(true)
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
      const blob = await buildPdfBlob(pages)
      const finalName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`
      const file = new File([blob], finalName, { type: 'application/pdf' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: finalName })
        setPreviewOpen(false)
        return
      }

      await downloadPdf(pages, finalName)
      setPreviewOpen(false)
      window.alert('この端末ではファイル共有に対応していないため、PDFを保存しました。')
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return
      console.error(error)
      window.alert('共有に失敗しました。')
    } finally {
      setIsBusy(false)
    }
  }

  const runOcr = async () => {
    setOcrStatus('OCRを準備しています…')
    return recognizePages(pages, (message, progress) => {
      const percent = Math.round(progress * 100)
      setOcrStatus(`${message}${percent > 0 ? ` ${percent}%` : ''}`)
    })
  }

  const performSaveText = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      const texts = await runOcr()
      downloadTextFile(texts, fileName)
      setPreviewOpen(false)
    } catch (error) {
      console.error(error)
      window.alert('テキスト保存に失敗しました。通信状態を確認してもう一度お試しください。')
    } finally {
      setOcrStatus('')
      setIsBusy(false)
    }
  }

  const performSaveWord = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      const texts = await runOcr()
      setOcrStatus('Wordファイルを作成しています…')
      await downloadWordFile(texts, fileName)
      setPreviewOpen(false)
    } catch (error) {
      console.error(error)
      window.alert('Word保存に失敗しました。通信状態を確認してもう一度お試しください。')
    } finally {
      setOcrStatus('')
      setIsBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={addCapturedPage} />
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
          <span className="badge">PWA / ホーム画面追加対応</span>
          <h1>Scanner</h1>
          <p>連続撮影、四隅自動判定、台形補正、保存前プレビュー、PDF・テキスト・Word保存に対応します。</p>
        </div>
        <div className="hero-actions">
          <button type="button" className="primary-button" onClick={() => setCameraOpen(true)}>
            カメラで連続撮影
          </button>
          <label className="secondary-button file-button">
            <input type="file" accept="image/*" multiple onChange={addFiles} hidden />
            写真から追加
          </label>
          <button type="button" className="secondary-button" onClick={() => openPreview('preview')} disabled={!pages.length || isBusy}>仕上がり確認</button>
          <button type="button" className="secondary-button" onClick={() => openPreview('save')} disabled={!pages.length || isBusy}>PDF保存</button>
          <button type="button" className="secondary-button" onClick={() => openPreview('text')} disabled={!pages.length || isBusy}>テキスト保存</button>
          <button type="button" className="secondary-button" onClick={() => openPreview('word')} disabled={!pages.length || isBusy}>Word保存</button>
          <button type="button" className="secondary-button" onClick={() => openPreview('share')} disabled={!pages.length || isBusy}>共有</button>
        </div>
      </header>

      <main className="layout">
        <section className="sidebar card">
          <div className="section-title-row">
            <h2>ページ一覧</h2>
            <span>{pages.length}枚</span>
          </div>

          {!pages.length && (
            <div className="empty-state">
              <p>まだページがありません。</p>
              <p>カメラで連続撮影するか、保存済みの写真を追加してください。</p>
            </div>
          )}

          <div className="thumbnail-list">
            {pages.map((page, index) => (
              <button
                key={page.id}
                type="button"
                className={`thumbnail-card ${selectedId === page.id ? 'active' : ''}`}
                onClick={() => setSelectedId(page.id)}
              >
                <img src={page.dataUrl} alt={page.name} />
                <div className="thumbnail-meta">
                  <strong>{index + 1}. {page.name}</strong>
                  <span>{page.filter === 'color' ? 'カラー' : page.filter === 'gray' ? 'グレー' : '白黒'}</span>
                  <span>{page.cornerDetection === 'auto' ? '四隅: 自動' : page.cornerDetection === 'manual' ? '四隅: 手動調整済み' : '四隅: 要確認'}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace">
          <div className="card export-card">
            <div className="section-title-row"><h2>出力設定</h2></div>
            <label className="field">
              <span>ファイル名</span>
              <input value={fileName} onChange={(event) => setFileName(event.target.value)} />
            </label>
            <p className="helper-text">PDFは画像として保存します。テキスト・Wordは補正後画像をOCRして文字データとして保存します。</p>
          </div>

          {selectedPage ? (
            <>
              <div className="card controls-card">
                <div className="section-title-row">
                  <h2>ページ編集</h2>
                  <span>{selectedPage.name}</span>
                </div>
                <div className="controls-grid">
                  <div className="button-row wrap">
                    {filters.map((filter) => (
                      <button
                        key={filter.key}
                        type="button"
                        className={selectedPage.filter === filter.key ? 'chip active' : 'chip'}
                        onClick={() => updatePage(selectedPage.id, (page) => ({ ...page, filter: filter.key }))}
                      >{filter.label}</button>
                    ))}
                  </div>
                  <div className="button-row wrap">
                    <button type="button" className="chip" onClick={() => updatePage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation - 90 }))}>左回転</button>
                    <button type="button" className="chip" onClick={() => updatePage(selectedPage.id, (page) => ({ ...page, rotation: page.rotation + 90 }))}>右回転</button>
                    <button type="button" className="chip" onClick={() => movePage(selectedPage.id, -1)}>前へ</button>
                    <button type="button" className="chip" onClick={() => movePage(selectedPage.id, 1)}>次へ</button>
                    <button type="button" className="chip danger" onClick={() => removePage(selectedPage.id)}>削除</button>
                  </div>
                </div>
              </div>

              <CornerEditor
                imageUrl={selectedPage.dataUrl}
                filter={selectedPage.filter}
                corners={selectedPage.corners}
                detectionMode={selectedPage.cornerDetection}
                detecting={detectingId === selectedPage.id}
                onChange={(corners) => updatePage(selectedPage.id, (page) => ({ ...page, corners, cornerDetection: 'manual' }))}
                onRedetect={() => redetectCorners(selectedPage)}
              />

              <CorrectedPreview page={selectedPage} />
            </>
          ) : (
            <div className="card placeholder-card">
              <h2>スキャンを開始してください</h2>
              <p>撮影したページを選ぶと、四隅・台形補正・回転・画像モードを編集できます。</p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
