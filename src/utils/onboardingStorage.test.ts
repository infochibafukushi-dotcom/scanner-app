import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ONBOARDING_STORAGE_KEY,
  isOnboardingComplete,
  markOnboardingComplete,
  resetOnboardingForDev
} from './onboardingStorage'

const memory = new Map<string, string>()

describe('onboardingStorage', () => {
  beforeEach(() => {
    memory.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is incomplete by default', () => {
    expect(isOnboardingComplete()).toBe(false)
  })

  it('marks complete and reads back', () => {
    markOnboardingComplete()
    expect(isOnboardingComplete()).toBe(true)
    expect(memory.get(ONBOARDING_STORAGE_KEY)).toBe('1')
  })

  it('can reset for development', () => {
    markOnboardingComplete()
    resetOnboardingForDev()
    expect(isOnboardingComplete()).toBe(false)
  })
})
