'use client'

import Btn from '@/components/ui/Btn'
import Checkbox from '@/components/ui/Checkbox'
import HelpTooltipIcon from '@/components/ui/HelpTooltipIcon'
import IconBtn from '@/components/ui/IconBtn'
import GuideTarget from '@/components/widgets/guided-fix/GuideTarget'
import RepairConsentDialog from '@/components/widgets/guided-fix/RepairConsentDialog'
import { useGuidedFix } from '@/contexts/GuidedFixContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { callStatusAction, type StatusActionResult } from '@/lib/actionResult'
import { getPipelineMatchPercent, hasPipelineChapterReview, isPipelineActive, PIPELINE_STATUS_LABEL, toPipelineItemState } from '@/lib/autoPipeline'
import { getIssueReason, setGuidancePreference, type EpubOffer, type GuidancePreference, type GuideStepId } from '@/lib/itemHealth'
import type { ItemHealth, PipelineItemState, PipelineItemStatus } from '@/types/api'
import type { TranslationKey } from '@/types/translations'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'

/** Injected so the item page passes the server actions and tests pass stubs. */
export interface GuidedFixActions {
  getHealth: (libraryItemId: string, measure: boolean) => Promise<StatusActionResult<ItemHealth | null>>
  run: (libraryItemId: string, options: { fix?: boolean; repairSeekIndex?: boolean }) => Promise<StatusActionResult<PipelineItemState>>
  /** Turn on the library's Repair MP3 seek index automatically */
  enableAutoRepair: () => Promise<StatusActionResult<unknown>>
  /** "Do all of this automatically" at the end of a guide: turn on the library's automatic processing */
  enableAutomation: (options: { autoRepairSeekIndex: boolean; autoEpub: boolean }) => Promise<StatusActionResult<unknown>>
  /** The guide's optional last step: a read-along EPUB made from the audio */
  startEpub: (libraryItemId: string) => Promise<StatusActionResult<unknown>>
  /** "Also fix the other books": queue the library's books that need work in the auto pipeline */
  runBacklog: () => Promise<StatusActionResult<{ queued: number }>>
}

export interface GuidedFixHintProps {
  libraryItemId: string
  health: ItemHealth
  /** The pipeline's state for the book, kept current by the socket */
  pipelineState: PipelineItemState | null
  /** The seek index task's progress ("42%") while the files are rewritten */
  repairProgress: string | null
  /** Opens the chapter editor on the pipeline's proposal */
  reviewHref: string
  actions: GuidedFixActions
  /** The hint was dismissed for the book's current issues */
  dismissed: boolean
  onDismiss: () => void
  /** Start Guide me at `from` (Pick the match after Fix it for me found no sure match) */
  onStartGuide: (from: GuideStepId) => void
  /** What the guide that just ended did ("files repaired, 50 chapters saved"), when no guidance preference is set: the
   * hint says so and asks what to do next time */
  doneSummary: string | null
  onNextTimeAnswered: () => void
  /** "Do all of this automatically" is offered (the auto pipeline runs on the server) */
  canAutomate: boolean
  /** What the guide's EPUB step offers */
  epubOffer: EpubOffer | null
  /** Its read-along EPUB box is offered (the server can make them) */
  canAutomateEpub: boolean
  /** The library's quiet hours ("01:00–06:00"), when the pipeline makes EPUBs */
  epubWindow: string
  /** Other books of the library that need work, offered to queue with "Do all of this automatically" */
  backlogCount: number
  /** The Processing page, where queued books can be followed */
  processingHref: string
}

const FIX_STEP_LABEL: Partial<Record<PipelineItemStatus, TranslationKey>> = {
  repairing: 'LabelFixStepRepairing',
  matching: 'LabelFixStepMatching',
  chapters: 'LabelFixStepChapters'
}

const LINK_CLASS = 'link-underline text-foreground cursor-pointer disabled:cursor-default disabled:opacity-50'

/**
 * One line of small text on the item page (fork only) for a book whose chapters are probably wrong: it says to start
 * with Edit (the pencil pulses and starts Guide me), lists the problems in a tooltip and offers Fix it for me, which
 * runs the pipeline on the book (repair, match, chapters with the speech check) and only stops to ask before MP3s are
 * rewritten. The line also hosts the guide's optional EPUB step (the others happen in the edit modal) and, when the
 * guide ends, asks once how to handle such books next time. A book whose only issue is unverified
 * chapters gets no hint.
 */
export default function GuidedFixHint({
  libraryItemId,
  health,
  pipelineState,
  repairProgress,
  reviewHref,
  actions,
  dismissed,
  onDismiss,
  onStartGuide,
  doneSummary,
  onNextTimeAnswered,
  canAutomate,
  epubOffer,
  canAutomateEpub,
  epubWindow,
  backlogCount,
  processingHref
}: GuidedFixHintProps) {
  const t = useTypeSafeTranslations()
  const guide = useGuidedFix()
  const [checking, setChecking] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startingEpub, setStartingEpub] = useState(false)
  const [savingAutomation, setSavingAutomation] = useState(false)
  const [automateRepair, setAutomateRepair] = useState(false)
  const [automateEpub, setAutomateEpub] = useState(false)
  const [fixBacklog, setFixBacklog] = useState(true)
  /** Books queued with "Also fix the other books", shown until dismissed */
  const [backlogQueued, setBacklogQueued] = useState<number | null>(null)
  /** MP3 files Fix it for me would rewrite, while it asks */
  const [consentFiles, setConsentFiles] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The Fix it for me run started here, as the server first reported it */
  const [runState, setRunState] = useState<PipelineItemState | null>(null)

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
    if (needsRepair && !latest.autoFix.autoRepair) setConsentFiles(latest.seekIndex.needsRepairCount)
    else void startRun(needsRepair)
  }

  const handleConsent = async (always: boolean) => {
    setConsentFiles(null)
    if (always) {
      const saved = await callStatusAction(actions.enableAutoRepair)
      if (!saved.ok) {
        setError(saved.error)
        return
      }
    }
    void startRun(true)
  }

  const handleStartEpub = async () => {
    setError(null)
    setStartingEpub(true)
    const result = await callStatusAction(() => actions.startEpub(libraryItemId))
    setStartingEpub(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    guide?.advance()
  }

  const handleNextTime = async (preference: GuidancePreference) => {
    setError(null)
    if (preference === 'auto') {
      setSavingAutomation(true)
      const saved = await callStatusAction(() => actions.enableAutomation({ autoRepairSeekIndex: automateRepair, autoEpub: automateEpub }))
      setSavingAutomation(false)
      if (!saved.ok) {
        setError(saved.error)
        return
      }
      if (fixBacklog && backlogCount > 0) {
        setSavingAutomation(true)
        const run = await callStatusAction(actions.runBacklog)
        setSavingAutomation(false)
        if (!run.ok) {
          setError(run.error)
          return
        }
        // Says how many were queued until dismissed
        setGuidancePreference(preference)
        setBacklogQueued(run.data.queued)
        return
      }
    }
    setGuidancePreference(preference)
    onNextTimeAnswered()
  }

  const handleDismiss = () => {
    setRunState(null)
    setError(null)
    if (backlogQueued === null) {
      onDismiss()
      return
    }
    setBacklogQueued(null)
    onNextTimeAnswered()
  }

  // A socket update newer than the run's start is the run's progress (an older one is from before it)
  const fixState = runState && pipelineState && (pipelineState.updatedAt ?? 0) >= (runState.updatedAt ?? 0) ? pipelineState : runState
  const fixRunning = !!fixState && isPipelineActive(fixState.status)
  const relevant = health.issues.filter((issue) => issue !== 'chapters-unverified')

  // The pipeline is already on the book: its chip says so
  if (pipelineState && isPipelineActive(pipelineState.status) && !runState) return null
  const showResult = !!fixState && (fixRunning || fixState.status !== 'done' || relevant.length > 0)
  const busy = checking || starting || consentFiles !== null
  if (doneSummary === null && !showResult && !guide && !busy && !error && (!relevant.length || dismissed)) return null

  let body: ReactNode
  if (fixState && fixRunning) {
    body = (
      <span role="status" cy-id="guided-fix-progress">
        {t('MessageFixRunning', { step: t(FIX_STEP_LABEL[fixState.status] ?? PIPELINE_STATUS_LABEL[fixState.status]) })}
        {fixState.status === 'repairing' && repairProgress && <span className="ms-2">{repairProgress}</span>}
      </span>
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
        <button type="button" className={LINK_CLASS} onClick={() => setConsentFiles(fixState.chapters?.seekIndex?.files ?? health.seekIndex.needsRepairCount)}>
          {t('ButtonRepairAndFix')}
        </button>
      )
    } else if (fixState.status === 'needs-review' && fixState.match?.result === 'needs-review') {
      text =
        fixState.match.reason === 'no-match' ? t('MessageFixNoMatch') : t('MessageFixLowConfidence', { confidence: getPipelineMatchPercent(fixState) ?? 0 })
      action = (
        <button
          type="button"
          className={LINK_CLASS}
          onClick={() => {
            setRunState(null)
            onStartGuide('match')
          }}
        >
          {t('ButtonPickTheMatch')}
        </button>
      )
    } else if (fixState.status === 'needs-review') {
      const partial = fixState.chapters?.partial
      text = partial
        ? t('MessageFixPartial', { applied: partial.applied, flagged: partial.flagged })
        : t('MessageFixChaptersNeedLook', { reason: (fixState.reason ?? '').replace(/^chapters: /, '') })
      if (hasPipelineChapterReview(fixState)) {
        action = (
          <Link href={reviewHref} className="link-underline text-foreground">
            {t('ButtonReviewChapters')}
          </Link>
        )
      }
    } else {
      text = t('MessageFixFailed', { reason: fixState.reason ?? '' })
      action = (
        <button type="button" className={LINK_CLASS} onClick={() => void handleFix()}>
          {t('ButtonRetry')}
        </button>
      )
    }
    body = (
      <>
        <span cy-id="guided-fix-result">{text}</span>
        {action}
      </>
    )
  } else if (backlogQueued !== null) {
    body = (
      <span cy-id="guided-fix-backlog">
        {t.rich('MessageGuideBacklogQueued', {
          count: backlogQueued,
          link: (chunks) => (
            <Link href={processingHref} className="link-underline text-foreground">
              {chunks}
            </Link>
          )
        })}
        {automateEpub && ` ${t('MessageGuideBacklogEpubNote')}`}
      </span>
    )
  } else if (doneSummary !== null) {
    body = (
      <div className="flex flex-col gap-2" cy-id="guided-fix-next-time">
        <p>{t('MessageGuideNextTime', { summary: doneSummary })}</p>
        <div className="flex flex-wrap items-center gap-2">
          {canAutomate && (
            <Btn size="small" disabled={savingAutomation} onClick={() => void handleNextTime('auto')}>
              {t('ButtonGuideAutomate')}
            </Btn>
          )}
          <Btn size="small" color="bg-primary" disabled={savingAutomation} onClick={() => void handleNextTime('guide')}>
            {t('ButtonGuideKeepGuiding')}
          </Btn>
          <Btn size="small" disabled={savingAutomation} onClick={() => void handleNextTime('off')}>
            {t('ButtonGuideNoGuidance')}
          </Btn>
        </div>
        {canAutomate && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Checkbox size="small" value={automateRepair} label={t('LabelAutoPipelineAutoRepair')} labelClass="text-xs" onChange={setAutomateRepair} />
            {/* A box for highlighting existing EPUBs joins this one once the server can align them */}
            {canAutomateEpub && (
              <Checkbox
                size="small"
                value={automateEpub}
                label={t('LabelAutomateReadAlongEpub', { window: epubWindow })}
                labelClass="text-xs"
                onChange={setAutomateEpub}
              />
            )}
            {backlogCount > 0 && (
              <Checkbox
                size="small"
                value={fixBacklog}
                label={t('LabelGuideFixBacklog', { count: backlogCount })}
                labelClass="text-xs"
                onChange={setFixBacklog}
              />
            )}
          </div>
        )}
      </div>
    )
  } else if (guide?.paused) {
    body = (
      <>
        <span cy-id="guided-fix-paused">{t('LabelGuideStepPaused', { n: guide.stepIndex + 1, m: guide.total })}</span>
        <button type="button" className={LINK_CLASS} onClick={guide.resume}>
          {t('ButtonGuideContinue')}
        </button>
        <button type="button" className={LINK_CLASS} onClick={guide.stop}>
          {t('ButtonStopGuide')}
        </button>
      </>
    )
  } else if (guide?.stepId === 'epub') {
    body = (
      <>
        <GuideTarget step="epub">
          <div className="flex flex-wrap items-center gap-3">
            {epubOffer === 'create' && (
              <Btn size="small" color="bg-primary" loading={startingEpub} onClick={() => void handleStartEpub()}>
                {t('ButtonCreateReadAlongEpub')}
              </Btn>
            )}
            <button type="button" className={LINK_CLASS} disabled={startingEpub} onClick={guide.advance}>
              {t('ButtonSkip')}
            </button>
          </div>
        </GuideTarget>
      </>
    )
  } else if (guide) {
    // The other steps happen in the edit modal, which shows their hints
    return null
  } else {
    body = (
      <>
        <span className="inline-flex items-center gap-1" cy-id="guided-fix-start">
          {t('MessageGuidedFixHint')}
          <HelpTooltipIcon
            size="sm"
            ariaLabel={t('LabelNeedsWork')}
            text={
              <ul cy-id="guided-fix-reasons">
                {relevant.map((issue) => (
                  <li key={issue}>{getIssueReason(issue, health, t)}</li>
                ))}
              </ul>
            }
          />
        </span>
        {health.autoFix.available && (
          <button type="button" className={LINK_CLASS} disabled={checking || starting} onClick={() => void handleFix()}>
            {t('ButtonFixItForMe')}
          </button>
        )}
      </>
    )
  }

  return (
    <div className="text-foreground-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" cy-id="guided-fix-hint">
      {body}
      {error && (
        <span className="text-error" cy-id="guided-fix-error">
          {t('MessageFixFailed', { reason: error })}
        </span>
      )}
      {!fixRunning && !guide && (doneSummary === null || backlogQueued !== null) && (
        <IconBtn borderless size="small" variant="muted" ariaLabel={t('ButtonAutoPipelineDismiss')} onClick={handleDismiss}>
          close
        </IconBtn>
      )}
      <RepairConsentDialog
        isOpen={consentFiles !== null}
        fileCount={consentFiles ?? 0}
        yesButtonText={t('ButtonRepairAndFix')}
        onClose={() => setConsentFiles(null)}
        onConfirm={(always) => void handleConsent(always)}
      />
    </div>
  )
}
