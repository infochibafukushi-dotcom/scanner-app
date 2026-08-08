import { useEffect, useState } from 'react'
import type { ScanPage } from '../types'
import { getPageOcrText } from '../utils/ocr'
import { copyText, openChatGpt, shareText } from '../utils/share'

type OcrTextPanelProps = {
  page: ScanPage
  pageIndex: number
  pageCount: number
  busy: boolean
  statusMessage: string
  onTextChange: (text: string) => void
  onRecognize: () => void
  onRerecognize: () => void
  onShareGpt: () => void
  onOpenTranslation: () => void
  gptFallbackVisible: boolean
  onDismissGptFallback: () => void
}

export function OcrTextPanel({
  page,
  pageIndex,
  pageCount,
  busy,
  statusMessage,
  onTextChange,
  onRecognize,
  onRerecognize,
  onShareGpt,
  onOpenTranslation,
  gptFallbackVisible,
  onDismissGptFallback
}: OcrTextPanelProps) {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')
  const text = getPageOcrText(page)
  const hasResult = typeof page.ocrText === 'string'
  const isProcessing = page.ocrStatus === 'processing' || busy

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const showToast = (message: string) => setToast(message)

  const handleCopy = async () => {
    if (!text) {
      showToast('コピーするテキストがありません')
      return
    }
    const ok = await copyText(text)
    showToast(ok ? 'コピーしました' : 'コピーに失敗しました')
  }

  const handleShareText = async () => {
    if (!text) {
      showToast('共有するテキストがありません')
      return
    }
    const result = await shareText('スキャン文書', text)
    if (result === 'shared') showToast('共有しました')
    else if (result === 'copied') showToast('コピーしました')
    else if (result === 'failed') showToast('共有に失敗しました')
  }

  const summaryLabel = () => {
    if (page.ocrStatus === 'processing') return '読み取り中…'
    if (page.ocrStatus === 'stale') return '要再読取'
    if (page.ocrStatus === 'error') return '読み取り失敗'
    if (hasResult) return text ? `${text.length}文字` : '結果あり（空）'
    return 'OCR未実行'
  }

  return (
    <div className={`card accordion-card ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="accordion-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="accordion-chevron" aria-hidden>{open ? '▼' : '▶'}</span>
        <span className="accordion-title">読み取ったテキスト</span>
        <span className="accordion-summary">{summaryLabel()}</span>
      </button>

      {open && (
        <div className="accordion-body">
          {statusMessage && <div className="panel-status">{statusMessage}</div>}
          {page.ocrStatus === 'stale' && (
            <div className="panel-hint">画像が変更されました。再読み取りしてください。</div>
          )}
          {page.ocrStatus === 'error' && page.ocrError && (
            <div className="panel-error">{page.ocrError}</div>
          )}

          {!hasResult ? (
            <div className="button-row wrap">
              <button
                type="button"
                className="primary-button"
                onClick={onRecognize}
                disabled={isProcessing}
              >
                文字を読み取る
              </button>
              <button type="button" className="chip" onClick={onShareGpt} disabled={isProcessing}>
                GPTへ共有
              </button>
            </div>
          ) : (
            <>
              <label className="field">
                <span>OCR結果：</span>
                <textarea
                  className="ocr-textarea"
                  value={text}
                  rows={8}
                  onChange={(event) => onTextChange(event.target.value)}
                  disabled={isProcessing}
                  placeholder="認識結果がここに表示されます"
                />
              </label>

              <div className="button-row wrap">
                <button type="button" className="chip" onClick={onRerecognize} disabled={isProcessing}>
                  再読み取り
                </button>
                <button type="button" className="chip" onClick={handleCopy} disabled={isProcessing || !text}>
                  コピー
                </button>
                <button type="button" className="chip" onClick={handleShareText} disabled={isProcessing || !text}>
                  テキスト共有
                </button>
                <button type="button" className="chip" onClick={onShareGpt} disabled={isProcessing}>
                  GPTへ共有
                </button>
                <button type="button" className="chip" onClick={onOpenTranslation} disabled={isProcessing}>
                  翻訳
                </button>
              </div>
            </>
          )}

          {pageCount > 1 && (
            <p className="helper-text">GPT共有は全{pageCount}ページ（現在 {pageIndex + 1} ページ目）をまとめて送ります。</p>
          )}

          {gptFallbackVisible && (
            <div className="fallback-box">
              <p>GPT用テキストをコピーしました。ChatGPTで貼り付けて画像を添付してください。</p>
              <div className="button-row wrap">
                <button type="button" className="primary-button" onClick={openChatGpt}>ChatGPTを開く</button>
                <button type="button" className="chip" onClick={onDismissGptFallback}>閉じる</button>
              </div>
            </div>
          )}

          {toast && <div className="panel-toast" role="status">{toast}</div>}
        </div>
      )}
    </div>
  )
}
