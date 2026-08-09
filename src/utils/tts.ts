let currentUtterance: SpeechSynthesisUtterance | null = null

export const isSpeechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

export const stopSpeech = () => {
  if (!isSpeechSupported()) return
  window.speechSynthesis.cancel()
  currentUtterance = null
}

export const speakText = (text: string, lang = 'ja-JP') => {
  if (!isSpeechSupported()) return false
  const trimmed = text.trim()
  if (!trimmed) return false

  stopSpeech()
  const utterance = new SpeechSynthesisUtterance(trimmed)
  utterance.lang = lang
  utterance.rate = 1
  currentUtterance = utterance
  window.speechSynthesis.speak(utterance)
  return true
}

export const isSpeaking = () => isSpeechSupported() && window.speechSynthesis.speaking
