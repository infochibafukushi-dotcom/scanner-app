import { ChangeEvent, useMemo, useState } from 'react'
import { CameraCapture } from './components/CameraCapture'
import { CornerEditor } from './components/CornerEditor'
import type { FilterMode, ScanPage } from './types'
import { defaultCorners } from './utils/image'
import { buildPdfBlob, downloadPdf } from './utils/pdf'

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

const makePage = (dataUrl: string, name: string): ScanPage => ({
  id: crypto.randomUUID(),
  name,
  dataUrl,
  corners: defaultCorners(),
  rotation: 0,
  filter: 'color'
})

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
  const [fileName, setFileName] = useState(initialFileName())
  const selectedPage = useMemo(() => pages.find((page) => page.id === selectedId) ?? null, [pages, selectedId])

  const appendPage = (page: ScanPage) => {
    setPages((current) => [...current, page])
    setSelectedId((current) => current ?? page.id)
  }

  const addCapturedPage = (dataUrl: string) => {
    const pageNumber = pages.length + 1
    appendPage(makePage(dataUrl, `撮影-${pageNumber}`))
  }

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    const nextPages = await Promise.all(files.map(async (file) => makePage(await readAsDataUrl(file), file.name)))
    setPages((current) => [...current, ...nextPages])
    setSelectedId((current) => current ?? nextPages[0]?.id ?? null)
    event.target.value = ''
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

  const exportPdf = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      await downloadPdf(pages, fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`)
    } catch (error) {
      console.error(error)
      window.alert('PDFの作成に失敗しました。四隅の位置を確認してください。')
    } finally {
      setIsBusy(false)
    }
  }

  const sharePdf = async () => {
    if (!pages.length) return
    setIsBusy(true)
    try {
      const blob = await buildPdfBlob(pages)
      const finalName = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`
      const file = new File([blob], finalName, { type: 'application/pdf' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: finalName })
        return
      }

      await downloadPdf(pages, finalName)
      window.alert('この端末ではファイル共有に対応していないため、PDFを保存しました。')
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return
      console.error(error)
      window.alert('共有に失敗しました。')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="app-shell">
      <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={addCapturedPage} />

      <header className="hero">
        <div>
          <span className="badge">PWA / ホーム画面追加対応</span>
          <h1>Scanner</h1>
          <p>連続撮影、四隅補正、複数ページ結合、PDF保存・共有を1つの画面で行えます。</p>
        </div>
        <div className="hero-actions">
          <button type="button" className="primary-button" onClick={() => setCameraOpen(true)}>
            カメラで連続撮影
          </button>
          <label className="secondary-button file-button">
            <input type="file" accept="image/*" multiple onChange={addFiles} hidden />
            写真から追加
          </label>
          <button type="button" className="secondary-button" onClick={exportPdf} disabled={!pages.length || isBusy}>PDF保存</button>
          <button type="button" className="secondary-button" onClick={sharePdf} disabled={!pages.length || isBusy}>共有</button>
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
            <p className="helper-text">「共有」を押すとスマホの共有メニューが開き、LINE・メール・Google Driveなどを選択できます。</p>
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
                corners={selectedPage.corners}
                onChange={(corners) => updatePage(selectedPage.id, (page) => ({ ...page, corners }))}
              />
            </>
          ) : (
            <div className="card placeholder-card">
              <h2>スキャンを開始してください</h2>
              <p>撮影したページを選ぶと、四隅・回転・画像モードを編集できます。</p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
