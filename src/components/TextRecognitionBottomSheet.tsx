import { useEffect, useState } from 'react'
import type { ScanPage } from '../types'
import { getPageOcrText } from '../utils/ocr'
import { copyText, openChatGpt, shareText } from '../utils/share'
import { BottomSheet } from './BottomSheet'
import { TranslationPanel } from './TranslationPanel'

type Props = {
  open: boolean
  page: ScanPage
  pageIndex: number
  pageCount: number
  busy: boolean
  statusMessage: string
  gptFallbackVisible: boolean
  onClose: () => void
  onTextChange: (text: string) => void
  onRecognize: () => void
  onRerecognize: () => void
  onShareGpt: () => void
  onDismissGptFallback: () => void
  onUpdatePage: (updater: (page: ScanPage) => ScanPage) => void
  onBusyChange: (busy: boolean) => void
}

export function TextRecognitionBottomSheet({
  open,
  page,
  pageIndex,
  pageCount,
  busy,
  statusMessage,
  gptFallbackVisible,
  onClose,
  onTextChange,
  onRecognize,
  onRerecognize,
  onShareGpt,
  onDismissGptFallback,
  onUpdatePage,
  onBusyChange
}: Props) {
  const [toast, setToast] = useState('')
  const [translationOpenSignal, setTranslationOpenSignal] = useState(0)
  const text = getPageOcrText(page)
  const hasResult = typeof page.ocrText === 'string'
  const isProcessing = page.ocrStatus === 'processing' || busy

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (open) setTranslationOpenSignal((value) => value + 1)
  }, [open])

  const handleCopy = async () => {
    if (!text) {
      setToast('コピーするテキストがありません')
      return
    }
    setToast((await copyText(text)) ? 'コピーしました' : 'コピーに失敗しました')
  }

  const handleShare = async () => {
    if (!text) {
      setToast('共有するテキストがありません')
      return
    }
    const result = await shareText('スキャン文書', text)
    if (result === 'shared') setToast('共有しました')
    else if (result === 'copied') setToast('コピーしました')
    else if (result === 'failed') setToast('共有に失敗しました')
  }

  return (
    <BottomSheet open={open} title="文字読取" onClose={onClose} tall className="text-recognition-sheet">
      {statusMessage && <div className="sheet-status">{statusMessage}</div>}
      {page.ocrStatus === 'stale' && <div className="panel-hint">画像が変更されました。再読取してください。</div>}
      {page.ocrStatus === 'error' && page.ocrError && <div className="panel-error">{page.ocrError}</div>}

      <label className="field">
        <span>読み取った文字</span>
        <textarea
          className="ocr-textarea"
          value={text}
          rows={8}
          onChange={(event) => onTextChange(event.target.value)}
          disabled={isProcessing}
          placeholder="読み取った文字がここに表示されます"
          aria-label="読み取った文字"
        />
      </label>

      <div className="button-row wrap">
        {!hasResult ? (
          <button
            type="button"
            className="primary-button"
            onClick={onRecognize}
            disabled={isProcessing}
            aria-label="文字を読み取る"
          >
            文字を読み取る
          </button>
        ) : (
          <button type="button" className="chip" onClick={onRerecognize} disabled={isProcessing} aria-label="再読取">
            再読取
          </button>
        )}
        <button type="button" className="chip" onClick={() => void handleCopy()} disabled={isProcessing || !text}>
          コピー
        </button>
        <button type="button" className="chip" onClick={() => void handleShare()} disabled={isProcessing || !text}>
          共有
        </button>
        <button type="button" className="chip" onClick={onShareGpt} disabled={isProcessing}>
          ChatGPTへ共有
        </button>
      </div>

      {pageCount > 1 && (
        <p className="helper-text">
          ChatGPTへ共有は全{pageCount}ページ（現在 {pageIndex + 1} ページ目）をまとめて送ります。
        </p>
      )}

      <div className="translation-inline">
        <h3>翻訳</h3>
        <TranslationPanel
          page={page}
          busy={busy}
          openSignal={translationOpenSignal}
          onBusyChange={onBusyChange}
          onUpdate={onUpdatePage}
        />
      </div>

      {gptFallbackVisible && (
        <div className="fallback-box">
          <p>ChatGPT用テキストをコピーしました。ChatGPTで貼り付けて画像を添付してください。</p>
          <div className="button-row wrap">
            <button type="button" className="primary-button" onClick={openChatGpt}>
              ChatGPTを開く
            </button>
            <button type="button" className="chip" onClick={onDismissGptFallback}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="panel-toast" role="status">
          {toast}
        </div>
      )}
    </BottomSheet>
  )
}
