import { useEffect, useState } from 'react'

type Props = {
  beforeSrc: string
  afterSrc: string
  beforeAlt: string
  afterAlt: string
  active: boolean
  labelBefore?: string
  labelAfter?: string
}

const BEFORE_MS = 1200
const AFTER_MS = 1500
const FADE_MS = 400

export function BeforeAfterDemo({
  beforeSrc,
  afterSrc,
  beforeAlt,
  afterAlt,
  active,
  labelBefore = '補正前',
  labelAfter = '補正後'
}: Props) {
  const [showAfter, setShowAfter] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(media.matches)
    sync()
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [])

  useEffect(() => {
    if (!active || reduceMotion) {
      setShowAfter(true)
      return
    }

    let cancelled = false
    let timer = 0
    setShowAfter(false)

    const loop = (showingAfter: boolean) => {
      const wait = showingAfter ? AFTER_MS : BEFORE_MS
      timer = window.setTimeout(() => {
        if (cancelled) return
        setShowAfter(!showingAfter)
        loop(!showingAfter)
      }, wait)
    }

    loop(false)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [active, reduceMotion])

  return (
    <div className="onboarding-demo" aria-live="polite">
      <div className="onboarding-demo-frame">
        <img
          src={beforeSrc}
          alt={beforeAlt}
          className={`onboarding-demo-image ${showAfter ? 'is-hidden' : 'is-visible'}`}
          style={{ transitionDuration: `${FADE_MS}ms` }}
          draggable={false}
        />
        <img
          src={afterSrc}
          alt={afterAlt}
          className={`onboarding-demo-image onboarding-demo-after ${showAfter ? 'is-visible' : 'is-hidden'}`}
          style={{ transitionDuration: `${FADE_MS}ms` }}
          draggable={false}
        />
        <span className={`onboarding-demo-badge ${showAfter ? 'after' : 'before'}`}>
          {showAfter ? labelAfter : labelBefore}
        </span>
      </div>
    </div>
  )
}
