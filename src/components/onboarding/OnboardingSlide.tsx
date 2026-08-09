import type { ReactNode } from 'react'

type Props = {
  title: string
  active: boolean
  children: ReactNode
}

export function OnboardingSlide({ title, active, children }: Props) {
  return (
    <section className={`onboarding-slide ${active ? 'is-active' : ''}`} aria-hidden={!active}>
      <h2 className="onboarding-title">{title}</h2>
      <div className="onboarding-slide-body">{children}</div>
    </section>
  )
}
