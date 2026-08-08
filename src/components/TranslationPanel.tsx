import { useEffect, useState } from 'react'
import type { ScanPage } from '../types'
import { getPageOcrText } from '../utils/ocr'
import {
  copyText,
  openChatGpt,
  shareText,
  shareWithGpt,
  buildGptTranslationPrompt
} from '../utils/share'
import {
  TRANSLATION_TARGETS,
  TranslatorUnsupportedError,
  buildGoogleTranslateUrl,
  buildGptTranslateRequest,
  getTargetLabel,
  isBrowserTranslatorSupported,
  translateText
} from '../utils/translate'

type TranslationPanelProps = {
  page: ScanPage
  busy: boolean
  openSignal?: number
  onBusyChange: (busy: boolean) => void
  onUpdate: (updater: (page: ScanPage) => ScanPage) => void
}

export function TranslationPanel({ page, busy, openSignal = 0, onBusyChange, onUpdate }: TranslationPanelProps) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(page.translationTarget || 'ja')
  const [statusMessage, setStatusMessage] = useState('')
  const [toast, setToast] = useState('')
  const [unsupported, setUnsupported] = useState(!isBrowserTranslatorSupported())
  const [gptFallbackVisible, setGptFallbackVisible] = useState(false)
  const sourceText = getPageOcrText(page)
  const translationText = page.translationText ?? ''
  const isProcessing = page.translationStatus === 'processing' || busy

  useEffect(() => {
    setTarget(page.translationTarget || 'ja')
  }, [page.id, page.translationTarget])

  useEffect(() => {
    if (page.translationStatus === 'done' && page.translationText) setOpen(true)
  }, [page.translationStatus, page.translationText])

  useEffect(() => {
    if (openSignal > 0) setOpen(true)
  }, [openSignal])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const showToast = (message: string) => setToast(message)

  const handleTranslate = async () => {
    if (!sourceText.trim()) {
      showToast('先に文字を読み取ってください')
      return
    }
    if (isProcessing) return

    onBusyChange(true)
    setUnsupported(false)
    setStatusMessage('翻訳しています…')
    onUpdate((current) => ({
      ...current,
      translationStatus: 'processing',
      translationTarget: target,
      translationError: undefined
    }))

    try {
      const translated = await translateText(sourceText, target, setStatusMessage)
      onUpdate((current) => ({
        ...current,
        translationText: translated,
        translationTarget: target,
        translationStatus: 'done',
        translationError: undefined
      }))
      setOpen(true)
      setStatusMessage('')
    } catch (error) {
      console.error(error)
      if (error instanceof TranslatorUnsupportedError) {
        setUnsupported(true)
        onUpdate((current) => ({
          ...current,
          translationStatus: 'error',
          translationError: error.message
        }))
        setStatusMessage('')
      } else {
        const message = error instanceof Error ? error.message : '翻訳に失敗しました'
        onUpdate((current) => ({
          ...current,
          translationStatus: 'error',
          translationError: message
        }))
        setStatusMessage('')
        showToast(message)
      }
    } finally {
      onBusyChange(false)
    }
  }

  const handleCopy = async () => {
    if (!translationText) {
      showToast('コピーする翻訳がありません')
      return
    }
    const ok = await copyText(translationText)
    showToast(ok ? 'コピーしました' : 'コピーに失敗しました')
  }

  const handleShare = async () => {
    if (!translationText) {
      showToast('共有する翻訳がありません')
      return
    }
    const result = await shareText('スキャン文書（翻訳）', translationText)
    if (result === 'shared') showToast('共有しました')
    else if (result === 'copied') showToast('コピーしました')
    else if (result === 'failed') showToast('共有に失敗しました')
  }

  const handleGptShare = async () => {
    if (!translationText && !sourceText) {
      showToast('共有するテキストがありません')
      return
    }
    if (isProcessing) return

    onBusyChange(true)
    try {
      const prompt = buildGptTranslationPrompt(sourceText, translationText)
      const result = await shareWithGpt(prompt)
      if (result.type === 'shared') showToast('共有しました')
      else if (result.type === 'clipboard') setGptFallbackVisible(true)
      else if (result.type === 'failed') showToast(result.message || '共有に失敗しました')
    } finally {
      onBusyChange(false)
    }
  }

  const handleGptTranslateFallback = async () => {
    const prompt = buildGptTranslateRequest(sourceText, getTargetLabel(target))
    const ok = await copyText(prompt)
    if (ok) {
      setGptFallbackVisible(true)
      showToast('翻訳用テキストをコピーしました')
    } else {
      const result = await shareText('翻訳依頼', prompt)
      if (result === 'shared') showToast('共有しました')
      else if (result === 'copied') {
        setGptFallbackVisible(true)
        showToast('翻訳用テキストをコピーしました')
      } else if (result !== 'cancelled') {
        showToast('コピーに失敗しました')
      }
    }
  }

  const handleGoogleTranslate = () => {
    if (!sourceText.trim()) {
      showToast('先に文字を読み取ってください')
      return
    }
    window.open(buildGoogleTranslateUrl(sourceText, target), '_blank', 'noopener,noreferrer')
  }

  const summaryLabel = () => {
    if (page.translationStatus === 'processing') return '翻訳中…'
    if (page.translationStatus === 'stale') return '要再翻訳'
    if (page.translationStatus === 'error') return '翻訳失敗'
    if (page.translationStatus === 'done' && translationText) return getTargetLabel(page.translationTarget || target)
    return '未翻訳'
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
        <span className="accordion-title">翻訳結果</span>
        <span className="accordion-summary">{summaryLabel()}</span>
      </button>

      {open && (
        <div className="accordion-body">
          <label className="field">
            <span>翻訳先</span>
            <select
              className="target-select"
              value={target}
              disabled={isProcessing}
              onChange={(event) => setTarget(event.target.value)}
            >
              {TRANSLATION_TARGETS.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>

          <div className="button-row wrap">
            <button
              type="button"
              className="primary-button"
              onClick={handleTranslate}
              disabled={isProcessing || !sourceText.trim()}
            >
              翻訳する
            </button>
          </div>

          {statusMessage && <div className="panel-status">{statusMessage}</div>}
          {page.translationStatus === 'stale' && (
            <div className="panel-hint">原文または画像が変わりました。再翻訳してください。</div>
          )}
          {page.translationError && <div className="panel-error">{page.translationError}</div>}

          {(unsupported || page.translationStatus === 'error') && (
            <div className="fallback-box">
              <p>{unsupported ? 'このブラウザではアプリ内翻訳に対応していません' : 'アプリ内翻訳を利用できませんでした'}</p>
              <div className="button-row wrap">
                <button type="button" className="chip" onClick={handleGptTranslateFallback} disabled={!sourceText.trim()}>
                  GPTで翻訳
                </button>
                <button type="button" className="chip" onClick={handleGoogleTranslate} disabled={!sourceText.trim()}>
                  Google翻訳で開く
                </button>
              </div>
            </div>
          )}

          {(page.translationStatus === 'done' || translationText) && (
            <>
              <label className="field">
                <span>翻訳結果</span>
                <textarea
                  className="ocr-textarea"
                  value={translationText}
                  rows={8}
                  onChange={(event) => onUpdate((current) => ({
                    ...current,
                    translationText: event.target.value,
                    translationStatus: 'done'
                  }))}
                  disabled={isProcessing}
                  placeholder="翻訳結果がここに表示されます"
                />
              </label>

              <div className="button-row wrap">
                <button type="button" className="chip" onClick={handleCopy} disabled={isProcessing || !translationText}>
                  コピー
                </button>
                <button type="button" className="chip" onClick={handleShare} disabled={isProcessing || !translationText}>
                  共有
                </button>
                <button type="button" className="chip" onClick={handleGptShare} disabled={isProcessing}>
                  GPTへ共有
                </button>
              </div>
            </>
          )}

          {gptFallbackVisible && (
            <div className="fallback-box">
              <p>GPT用テキストをコピーしました。ChatGPTで貼り付けてください。</p>
              <div className="button-row wrap">
                <button type="button" className="primary-button" onClick={openChatGpt}>ChatGPTを開く</button>
                <button type="button" className="chip" onClick={() => setGptFallbackVisible(false)}>閉じる</button>
              </div>
            </div>
          )}

          {toast && <div className="panel-toast" role="status">{toast}</div>}
        </div>
      )}
    </div>
  )
}
