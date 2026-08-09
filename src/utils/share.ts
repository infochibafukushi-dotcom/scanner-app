import type { ScanPage } from '../types'
import { RENDER_MAX, renderScanPage } from './image'

export const isAbortError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError')

export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy path
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    textarea.remove()
    return ok
  } catch {
    return false
  }
}

export type ShareTextResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export const shareText = async (title: string, text: string): Promise<ShareTextResult> => {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title, text })
      return 'shared'
    }
  } catch (error) {
    if (isAbortError(error)) return 'cancelled'
  }

  const copied = await copyText(text)
  return copied ? 'copied' : 'failed'
}

const canvasToJpegFile = (canvas: HTMLCanvasElement, fileName: string, quality = 0.92) =>
  new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('JPEGの作成に失敗しました。'))
        return
      }
      resolve(new File([blob], fileName, { type: 'image/jpeg' }))
    }, 'image/jpeg', quality)
  })

export const buildCorrectedImageFiles = async (pages: ScanPage[]) =>
  Promise.all(
    pages.map(async (page, index) => {
      const canvas = await renderScanPage(page, RENDER_MAX.export)
      return canvasToJpegFile(canvas, `scan-page-${index + 1}.jpg`)
    })
  )

export const buildGptDocumentPrompt = (texts: string[]) => {
  const body = texts
    .map((text, index) => `--- ${index + 1}ページ ---\n${text || '（文字を認識できませんでした）'}`)
    .join('\n\n')

  return [
    '以下はスキャンした文書です。',
    '画像と読み取った文字を確認してください。',
    '',
    '必要に応じて、',
    '・内容整理',
    '・誤認識修正',
    '・要約',
    '・翻訳',
    '・質問への回答',
    'を行ってください。',
    '',
    '【読み取った文字】',
    '',
    body
  ].join('\n')
}

export const buildGptTranslationPrompt = (sourceText: string, translationText: string) =>
  [
    '以下はスキャン文書の読み取り結果と翻訳結果です。',
    '内容を確認してください。',
    '',
    '【原文】',
    sourceText || '（原文なし）',
    '',
    '【翻訳】',
    translationText || '（翻訳なし）'
  ].join('\n')

export type GptShareResult =
  | { type: 'shared' }
  | { type: 'clipboard' }
  | { type: 'cancelled' }
  | { type: 'failed'; message?: string }

export const shareWithGpt = async (
  prompt: string,
  files?: File[]
): Promise<GptShareResult> => {
  try {
    if (files?.length && typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
      await navigator.share({
        title: 'スキャン文書',
        text: prompt,
        files
      })
      return { type: 'shared' }
    }

    if (typeof navigator.share === 'function' && !files?.length) {
      await navigator.share({
        title: 'スキャン文書',
        text: prompt
      })
      return { type: 'shared' }
    }
  } catch (error) {
    if (isAbortError(error)) return { type: 'cancelled' }
  }

  const copied = await copyText(prompt)
  return copied
    ? { type: 'clipboard' }
    : { type: 'failed', message: '共有にもコピーにも対応していません。' }
}

export const sharePagesWithGpt = async (pages: ScanPage[], texts: string[]): Promise<GptShareResult> => {
  const prompt = buildGptDocumentPrompt(texts)
  let files: File[] | undefined

  try {
    files = await buildCorrectedImageFiles(pages)
  } catch (error) {
    console.error(error)
    files = undefined
  }

  return shareWithGpt(prompt, files)
}

export const openChatGpt = () => {
  window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer')
}
