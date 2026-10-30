'use client'

import Btn from '@/components/ui/Btn'
import IconBtn from '@/components/ui/IconBtn'
import GuideTarget from '@/components/widgets/guided-fix/GuideTarget'
import RepairConsentDialog from '@/components/widgets/guided-fix/RepairConsentDialog'
import { useGuidedFix } from '@/contexts/GuidedFixContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { callStatusAction, type StatusActionResult } from '@/lib/actionResult'
import { getPipelineMatchPercent, hasPipelineChapterReview, isPipelineActive, PIPELINE_STATUS_LABEL, toPipelineItemState } from '@/lib/autoPipeline'
import { formatDrift, isGuidedFixDismissed, rememberGuidedFixDismissed, type GuideStepId } from '@/lib/itemHealth'
import type { ItemHealth, ItemHealthIssue, PipelineItemState, PipelineItemStatus } from '@/types/api'
import type { TranslationKey, TypeSafeTranslations } from '@/types/translations'
import { useState, type ReactNode } from 'react'

/** Injected so the item page passes the server actions and tests pass stubs. */
export interface GuidedFixActions {
  getHealth: (libraryItemId: string, measure: boolean) => Promise<StatusActionResult<ItemHealth | null>>
  run: (libraryItemId: string, options: { fix?: boolean; repairSeekIndex?: boolean }) => Promise<StatusActionResult<PipelineItemState>>
  /** Turn on the library's Repair MP3 seek index automatically */
  enableAutoRepair: () => Promise<StatusActionResult<unknown>>
}

export interface GuidedFixCardProps {
  libraryItemId: string
  health: ItemHealth
  /** The pipeline's state for the book, kept current by the socket */
  pipelineState: PipelineItemState | null
  /** The seek index task's progress ("42%") while the files are rewritten */
  repairProgress: string | null
  /** Opens the chapter editor on the pipeline's proposal */
  reviewHref: string
  actions: GuidedFixActions
  /** Start Guide me, at `from` when given */
  onStartGuide: (from?: GuideStepId) => void
  /** Guide me step 1: repair the files (keeping chapter times); true when every file was repaired */
  onRepairFiles: () => Promise<boolean>
}

const FIX_STEP_LABEL: Partial<Record<PipelineItemStatus, TranslationKey>> = {
  repairing: 'LabelFixStepRepairing',
  matching: 'LabelFixStepMatching',
  chapters: 'LabelFixStepChapters'
}

function getIssueReason(issue: ItemHealthIssue, health: ItemHealth, t: TypeSafeTranslations): string {
  switch (issue) {
    case 'seek-index':
      return t('MessageGuidedFixReasonSeekIndex', { drift: formatDrift(health.duration.drift, t) })
    case 'unmatched':
      return t('MessageGuidedFixReasonUnmatched')
    case 'low-confidence':
      return t('MessageGuidedFixReasonLowConfidence', { confidence: health.match.confidence ?? 0 })
    case 'chapters-from-files':
      return t('MessageGuidedFixReasonFromFiles')
    case 'chapters-length':
      return t('MessageGuidedFixReasonLength', { diff: formatDrift((health.chapters.end ?? 0) - health.duration.stored - health.duration.drift, t) })
    case 'chapters-count':
      return t('MessageGuidedFixReasonCount', { count: health.chapters.count, audible: health.chapters.audible?.count ?? 0 })
    default:
      return ''
  }
}

/**
 * Item page card (fork only) for a book whose chapters are probably wrong: why, and two ways out. Guide me points at
 * each control in turn; Fix automatically runs the pipeline on the book (repair, match, chapters with the speech check)
 * and only stops to ask before MP3s are rewritten. A book whose only issue is unverified chapters gets no card.
 */
export default function GuidedFixCard({
  libraryItemId,
  health,
  pipelineState,
  repairProgress,
  reviewHref,
  actions,
  onStartGuide,
  onRepairFiles
}: GuidedFixCardProps) {
  const t = useTypeSafeTranslations()
  const guide = useGuidedFix()
  const [checking, setChecking] = useState(false)
  const [starting, setStarting] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [consent, setConsent] = useState<{ kind: 'fix' | 'guide'; files: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The Fix automatically run started here, as the server first reported it */
  const [runState, setRunState] = useState<PipelineItemState | null>(null)
  /** The issue set dismissed here (also kept in storage, which may be unavailable) */
  const [dismissedIssues, setDismissedIssues] = useState<string | null>(null)

  const startRun = async (repairSeekIndex: boolean) => {
    setStarting(true)
    const result = await callStatusAction(() => actions.run(libraryItemId, { fix: true, repairSeekIndex }))
    setStarting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRunState(toPipelineItemState(result.data))
  }

  const handleFix = async () => {
    setError(null)
    setRunState(null)
    setChecking(true)
    const result = await callStatusAction(() => actions.getHealth(libraryItemId, true))
    setChecking(false)
    const latest = (result.ok && result.data) || health
    const needsRepair = latest.issues.includes('seek-index')
    if (needsRepair && !latest.autoFix.autoRepair) setConsent({ kind: 'fix', files: latest.seekIndex.needsRepairCount })
    else void startRun(needsRepair)
  }

  const handleConsent = async (always: boolean) => {
    const current = consent
    setConsent(null)
    if (!current) return
    if (always) {
      const saved = await callStatusAction(actions.enableAutoRepair)
      if (!saved.ok) {
        setError(saved.error)
        return
      }
    }
    if (current.kind === 'fix') {
      void startRun(true)
      return
    }
    setRepairing(true)
    const repaired = await onRepairFiles()
    setRepairing(false)
    if (repaired) guide?.advance()
  }

  const handleDismiss = () => {
    rememberGuidedFixDismissed(libraryItemId, health.issues)
    setDismissedIssues(health.issues.join(','))
    setRunState(null)
    setError(null)
  }

  // A socket update newer than the run's start is the run's progress (an older one is from before it)
  const fixState = runState && pipelineState && (pipelineState.updatedAt ?? 0) >= (runState.updatedAt ?? 0) ? pipelineState : runState
  const fixRunning = !!fixState && isPipelineActive(fixState.status)
  const relevant = health.issues.filter((issue) => issue !== 'chapters-unverified')
  const dismissed = dismissedIssues === health.issues.join(',') || isGuidedFixDismissed(libraryItemId, health.issues)

  // The pipeline is already on the book: its chip says so
  if (pipelineState && isPipelineActive(pipelineState.status) && !runState) return null
  const showResult = !!fixState && (fixRunning || fixState.status !== 'done' || relevant.length > 0)
  const busy = checking || starting || repairing || !!consent
  if (!showResult && !guide && !busy && !error && (!relevant.length || dismissed)) return null

  let body: ReactNode
  if (fixState && fixRunning) {
    body = (
      <p role="status" cy-id="guided-fix-progress">
        {t('MessageFixRunning', { step: t(FIX_STEP_LABEL[fixState.status] ?? PIPELINE_STATUS_LABEL[fixState.status]) })}
        {fixState.status === 'repairing' && repairProgress && <span className="text-foreground-muted ms-2">{repairProgress}</span>}
      </p>
    )
  } else if (fixState && showResult) {
    let text: string
    let action: ReactNode = null
    if (fixState.status === 'done') {
      const parts = [
        fixState.repair?.result === 'repaired' ? t('MessageFixDoneRepaired') : null,
        fixState.match?.result === 'matched' && fixState.match.asin
          ? t('MessageFixDoneMatched', { asin: fixState.match.asin, confidence: getPipelineMatchPercent(fixState) ?? 0 })
          : null,
        fixState.chapters?.applied && fixState.chapters.count ? t('MessageFixDoneChapters', { count: fixState.chapters.count }) : null
      ]
      text = t('MessageFixDone', { summary: parts.filter(Boolean).join(' ') })
    } else if (fixState.status === 'needs-review' && fixState.chapters?.reason === 'needs-seek-index-repair') {
      text = t('MessageFixNeedsRepair')
      action = (
        <Btn
          size="small"
          color="bg-primary"
          onClick={() => setConsent({ kind: 'fix', files: fixState.chapters?.seekIndex?.files ?? health.seekIndex.needsRepairCount })}
        >
          {t('ButtonRepairAndFix')}
        </Btn>
      )
    } else if (fixState.status === 'needs-review' && fixState.match?.result === 'needs-review') {
      text =
        fixState.match.reason === 'no-match' ? t('MessageFixNoMatch') : t('MessageFixLowConfidence', { confidence: getPipelineMatchPercent(fixState) ?? 0 })
      action = (
        <Btn
          size="small"
          onClick={() => {
            setRunState(null)
            onStartGuide('match')
          }}
        >
          {t('ButtonPickTheMatch')}
        </Btn>
      )
    } else if (fixState.status === 'needs-review') {
      const partial = fixState.chapters?.partial
      text = partial
        ? t('MessageFixPartial', { applied: partial.applied, flagged: partial.flagged })
        : t('MessageFixChaptersNeedLook', { reason: (fixState.reason ?? '').replace(/^chapters: /, '') })
      if (hasPipelineChapterReview(fixState)) {
        action = (
          <Btn size="small" to={reviewHref}>
            {t('ButtonReviewChapters')}
          </Btn>
        )
      }
    } else {
      text = t('MessageFixFailed', { reason: fixState.reason ?? '' })
      action = (
        <Btn size="small" onClick={() => void handleFix()}>
          {t('ButtonRetry')}
        </Btn>
      )
    }
    body = (
      <>
        <p cy-id="guided-fix-result">{text}</p>
        {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </>
    )
  } else if (guide?.paused) {
    body = (
      <div className="flex flex-wrap items-center gap-2" cy-id="guided-fix-paused">
        <p className="me-auto">{t('LabelGuideStepPaused', { n: guide.stepIndex + 1, m: guide.total })}</p>
        <Btn size="small" color="bg-primary" onClick={guide.resume}>
          {t('ButtonGuideContinue')}
        </Btn>
        <Btn size="small" onClick={guide.stop}>
          {t('ButtonStopGuide')}
        </Btn>
      </div>
    )
  } else {
    const reason = relevant.length ? getIssueReason(relevant[0], health, t) : ''
    body = (
      <>
        <p className="font-semibold">{t('MessageGuidedFixCard')}</p>
        {reason && (
          <p className="text-foreground-muted" cy-id="guided-fix-reason">
            {reason}
          </p>
        )}
        {error && (
          <p className="text-error" cy-id="guided-fix-error">
            {t('MessageFixFailed', { reason: error })}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {guide?.stepId === 'repair' ? (
            <GuideTarget step="repair">
              <Btn size="small" loading={repairing} onClick={() => setConsent({ kind: 'guide', files: health.seekIndex.needsRepairCount })}>
                {t('ButtonRepairFiles')}
              </Btn>
            </GuideTarget>
          ) : (
            !guide && (
              <>
                {health.autoFix.available && (
                  <Btn size="small" color="bg-primary" loading={checking || starting} onClick={() => void handleFix()}>
                    {t('ButtonFixAutomatically')}
                  </Btn>
                )}
                <Btn size="small" disabled={checking || starting} onClick={() => onStartGuide()}>
                  {t('ButtonGuideMe')}
                </Btn>
              </>
            )
          )}
          {repairing && repairProgress && <span className="text-foreground-muted text-xs">{repairProgress}</span>}
        </div>
      </>
    )
  }

  return (
    <div className="border-border mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm" cy-id="guided-fix-card">
      <div className="min-w-0 flex-1">{body}</div>
      {!fixRunning && !guide && (
        <IconBtn borderless size="small" variant="muted" ariaLabel={t('ButtonAutoPipelineDismiss')} onClick={handleDismiss}>
          close
        </IconBtn>
      )}
      <RepairConsentDialog
        isOpen={!!consent}
        fileCount={consent?.files ?? 0}
        yesButtonText={consent?.kind === 'guide' ? t('ButtonRepairSeekIndex') : t('ButtonRepairAndFix')}
        onClose={() => setConsent(null)}
        onConfirm={(always) => void handleConsent(always)}
      />
    </div>
  )
}
