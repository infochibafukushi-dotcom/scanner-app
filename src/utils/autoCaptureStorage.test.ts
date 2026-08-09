import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_CAPTURE_STORAGE_KEY,
  loadAutoCapturePreference,
  saveAutoCapturePreference
} from './autoCaptureStorage'

describe('autoCaptureStorage', () => {
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

  it('defaults to manual and remembers the user choice', () => {
    expect(loadAutoCapturePreference()).toBe(false)
    saveAutoCapturePreference(true)
    expect(loadAutoCapturePreference()).toBe(true)
    expect(store.get(AUTO_CAPTURE_STORAGE_KEY)).toBe('1')
    saveAutoCapturePreference(false)
    expect(loadAutoCapturePreference()).toBe(false)
  })
})
