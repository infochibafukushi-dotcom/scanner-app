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

const SWIPE_THRESHOLD = 48

export function OnboardingView({ onComplete }: Props) {
  const [index, setIndex] = useState(0)
  const pointerStartX = useRef<number | null>(null)
  const dragging = useRef(false)
  const isLast = index >= SLIDES.length - 1

  const finish = () => {
    markOnboardingComplete()
    onComplete()
  }

  const goNext = () => {
    if (isLast) finish()
    else setIndex((value) => Math.min(SLIDES.length - 1, value + 1))
  }

  const goPrev = () => setIndex((value) => Math.max(0, value - 1))

  useEffect(() => {
    const state = { scannerOnboarding: true, index }
    window.history.pushState(state, '')
    const onPopState = () => {
      setIndex((current) => {
        if (current > 0) {
          window.history.pushState({ scannerOnboarding: true, index: current - 1 }, '')
          return current - 1
        }
        window.history.pushState({ scannerOnboarding: true, index: 0 }, '')
        return 0
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerStartX.current = event.clientX
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || pointerStartX.current == null) return
    const delta = event.clientX - pointerStartX.current
    pointerStartX.current = null
    dragging.current = false
    if (Math.abs(delta) < SWIPE_THRESHOLD) return
    if (delta < 0) goNext()
    else goPrev()
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
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          pointerStartX.current = null
          dragging.current = false
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
                active={slideIndex === index}
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

        <button type="button" className="onboarding-cta" onClick={goNext}>
          {isLast ? 'スキャンを始める' : '続ける'}
        </button>
      </div>
    </div>
  )
}
