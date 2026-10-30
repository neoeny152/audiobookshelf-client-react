'use client'

import IconBtn from '@/components/ui/IconBtn'
import { useGuidedFix } from '@/contexts/GuidedFixContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import type { GuideStepId } from '@/lib/itemHealth'
import type { TranslationKey } from '@/types/translations'
import { useEffect, useId, useRef, type ReactNode } from 'react'

const STEP_TEXT: Readonly<Record<GuideStepId, TranslationKey>> = Object.freeze({
  repair: 'LabelGuideStepRepair',
  match: 'LabelGuideStepMatch',
  lookup: 'LabelGuideStepLookup',
  snap: 'LabelGuideStepSnap',
  save: 'LabelGuideStepSave'
})

/**
 * Wraps the control a Guide me step points at. While that step is current, a ring pulses around it and a hint below
 * says which step it is; the control gets the hint as its description. Focus is never moved. The wrapper stays the
 * same element either way, so the control keeps its state when the step changes.
 */
export default function GuideTarget({ step, children }: { step: GuideStepId; children: ReactNode }) {
  const t = useTypeSafeTranslations()
  const guide = useGuidedFix()
  const hintId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const active = !!guide && !guide.paused && guide.stepId === step

  useEffect(() => {
    if (!active || !ref.current) return
    // A form's submit button (Search), else the first control (a button, or a match card)
    const target = ref.current.querySelector('[type="submit"]') ?? ref.current.querySelector('button, [role="option"]')
    target?.setAttribute('aria-describedby', hintId)
    return () => target?.removeAttribute('aria-describedby')
  }, [active, hintId])

  return (
    <div ref={ref}>
      <div className="relative">
        {children}
        {active && <span aria-hidden="true" className="ring-primary pointer-events-none absolute -inset-1 rounded ring-2 motion-safe:animate-pulse" />}
      </div>
      {active && (
        <div
          className="text-foreground-muted mt-2 flex items-center gap-1 text-xs"
          cy-id="guide-hint"
          onKeyDown={(e) => {
            if (e.key === 'Escape') guide.stop()
          }}
        >
          <span id={hintId} role="status">
            {t('LabelGuideStep', { n: guide.stepIndex + 1, m: guide.total, text: t(STEP_TEXT[step]) })}
          </span>
          <IconBtn borderless size="small" variant="muted" ariaLabel={t('ButtonStopGuide')} onClick={guide.stop}>
            close
          </IconBtn>
        </div>
      )}
    </div>
  )
}
