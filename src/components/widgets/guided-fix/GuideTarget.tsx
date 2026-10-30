'use client'

import IconBtn from '@/components/ui/IconBtn'
import { useGuidedFix, type GuidedFix } from '@/contexts/GuidedFixContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import type { GuideStepId } from '@/lib/itemHealth'
import { mergeClasses } from '@/lib/merge-classes'
import type { TranslationKey } from '@/types/translations'
import { useEffect, useId, useRef, type ReactNode } from 'react'

const STEP_TEXT: Readonly<Record<GuideStepId, TranslationKey>> = Object.freeze({
  repair: 'LabelGuideStepRepair',
  match: 'LabelGuideStepMatch',
  lookup: 'LabelGuideStepLookup',
  snap: 'LabelGuideStepSnap',
  save: 'LabelGuideStepSave',
  epub: 'LabelGuideStepEpub'
})

/**
 * The pulsing ring around the control a guide step points at, for an absolutely positioned span (the caller sets the
 * inset). The warning amber reads on light and dark themes.
 */
export const GUIDE_RING_CLASS = 'ring-warning pointer-events-none absolute rounded ring-[3px] motion-safe:animate-pulse'

/** The guide while `step` is its current step and not paused, else null */
export function useActiveGuideStep(step: GuideStepId): GuidedFix | null {
  const guide = useGuidedFix()
  return guide && !guide.paused && guide.stepId === step ? guide : null
}

/**
 * "Step N of M: ..." while `step` is current, with a button (and Escape) to stop the guide. `id` describes the control;
 * `text` replaces the step's usual text.
 */
export function GuideHint({ step, id, text, className }: { step: GuideStepId; id: string; text?: TranslationKey; className?: string }) {
  const t = useTypeSafeTranslations()
  const guide = useActiveGuideStep(step)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!guide) return
    // On the window in the capture phase: the modal's own Escape listener (document, capture) would close it first
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !(e.target instanceof Node) || !ref.current?.contains(e.target)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      guide.stop()
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [guide])

  if (!guide) return null
  return (
    <div ref={ref} className={mergeClasses('text-foreground-muted flex items-center gap-1 text-xs', className)} cy-id="guide-hint">
      <span id={id} role="status">
        {t('LabelGuideStep', { n: guide.stepIndex + 1, m: guide.total, text: t(text ?? STEP_TEXT[step]) })}
      </span>
      <IconBtn borderless size="small" variant="muted" ariaLabel={t('ButtonStopGuide')} onClick={guide.stop}>
        close
      </IconBtn>
    </div>
  )
}

/**
 * Wraps the control a Guide me step points at. While that step is current, a ring pulses around it and a hint below
 * says which step it is; the control (a form's submit button, else the first button, found again when the content
 * changes) gets the hint added to its description. Focus is never moved. The wrapper stays the same element either
 * way, so the control keeps its state when the step changes. `hintAbove` keeps the hint in view over a control that
 * grows (the snap results); `text` replaces the step's usual hint; `fit` keeps the ring to the control's width.
 */
export default function GuideTarget({
  step,
  text,
  hintAbove = false,
  fit = false,
  children
}: {
  step: GuideStepId
  text?: TranslationKey
  hintAbove?: boolean
  fit?: boolean
  children: ReactNode
}) {
  const hintId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const active = !!useActiveGuideStep(step)

  useEffect(() => {
    const root = ref.current
    if (!active || !root) return
    let target: Element | null = null
    let previous: string | null = null
    const restore = () => {
      if (previous) target?.setAttribute('aria-describedby', previous)
      else target?.removeAttribute('aria-describedby')
    }
    const describe = () => {
      const next = root.querySelector('[type="submit"]') ?? root.querySelector('button')
      if (next === target) return
      restore()
      target = next
      previous = target?.getAttribute('aria-describedby') ?? null
      target?.setAttribute('aria-describedby', previous ? `${previous} ${hintId}` : hintId)
    }
    describe()
    const observer = new MutationObserver(describe)
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      restore()
    }
  }, [active, hintId])

  return (
    <div>
      {hintAbove && <GuideHint step={step} id={hintId} text={text} className="mb-2" />}
      <div ref={ref} className={mergeClasses('relative', fit && 'w-fit')}>
        {children}
        {active && <span aria-hidden="true" className={mergeClasses(GUIDE_RING_CLASS, '-inset-1')} />}
      </div>
      {!hintAbove && <GuideHint step={step} id={hintId} text={text} className="mt-2" />}
    </div>
  )
}
