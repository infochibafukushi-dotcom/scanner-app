import { useEffect, useRef, useState } from 'react'
import enhanceAfter from '../assets/onboarding/enhance-after.webp'
import enhanceBefore from '../assets/onboarding/enhance-before.webp'
import perspectiveAfter from '../assets/onboarding/perspective-after.webp'
import perspectiveBefore from '../assets/onboarding/perspective-before.webp'
import qualityAfter from '../assets/onboarding/quality-after.webp'
import qualityBefore from '../assets/onboarding/quality-before.webp'
import { BeforeAfterDemo } from '../components/onboarding/BeforeAfterDemo'
import { OnboardingSlide } from '../components/onboarding/OnboardingSlide'
import { markOnboardingComplete } from '../utils/onboardingStorage'
import '../onboarding.css'

type Props = {
  onComplete: () => void
}

const SLIDES = [
  {
    key: 'enhance',
    title: '書き込みも\nすっきり補正',
    before: enhanceBefore,
    after: enhanceAfter,
    beforeAlt: '影や書き込みのある書類',
    afterAlt: '自動補正後の見やすい書類'
  },
  {
    key: 'perspective',
    title: '斜めの書類も\nまっすぐ補正',
    before: perspectiveBefore,
    after: perspectiveAfter,
    beforeAlt: '斜めに撮影された書類',
    afterAlt: '正面の長方形に補正された書類'
  },
  {
    key: 'quality',
    title: 'いつでも見やすい\nスキャン品質',
    before: qualityBefore,
    after: qualityAfter,
    beforeAlt: '暗い撮影の書類',
    afterAlt: '明るく読みやすいスキャン'
  }
] as const

const SWIPE_THRESHOLD = 56

export function OnboardingView({ onComplete }: Props) {
  const [index, setIndex] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const indexRef = useRef(0)
  const swipingRef = useRef(false)
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const trapActiveRef = useRef(true)
  const isLast = index >= SLIDES.length - 1

  useEffect(() => {
    indexRef.current = index
  }, [index])

  const finish = () => {
    trapActiveRef.current = false
    markOnboardingComplete()
    // Drop the history trap entry so Back from Camera doesn't resurrect onboarding.
    if (window.history.state && (window.history.state as { scannerOnboarding?: boolean }).scannerOnboarding) {
      window.history.replaceState(null, '')
    }
    onComplete()
  }

  const goNext = () => {
    setIndex((value) => Math.min(SLIDES.length - 1, value + 1))
  }

  const goPrev = () => setIndex((value) => Math.max(0, value - 1))

  useEffect(() => {
    trapActiveRef.current = true
    window.history.pushState({ scannerOnboarding: true }, '')

    const onPopState = () => {
      if (!trapActiveRef.current) return
      const current = indexRef.current
      if (current > 0) {
        indexRef.current = current - 1
        setIndex(current - 1)
      }
      // Re-arm trap so the next system Back stays inside onboarding.
      window.history.pushState({ scannerOnboarding: true }, '')
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      trapActiveRef.current = false
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointerStart.current = { x: event.clientX, y: event.clientY }
    swipingRef.current = false
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    if (!start || swipingRef.current) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      swipingRef.current = true
      setSwiping(true)
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current
    const wasSwiping = swipingRef.current
    pointerStart.current = null
    swipingRef.current = false
    setSwiping(false)
    if (!start) return

    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD) return
    // Prefer horizontal intent; ignore mostly-vertical gestures.
    if (Math.abs(dx) < Math.abs(dy) * 1.15 && !wasSwiping) return

    if (dx < 0) {
      // Never auto-finish from swipe on the last page — CTA only.
      if (indexRef.current < SLIDES.length - 1) goNext()
    } else {
      goPrev()
    }
  }

  return (
    <div className="onboarding-view" role="dialog" aria-modal="true" aria-label="機能紹介">
      <header className="onboarding-topbar">
        {index > 0 ? (
          <button type="button" className="onboarding-back" onClick={goPrev} aria-label="戻る">
            ←
          </button>
        ) : (
          <span className="onboarding-top-spacer" />
        )}
        <button type="button" className="onboarding-skip" onClick={finish}>
          スキップ
        </button>
      </header>

      <div
        className="onboarding-track-wrap"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pointerStart.current = null
          setSwiping(false)
        }}
      >
        <div className="onboarding-track" style={{ transform: `translateX(-${index * 100}%)` }}>
          {SLIDES.map((slide, slideIndex) => (
            <OnboardingSlide key={slide.key} title={slide.title} active={slideIndex === index}>
              <BeforeAfterDemo
                beforeSrc={slide.before}
                afterSrc={slide.after}
                beforeAlt={slide.beforeAlt}
                afterAlt={slide.afterAlt}
                active={slideIndex === index && !swiping}
              />
            </OnboardingSlide>
          ))}
        </div>
      </div>

      <div className="onboarding-footer">
        <div className="onboarding-dots" role="tablist" aria-label="オンボーディングページ">
          {SLIDES.map((slide, slideIndex) => (
            <button
              key={slide.key}
              type="button"
              role="tab"
              aria-selected={slideIndex === index}
              aria-label={`${slideIndex + 1} / ${SLIDES.length}ページ`}
              className={slideIndex === index ? 'is-active' : ''}
              onClick={() => setIndex(slideIndex)}
            />
          ))}
        </div>

        <button
          type="button"
          className="onboarding-cta"
          onClick={() => {
            if (isLast) finish()
            else goNext()
          }}
        >
          {isLast ? 'スキャンを始める' : '続ける'}
        </button>
      </div>
    </div>
  )
}
