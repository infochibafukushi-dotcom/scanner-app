export type BookPageOrder = 'ltr' | 'rtl'

export const BOOK_PAGE_ORDER_STORAGE_KEY = 'scanner-book-page-order'

/** Default LTR so existing document-oriented habits stay predictable. */
export const loadBookPageOrder = (): BookPageOrder => {
  try {
    const value = localStorage.getItem(BOOK_PAGE_ORDER_STORAGE_KEY)
    return value === 'rtl' ? 'rtl' : 'ltr'
  } catch {
    return 'ltr'
  }
}

export const saveBookPageOrder = (order: BookPageOrder) => {
  try {
    localStorage.setItem(BOOK_PAGE_ORDER_STORAGE_KEY, order)
  } catch {
    // ignore quota / private mode
  }
}
