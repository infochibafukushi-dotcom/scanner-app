import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOOK_PAGE_ORDER_STORAGE_KEY,
  loadBookPageOrder,
  saveBookPageOrder
} from './bookPageOrderStorage'

describe('bookPageOrderStorage', () => {
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

  it('defaults to ltr and can switch to rtl', () => {
    expect(loadBookPageOrder()).toBe('ltr')
    saveBookPageOrder('rtl')
    expect(loadBookPageOrder()).toBe('rtl')
    expect(store.get(BOOK_PAGE_ORDER_STORAGE_KEY)).toBe('rtl')
  })
})
