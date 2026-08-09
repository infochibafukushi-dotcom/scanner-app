import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_MODE_STORAGE_KEY, loadCaptureMode, saveCaptureMode } from './captureModeStorage'

describe('captureModeStorage', () => {
  const store = new Map<string, string>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to document and remembers book', () => {
    expect(loadCaptureMode()).toBe('document')
    saveCaptureMode('book')
    expect(loadCaptureMode()).toBe('book')
    expect(store.get(CAPTURE_MODE_STORAGE_KEY)).toBe('book')
    saveCaptureMode('document')
    expect(loadCaptureMode()).toBe('document')
  })
})
