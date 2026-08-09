export const AUTO_CAPTURE_STORAGE_KEY = 'scanner-auto-capture'

export const loadAutoCapturePreference = (): boolean => {
  try {
    return localStorage.getItem(AUTO_CAPTURE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const saveAutoCapturePreference = (enabled: boolean) => {
  try {
    localStorage.setItem(AUTO_CAPTURE_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}
