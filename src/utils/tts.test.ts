import { describe, expect, it } from 'vitest'
import { isSpeechSupported, stopSpeech } from './tts'

describe('tts helpers', () => {
  it('reports support without throwing', () => {
    expect(typeof isSpeechSupported()).toBe('boolean')
  })

  it('stopSpeech is safe when unsupported', () => {
    expect(() => stopSpeech()).not.toThrow()
  })
})
