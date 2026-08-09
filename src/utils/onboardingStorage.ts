export const ONBOARDING_STORAGE_KEY = 'scanner-onboarding-complete'

export const isOnboardingComplete = () => {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

export const markOnboardingComplete = () => {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
  } catch {
    // ignore quota / private mode
  }
}

export const resetOnboardingForDev = () => {
  try {
    localStorage.removeItem(ONBOARDING_STORAGE_KEY)
  } catch {
    // ignore
  }
}
