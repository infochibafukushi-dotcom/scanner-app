export type TranslationTarget = {
  code: string
  label: string
}

export const TRANSLATION_TARGETS: TranslationTarget[] = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: '英語' },
  { code: 'zh-Hans', label: '中国語（簡体）' },
  { code: 'ko', label: '韓国語' },
  { code: 'es', label: 'スペイン語' },
  { code: 'fr', label: 'フランス語' },
  { code: 'de', label: 'ドイツ語' }
]

export class TranslatorUnsupportedError extends Error {
  constructor(message = 'このブラウザではアプリ内翻訳に対応していません') {
    super(message)
    this.name = 'TranslatorUnsupportedError'
  }
}

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | string

type TranslatorLike = {
  availability: (options: { sourceLanguage: string; targetLanguage: string }) => Promise<Availability>
  create: (options: {
    sourceLanguage: string
    targetLanguage: string
    monitor?: (monitor: { addEventListener: (type: string, listener: (event: { loaded: number }) => void) => void }) => void
  }) => Promise<{ translate: (text: string) => Promise<string>; destroy?: () => void }>
}

type LanguageDetectorLike = {
  availability: (options?: Record<string, never>) => Promise<Availability>
  create: (options?: {
    monitor?: (monitor: { addEventListener: (type: string, listener: (event: { loaded: number }) => void) => void }) => void
  }) => Promise<{
    detect: (text: string) => Promise<Array<{ detectedLanguage: string; confidence: number }>>
    destroy?: () => void
  }>
}

const getTranslatorApi = (): TranslatorLike | null => {
  const api = (globalThis as { Translator?: TranslatorLike }).Translator
  return api && typeof api.availability === 'function' && typeof api.create === 'function' ? api : null
}

const getLanguageDetectorApi = (): LanguageDetectorLike | null => {
  const api = (globalThis as { LanguageDetector?: LanguageDetectorLike }).LanguageDetector
  return api && typeof api.availability === 'function' && typeof api.create === 'function' ? api : null
}

export const isBrowserTranslatorSupported = () => Boolean(getTranslatorApi())

export const getTargetLabel = (code: string) =>
  TRANSLATION_TARGETS.find((target) => target.code === code)?.label ?? code

const detectSourceLanguage = async (
  text: string,
  onStatus?: (message: string) => void
): Promise<string> => {
  const detectorApi = getLanguageDetectorApi()
  if (!detectorApi) return 'en'

  try {
    const availability = await detectorApi.availability()
    if (availability === 'unavailable') return 'en'

    onStatus?.('言語を判定しています…')
    const detector = await detectorApi.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const percent = Math.round((event.loaded || 0) * 100)
          onStatus?.(`言語判定モデルを準備中… ${percent}%`)
        })
      }
    })

    try {
      const results = await detector.detect(text.slice(0, 2000))
      const best = results?.[0]?.detectedLanguage
      return best && best !== 'und' ? best : 'en'
    } finally {
      detector.destroy?.()
    }
  } catch (error) {
    console.error(error)
    return 'en'
  }
}

export const translateText = async (
  text: string,
  targetLanguage: string,
  onStatus?: (message: string) => void
): Promise<string> => {
  const translatorApi = getTranslatorApi()
  if (!translatorApi) throw new TranslatorUnsupportedError()

  const trimmed = text.trim()
  if (!trimmed) return ''

  const sourceLanguage = await detectSourceLanguage(trimmed, onStatus)
  if (sourceLanguage === targetLanguage) return trimmed

  onStatus?.('翻訳モデルを確認しています…')
  const availability = await translatorApi.availability({ sourceLanguage, targetLanguage })
  if (availability === 'unavailable') {
    throw new Error(`この言語ペア（${sourceLanguage} → ${targetLanguage}）は翻訳できません。`)
  }

  onStatus?.('翻訳しています…')
  const translator = await translatorApi.create({
    sourceLanguage,
    targetLanguage,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => {
        const percent = Math.round((event.loaded || 0) * 100)
        onStatus?.(`翻訳モデルを準備中… ${percent}%`)
      })
    }
  })

  try {
    return (await translator.translate(trimmed)).trim()
  } finally {
    translator.destroy?.()
  }
}

export const buildGoogleTranslateUrl = (text: string, targetLanguage: string) => {
  const url = new URL('https://translate.google.com/')
  url.searchParams.set('sl', 'auto')
  url.searchParams.set('tl', targetLanguage === 'zh-Hans' ? 'zh-CN' : targetLanguage)
  url.searchParams.set('text', text.slice(0, 4500))
  return url.toString()
}

export const buildGptTranslateRequest = (text: string, targetLabel: string) =>
  [
    `以下の文章を${targetLabel}へ翻訳してください。`,
    '',
    '【原文】',
    text
  ].join('\n')
