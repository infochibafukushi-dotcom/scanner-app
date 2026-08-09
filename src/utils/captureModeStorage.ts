import type { CaptureMode } from '../types'

export const CAPTURE_MODE_STORAGE_KEY = 'scanner-capture-mode'

export const loadCaptureMode = (): CaptureMode => {
  try {
    const value = localStorage.getItem(CAPTURE_MODE_STORAGE_KEY)
    return value === 'book' ? 'book' : 'document'
  } catch {
    return 'document'
  }
}

export const saveCaptureMode = (mode: CaptureMode) => {
  try {
    localStorage.setItem(CAPTURE_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore quota / private mode
  }
}
