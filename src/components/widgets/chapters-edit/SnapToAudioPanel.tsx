'use client'

import Btn from '@/components/ui/Btn'
import Checkbox from '@/components/ui/Checkbox'
import HelpTooltipIcon from '@/components/ui/HelpTooltipIcon'
import IconBtn from '@/components/ui/IconBtn'
import TextInput from '@/components/ui/TextInput'
import Tooltip from '@/components/ui/Tooltip'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import type { SnapTitlePick } from '@/lib/chapters/chapterEditorUtils'
import {
  buildSnapRows,
  clampSnapOption,
  formatSnapClock,
  formatSnapDelta,
  getDefaultSnapChecked,
  getSnapAttention,
  getSnapHeardTitle,
  getSnapRetryIndexes,
  getSnapSpeechBlock,
  getSnapSpeechPendingIndexes,
  getSnapSpeechProgress,
  getSnapSpeechStatus,
  getSnapSpeechWarnings,
  getSnapSummary,
  mergeSnapSpeechBatch,
  SNAP_DEFAULT_OPTIONS,
  SNAP_SPEECH_BATCH_SIZE,
  snapSessionCheckedSpeech,
  type SnapAdvancedOptions,
  type SnapRequestOptions,
  type SnapRow,
  type SnapSession,
  type SnapSpeechBatchResult,
  type SnapSpeechStatus,
  withSnapTitles
} from '@/lib/chapters/chapterSnap'
import { mergeClasses } from '@/lib/merge-classes'
import type { TypeSafeTranslations } from '@/types/translations'
import type { SnapChapterConfidence, SnapChapterReason, SnapChapterSpeech } from '@/types/api'
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

/** The editor's chapter preview player (`useChapterPreviewAudio`). */
export interface SnapPreviewControls {
  selectedChapterId: number | string | null
  isPlayingChapter: boolean
  isLoadingChapter: boolean
  playChapter: (chapterId: number | string, chapterStart: number) => void
  destroyAudioEl: () => void
}

const SNAP_PREVIEW_PREFIX = 'snap-'

/** How often one chapter is sent to the speech check in one run (a batch the server ran out of time for is retried once). */
const MAX_SPEECH_ATTEMPTS = 2
/** Batches in a row that check nothing (chapterbot busy or failing) before the run stops. */
const MAX_EMPTY_BATCHES = 2
/** Retries of a batch the server turned away with 409/429 (another snap still running). */
const MAX_BUSY_RETRIES = 3
export const SNAP_BUSY_RETRY_DELAY_MS = 3000

export interface SnapToAudioPanelProps {
  chapterCount: number
  disabled?: boolean
  /** Snap the current editor chapters. Resolves null on failure (the caller shows the toast). */
  onSnap: (options: SnapRequestOptions) => Promise<SnapSession | null>
  /** Snap the chapters the server did not get to, following the server's retry contract. */
  onRetry: (session: SnapSession) => Promise<SnapSession | null>
  /**
   * Run the speech check for these chapters of the session (at most SNAP_SPEECH_BATCH_SIZE). The panel calls it one
   * batch at a time until every chapter is checked. Without it, only what the snap request itself checked is shown.
   */
  onCheckSpeech?: (session: SnapSession, indexes: number[]) => Promise<SnapSpeechBatchResult>
  /** Write the given rows' new starts into the editor as unsaved changes. Returns how many were applied. */
  onApply: (rows: SnapRow[]) => number
  /**
   * Write titles the speech check heard into the editor as unsaved changes (titles only). Returns the clientKeys that
   * were applied. Without it the panel does not offer heard titles.
   */
  onApplyTitles?: (picks: SnapTitlePick[]) => string[]
  preview?: SnapPreviewControls
  /** The server advertises the speech check (`chapterbotVerify`); shows the Check speech toggle. */
  speechCheckAvailable?: boolean
  /** Chapters were just loaded from an Audible lookup: suggest snapping them. */
  showLookupHint?: boolean
  /** The suggestion was dismissed or acted on. */
  onLookupHintDismiss?: () => void
  /** Wait before resending a batch the server turned away as busy (tests shorten it). */
  busyRetryDelayMs?: number
}

type OptionKey = keyof SnapAdvancedOptions

const OPTION_FIELDS: {
  key: OptionKey
  labelKey: 'LabelSnapWindowSec' | 'LabelSnapMinSilenceSec' | 'LabelSnapNoiseDb' | 'LabelSnapHeadingLookbackSec'
  step: number
}[] = [
  { key: 'windowSec', labelKey: 'LabelSnapWindowSec', step: 1 },
  { key: 'minSilenceSec', labelKey: 'LabelSnapMinSilenceSec', step: 0.1 },
  { key: 'noiseDb', labelKey: 'LabelSnapNoiseDb', step: 1 },
  { key: 'headingLookbackSec', labelKey: 'LabelSnapHeadingLookbackSec', step: 0.5 }
]

function defaultOptionDrafts(): Record<OptionKey, string> {
  return {
    windowSec: String(SNAP_DEFAULT_OPTIONS.windowSec),
    minSilenceSec: String(SNAP_DEFAULT_OPTIONS.minSilenceSec),
    noiseDb: String(SNAP_DEFAULT_OPTIONS.noiseDb),
    headingLookbackSec: String(SNAP_DEFAULT_OPTIONS.headingLookbackSec)
  }
}

function parseOptionDrafts(drafts: Record<OptionKey, string>): SnapAdvancedOptions {
  const parse = (key: OptionKey) => {
    const trimmed = drafts[key].trim()
    return clampSnapOption(key, trimmed === '' ? NaN : Number(trimmed))
  }
  return {
    windowSec: parse('windowSec'),
    minSilenceSec: parse('minSilenceSec'),
    noiseDb: parse('noiseDb'),
    headingLookbackSec: parse('headingLookbackSec')
  }
}

export function snapReasonLabel(reason: SnapChapterReason, t: TypeSafeTranslations): string {
  switch (reason) {
    case 'first-chapter':
      return t('LabelSnapReasonFirstChapter')
    case 'inside-pause':
      return t('LabelSnapReasonInsidePause')
    case 'file-start':
      return t('LabelSnapReasonFileStart')
    case 'nearest-longest-pause':
      return t('LabelSnapReasonNearestPause')
    case 'heading-lookback':
      return t('LabelSnapReasonHeadingLookback')
    case 'no-pause-in-window':
      return t('LabelSnapReasonNoPause')
    case 'order-conflict':
      return t('LabelSnapReasonOrderConflict')
    case 'not-requested':
      return t('LabelSnapReasonNotRequested')
    case 'not-analysed':
      return t('LabelSnapReasonNotAnalysed')
    case 'analysis-failed':
      return t('LabelSnapReasonAnalysisFailed')
  }
}

/** "High confidence: <reason>", or "No confidence: <reason>". */
function confidenceReasonText(confidence: SnapChapterConfidence, reason: string, t: TypeSafeTranslations): string {
  switch (confidence) {
    case 'high':
      return t('LabelSnapConfidenceReason', { confidence: t('LabelSnapConfidenceHigh'), reason })
    case 'medium':
      return t('LabelSnapConfidenceReason', { confidence: t('LabelSnapConfidenceMedium'), reason })
    case 'low':
      return t('LabelSnapConfidenceReason', { confidence: t('LabelSnapConfidenceLow'), reason })
    case 'none':
      return t('LabelSnapNoConfidenceReason', { reason })
  }
}

const CONFIDENCE_DOT_CLASS: Record<SnapChapterConfidence, string> = {
  high: 'bg-success',
  medium: 'bg-info',
  low: 'bg-warning',
  none: 'bg-foreground-muted'
}

const SPEECH_STATUS_CLASS: Record<SnapSpeechStatus, string> = {
  heading: 'text-success',
  'no-heading': 'text-warning',
  late: 'text-warning',
  early: 'text-warning'
}

const SPEECH_STATUS_ICON: Record<SnapSpeechStatus, string> = {
  heading: 'record_voice_over',
  'no-heading': 'voice_over_off',
  late: 'history',
  early: 'update'
}

function speechStatusLabel(status: SnapSpeechStatus, t: TypeSafeTranslations): string {
  switch (status) {
    case 'heading':
      return t('LabelSnapSpeechHeading')
    case 'no-heading':
      return t('LabelSnapSpeechNoHeading')
    case 'late':
      return t('LabelSnapSpeechLate')
    case 'early':
      return t('LabelSnapSpeechEarly')
  }
}

function speechStatusMessage(status: SnapSpeechStatus, t: TypeSafeTranslations): string {
  switch (status) {
    case 'heading':
      return t('MessageSnapSpeechHeading')
    case 'no-heading':
      return t('MessageSnapSpeechNoHeading')
    case 'late':
      return t('MessageSnapSpeechLate')
    case 'early':
      return t('MessageSnapSpeechEarly')
  }
}

/** What the speech check heard on both sides of the proposed start. */
function SnapSpeechTranscript({ speech }: { speech: SnapChapterSpeech }) {
  const t = useTypeSafeTranslations()
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" cy-id="snap-speech-transcript">
      <dt className="text-foreground-muted">{t('LabelSnapSpeechBefore')}</dt>
      <dd className="break-words" cy-id="snap-speech-before">
        {speech.before ? `…${speech.before}` : t('LabelSnapSpeechNothingHeard')}
      </dd>
      <dt className="text-foreground-muted">{t('LabelSnapSpeechAfter')}</dt>
      <dd className="break-words" cy-id="snap-speech-after">
        {speech.after ? `${speech.after}…` : t('LabelSnapSpeechNothingHeard')}
      </dd>
    </dl>
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface SpeechProgress {
  checked: number
  total: number
}

export default function SnapToAudioPanel({
  chapterCount,
  disabled = false,
  onSnap,
  onRetry,
  onCheckSpeech,
  onApply,
  onApplyTitles,
  preview,
  speechCheckAvailable = false,
  showLookupHint = false,
  onLookupHintDismiss,
  busyRetryDelayMs = SNAP_BUSY_RETRY_DELAY_MS
}: SnapToAudioPanelProps) {
  const t = useTypeSafeTranslations()
  const settingsId = useId()
  const detailsIdPrefix = useId()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [optionDrafts, setOptionDrafts] = useState(defaultOptionDrafts)
  const [isRunning, setIsRunning] = useState(false)
  const [session, setSession] = useState<SnapSession | null>(null)
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const [checkSpeech, setCheckSpeech] = useState(false)
  const [runningWithSpeech, setRunningWithSpeech] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  /** Rows whose heard title was applied in this session; they stay listed after the offer goes away. */
  const [retitled, setRetitled] = useState<Set<number>>(() => new Set())
  /** Set while speech batches run (after the snap request itself). */
  const [speechProgress, setSpeechProgress] = useState<SpeechProgress | null>(null)
  /** A cancelled run's request is still on the server; new requests wait for it so they are not turned away. */
  const [finishingBatch, setFinishingBatch] = useState(false)
  const [speechBusy, setSpeechBusy] = useState(false)

  /** Bumped to stop a speech run (cancel, close, apply, a new snap, unmount). */
  const speechRunRef = useRef(0)
  /** Bumped whenever a different snap result is shown, so a late batch is not merged into the wrong one. */
  const sessionIdRef = useRef(0)
  const sessionRef = useRef<SnapSession | null>(null)
  const inflightRef = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    // A counter, not a DOM node: bumping it on unmount stops a running speech check
    const runs = speechRunRef
    return () => {
      runs.current++
    }
  }, [])

  const speechRunning = speechProgress !== null
  const busy = isRunning || speechRunning
  const controlsDisabled = disabled || busy || finishingBatch
  const canBatchSpeech = speechCheckAvailable && !!onCheckSpeech

  const rows = useMemo(() => (session ? buildSnapRows(session) : []), [session])
  const changedRows = useMemo(() => rows.filter((row) => row.changed), [rows])
  const showSpeech = !!session && snapSessionCheckedSpeech(session)
  const attention = useMemo(() => new Map(rows.map((row) => [row.index, getSnapAttention(row)])), [rows])
  const summary = useMemo(() => (session ? getSnapSummary(rows, session.response, showSpeech) : null), [rows, session, showSpeech])
  /** Chapters the speech check has not reached, when it ran and could run again (not when the audio never reaches chapterbot). */
  const pendingSpeech = useMemo(
    () => (session && canBatchSpeech && showSpeech && getSnapSpeechBlock(session.response) !== 'unavailable' ? getSnapSpeechPendingIndexes(session.response) : []),
    [canBatchSpeech, session, showSpeech]
  )
  /** Heard titles worth offering, by row index (only when the speech check ran and the editor can take them). */
  const heardTitles = useMemo(() => {
    const titles = new Map<number, string>()
    if (!showSpeech || !onApplyTitles) return titles
    for (const row of rows) {
      const heard = getSnapHeardTitle(row)
      if (heard) titles.set(row.index, heard)
    }
    return titles
  }, [onApplyTitles, rows, showSpeech])
  /** Rows a checkbox can pick: ones that would move, and ones with a heard title to use. */
  const selectableRows = useMemo(() => rows.filter((row) => row.changed || heardTitles.has(row.index)), [heardTitles, rows])
  const visibleRows = useMemo(() => {
    const listed = showUnchanged
      ? rows
      : rows.filter((row) => row.changed || heardTitles.has(row.index) || retitled.has(row.index) || attention.get(row.index))
    return onlyFlagged ? listed.filter((row) => attention.get(row.index)) : listed
  }, [attention, heardTitles, onlyFlagged, retitled, rows, showUnchanged])
  const checkedHeardRows = rows.filter((row) => heardTitles.has(row.index) && checked.has(row.index))
  const retryCount = useMemo(() => (session ? getSnapRetryIndexes(session.response).length : 0), [session])
  const failedCount = useMemo(() => rows.filter((row) => row.reason === 'analysis-failed').length, [rows])
  const checkedChangedCount = changedRows.filter((row) => checked.has(row.index)).length
  const speechWarnings = useMemo(() => (session ? getSnapSpeechWarnings(session.response) : []), [session])

  /** Proposal rows are the only controls for a snap preview, so stop it whenever they go away. */
  const stopSnapPreview = useCallback(() => {
    if (!preview) return
    const id = preview.selectedChapterId
    if (typeof id === 'string' && id.startsWith(SNAP_PREVIEW_PREFIX)) preview.destroyAudioEl()
  }, [preview])

  const updateSession = useCallback((next: SnapSession | null) => {
    sessionRef.current = next
    setSession(next)
  }, [])

  const stopSpeechRun = useCallback(() => {
    speechRunRef.current++
    setSpeechProgress(null)
  }, [])

  const showSession = useCallback(
    (next: SnapSession | null) => {
      sessionIdRef.current++
      updateSession(next)
      setChecked(next ? getDefaultSnapChecked(buildSnapRows(next)) : new Set())
      setExpanded(new Set())
      setRetitled(new Set())
      setSpeechBusy(false)
    },
    [updateSession]
  )

  /**
   * Fold a batch into the shown session. The user's ticks stay: a row the verdict flags (late/early) is unticked, and a
   * row that only now would move gets its default; every other row keeps what the user chose.
   */
  const mergeBatch = useCallback(
    (sessionId: number, result: SnapSpeechBatchResult, indexes: number[]): { session: SnapSession; checked: number[] } | null => {
      const current = sessionRef.current
      if (!result.ok || !current || sessionId !== sessionIdRef.current) return null
      const merged = mergeSnapSpeechBatch(current.response, result.response, indexes)
      const next: SnapSession = { ...current, response: merged.response, options: { ...current.options, verify: true } }
      updateSession(next)
      if (merged.checked.length) {
        const defaults = getDefaultSnapChecked(buildSnapRows(next))
        const wasChanged = new Set(buildSnapRows(current).flatMap((row) => (row.changed ? [row.index] : [])))
        setChecked((prev) => {
          const updated = new Set(prev)
          for (const index of merged.checked) {
            if (!defaults.has(index)) updated.delete(index)
            else if (!wasChanged.has(index)) updated.add(index)
          }
          return updated
        })
      }
      return { session: next, checked: merged.checked }
    },
    [updateSession]
  )

  /**
   * Check speech for every chapter still unchecked, one request at a time (the server allows one snap per user), until
   * none are left, the user cancels, or the server keeps failing.
   */
  const runSpeechBatches = useCallback(
    async (start: SnapSession) => {
      if (!onCheckSpeech) return
      const runId = ++speechRunRef.current
      const sessionId = sessionIdRef.current
      const isCurrent = () => speechRunRef.current === runId
      const attempts = new Map<number, number>()
      let current = start
      let emptyBatches = 0
      setSpeechBusy(false)

      const pendingFor = (s: SnapSession) => getSnapSpeechPendingIndexes(s.response).filter((i) => (attempts.get(i) ?? 0) < MAX_SPEECH_ATTEMPTS)
      if (!pendingFor(current).length || getSnapSpeechBlock(current.response) === 'unavailable') return
      setSpeechProgress(getSnapSpeechProgress(current.response))

      try {
        while (isCurrent()) {
          const batch = pendingFor(current).slice(0, SNAP_SPEECH_BATCH_SIZE)
          if (!batch.length) break
          for (const i of batch) attempts.set(i, (attempts.get(i) ?? 0) + 1)

          let result: SnapSpeechBatchResult | null = null
          for (let busyTries = 0; ; busyTries++) {
            if (inflightRef.current) await inflightRef.current
            if (!isCurrent()) return
            const request = onCheckSpeech(current, batch).catch(() => null)
            inflightRef.current = request
            result = await request
            if (inflightRef.current === request) inflightRef.current = null
            if (!isCurrent()) {
              // Cancelled while the request ran: what it checked is still good
              if (result) mergeBatch(sessionId, result, batch)
              return
            }
            if (!result || result.ok || !result.busy || busyTries >= MAX_BUSY_RETRIES) break
            await delay(busyRetryDelayMs)
          }

          if (!result || !result.ok) {
            if (result && result.busy) setSpeechBusy(true)
            break
          }
          const merged = mergeBatch(sessionId, result, batch)
          if (!merged) break
          current = merged.session
          setSpeechProgress(getSnapSpeechProgress(current.response))
          // chapterbot is busy, failed or cannot reach the audio: more batches would fail the same way (the warning shows)
          if (getSnapSpeechBlock(result.response)) break
          emptyBatches = merged.checked.length ? 0 : emptyBatches + 1
          if (emptyBatches >= MAX_EMPTY_BATCHES) break
        }
      } finally {
        if (isCurrent()) setSpeechProgress(null)
      }
    },
    [busyRetryDelayMs, mergeBatch, onCheckSpeech]
  )

  const cancelSpeechRun = useCallback(() => {
    stopSpeechRun()
    const inflight = inflightRef.current
    if (!inflight) return
    setFinishingBatch(true)
    void inflight.then(() => setFinishingBatch(false))
  }, [stopSpeechRun])

  const handleSnap = useCallback(
    async (verifyOverride?: boolean) => {
      if (controlsDisabled) return
      stopSnapPreview()
      // The toggle only counts while the server still advertises the speech check
      const verify = speechCheckAvailable && (verifyOverride ?? checkSpeech)
      if (verifyOverride !== undefined && speechCheckAvailable) setCheckSpeech(verifyOverride)
      const options = parseOptionDrafts(optionDrafts)
      setRunningWithSpeech(verify)
      setIsRunning(true)
      let next: SnapSession | null = null
      try {
        next = await onSnap(verify ? { ...options, verify: true } : options)
        if (next) {
          onLookupHintDismiss?.()
          setShowUnchanged(false)
          setOnlyFlagged(false)
          showSession(next)
        }
      } finally {
        setIsRunning(false)
      }
      if (next && verify && canBatchSpeech && !getSnapSpeechBlock(next.response)) void runSpeechBatches(next)
    },
    [
      canBatchSpeech,
      checkSpeech,
      controlsDisabled,
      onLookupHintDismiss,
      onSnap,
      optionDrafts,
      runSpeechBatches,
      showSession,
      speechCheckAvailable,
      stopSnapPreview
    ]
  )

  const handleRetry = useCallback(async () => {
    if (!session || controlsDisabled) return
    stopSnapPreview()
    const verify = snapSessionCheckedSpeech(session)
    setRunningWithSpeech(verify)
    setIsRunning(true)
    let next: SnapSession | null = null
    try {
      next = await onRetry(session)
      if (next) {
        // Keep the user's choices for rows that were already shown; pre-check the newly analysed ones
        const retried = new Set(getSnapRetryIndexes(session.response))
        const defaults = getDefaultSnapChecked(buildSnapRows(next))
        updateSession(next)
        setChecked((prev) => {
          const merged = new Set([...prev].filter((index) => !retried.has(index)))
          for (const index of defaults) if (retried.has(index)) merged.add(index)
          return merged
        })
      }
    } finally {
      setIsRunning(false)
    }
    if (next && verify && canBatchSpeech && !getSnapSpeechBlock(next.response)) void runSpeechBatches(next)
  }, [canBatchSpeech, controlsDisabled, onRetry, runSpeechBatches, session, stopSnapPreview, updateSession])

  const handleCheckRemainingSpeech = useCallback(() => {
    if (!session || controlsDisabled) return
    void runSpeechBatches(session)
  }, [controlsDisabled, runSpeechBatches, session])

  const handleApply = useCallback(() => {
    const picked = changedRows.filter((row) => checked.has(row.index))
    if (!picked.length) return
    stopSnapPreview()
    onApply(picked)
    showSession(null)
  }, [changedRows, checked, onApply, showSession, stopSnapPreview])

  const handleClose = useCallback(() => {
    stopSnapPreview()
    showSession(null)
  }, [showSession, stopSnapPreview])

  /** Use the heard titles of these rows as chapter titles (unsaved); the proposal stays open with the new titles. */
  const applyHeardTitles = useCallback(
    (targets: SnapRow[]) => {
      if (!onApplyTitles || !session) return
      const picks = targets.flatMap((row) => {
        const heard = heardTitles.get(row.index)
        return heard ? [{ clientKey: row.clientKey, fromTitle: row.title, toTitle: heard }] : []
      })
      if (!picks.length) return
      const applied = new Set(onApplyTitles(picks))
      if (!applied.size) return
      const titles = new Map(picks.filter((pick) => applied.has(pick.clientKey)).map((pick) => [pick.clientKey, pick.toTitle]))
      updateSession(withSnapTitles(session, titles))
      setRetitled((prev) => new Set([...prev, ...targets.filter((row) => applied.has(row.clientKey)).map((row) => row.index)]))
    },
    [heardTitles, onApplyTitles, session, updateSession]
  )

  const toggleExpanded = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const toggleRow = useCallback((index: number, value: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(index)
      else next.delete(index)
      return next
    })
  }, [])

  const toggleAllSelectable = useCallback(
    (value: boolean) => {
      setChecked(value ? new Set(selectableRows.map((row) => row.index)) : new Set())
    },
    [selectableRows]
  )

  const checkedSelectableCount = selectableRows.filter((row) => checked.has(row.index)).length
  const allSelectableChecked = selectableRows.length > 0 && checkedSelectableCount === selectableRows.length

  const summaryParts = summary
    ? [
        summary.moved > 0 ? t('MessageSnapSummaryMoved', { count: summary.moved }) : t('MessageSnapNoChanges'),
        showSpeech && summary.headingHeard > 0 ? t('MessageSnapSummaryHeard', { count: summary.headingHeard }) : null,
        summary.flagged > 0 ? t('MessageSnapSummaryFlagged', { count: summary.flagged }) : null,
        showSpeech && summary.notChecked > 0 ? t('MessageSnapSummaryNotChecked', { count: summary.notChecked }) : null
      ].filter((part): part is string => !!part)
    : []

  return (
    <div className="w-full min-w-0" cy-id="snap-to-audio-panel" aria-busy={busy || undefined}>
      {showLookupHint && !session && !isRunning && (
        <div className="border-info/40 bg-info/10 mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm" cy-id="snap-lookup-hint">
          <span className="material-symbols text-info text-lg" aria-hidden="true">
            graphic_eq
          </span>
          <p className="min-w-0 flex-1">{speechCheckAvailable ? t('MessageSnapLookupHintSpeech') : t('MessageSnapLookupHint')}</p>
          <Btn size="small" color="bg-primary" disabled={controlsDisabled || chapterCount <= 1} onClick={() => void handleSnap(speechCheckAvailable ? true : undefined)}>
            {t('ButtonSnapLookupHint')}
          </Btn>
          <IconBtn borderless size="small" ariaLabel={t('LabelSnapDismissHint')} variant="muted" onClick={() => onLookupHintDismiss?.()}>
            close
          </IconBtn>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Btn size="small" color="bg-primary" loading={isRunning} disabled={controlsDisabled || chapterCount <= 1} onClick={() => void handleSnap()}>
          {t('ButtonSnapToAudio')}
        </Btn>
        <HelpTooltipIcon text={t('MessageSnapToAudioDescription')} />
        <Tooltip lazy text={t('LabelSnapAdvancedSettings')} position="bottom">
          <IconBtn
            borderless
            size="small"
            ariaLabel={t('LabelSnapAdvancedSettings')}
            aria-expanded={settingsOpen}
            aria-controls={settingsId}
            className={mergeClasses('text-foreground-muted hover:not-disabled:text-foreground', settingsOpen && 'text-foreground')}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            tune
          </IconBtn>
        </Tooltip>
        {speechCheckAvailable && (
          <div className="flex items-center gap-1" cy-id="snap-check-speech">
            <Checkbox value={checkSpeech} size="small" label={t('LabelSnapCheckSpeech')} disabled={controlsDisabled} onChange={setCheckSpeech} />
            <HelpTooltipIcon text={t('MessageSnapCheckSpeechDescription')} />
          </div>
        )}
        {isRunning && (
          <span role="status" className="text-foreground-muted text-sm">
            {runningWithSpeech ? t('MessageSnapRunningWithSpeech') : t('MessageSnapRunning')}
          </span>
        )}
        {finishingBatch && !speechRunning && (
          <span role="status" className="text-foreground-muted text-sm" cy-id="snap-speech-finishing">
            {t('MessageSnapSpeechFinishing')}
          </span>
        )}
      </div>

      {speechProgress && (
        <div className="mt-2 flex items-center gap-3 text-sm" cy-id="snap-speech-progress">
          <span role="status" className="shrink-0 tabular-nums" cy-id="snap-speech-progress-label">
            {t('MessageSnapCheckingSpeech', { checked: speechProgress.checked, total: speechProgress.total })}
          </span>
          <div
            role="progressbar"
            aria-label={t('LabelSnapSpeechProgress')}
            aria-valuemin={0}
            aria-valuemax={speechProgress.total}
            aria-valuenow={speechProgress.checked}
            className="bg-track-bg h-1.5 min-w-16 flex-1 overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-300"
              style={{ width: `${speechProgress.total ? (speechProgress.checked / speechProgress.total) * 100 : 0}%` }}
            />
          </div>
          <Btn size="small" onClick={cancelSpeechRun}>
            {t('ButtonCancel')}
          </Btn>
        </div>
      )}

      {settingsOpen && (
        <div id={settingsId} className="mt-2 flex flex-wrap items-end gap-2" cy-id="snap-settings">
          {OPTION_FIELDS.map(({ key, labelKey, step }) => (
            <TextInput
              key={key}
              type="number"
              size="small"
              step={step}
              min={SNAP_DEFAULT_OPTIONS[key] < 0 ? undefined : 0}
              label={t(labelKey)}
              value={optionDrafts[key]}
              disabled={controlsDisabled}
              wrapperClassName="w-36"
              onChange={(value) => setOptionDrafts((prev) => ({ ...prev, [key]: value }))}
              onBlur={() => setOptionDrafts((prev) => ({ ...prev, [key]: String(parseOptionDrafts(prev)[key]) }))}
            />
          ))}
          <Btn size="small" disabled={controlsDisabled} onClick={() => setOptionDrafts(defaultOptionDrafts())}>
            {t('ButtonResetToDefault')}
          </Btn>
          <HelpTooltipIcon text={t('MessageSnapSettingsDescription')} />
        </div>
      )}

      {session && (
        <div className="border-border mt-3 rounded-md border" cy-id="snap-proposal" inert={isRunning || undefined}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
            <div className="flex min-w-0 items-center gap-1">
              <p className="text-sm" role="status" cy-id="snap-summary">
                {summaryParts.join(' · ')}
              </p>
              <HelpTooltipIcon text={t('MessageSnapSummaryNote')} />
            </div>
            <div className="ms-auto flex flex-wrap items-center gap-x-4 gap-y-1">
              {(summary?.flagged ?? 0) > 0 && (
                <div cy-id="snap-only-flagged">
                  <Checkbox value={onlyFlagged} size="small" label={t('LabelSnapShowOnlyFlagged')} onChange={setOnlyFlagged} />
                </div>
              )}
              <div cy-id="snap-show-unchanged">
                <Checkbox value={showUnchanged} size="small" label={t('LabelSnapShowUnchanged')} onChange={setShowUnchanged} />
              </div>
            </div>
          </div>

          {(speechWarnings.length > 0 || speechBusy || (pendingSpeech.length > 0 && !speechRunning)) && (
            <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-sm" cy-id="snap-speech-notes">
              {speechBusy && <p className="text-warning">{t('MessageSnapSpeechStoppedBusy')}</p>}
              {speechWarnings.map((warning) => (
                <p key={warning} className="text-warning" cy-id="snap-speech-warning">
                  {warning}
                </p>
              ))}
              {pendingSpeech.length > 0 && !speechRunning && (
                <Btn size="small" disabled={controlsDisabled} onClick={handleCheckRemainingSpeech}>
                  {t('ButtonSnapCheckSpeechRemaining', { count: pendingSpeech.length })}
                </Btn>
              )}
            </div>
          )}

          {!session.response.complete && (
            <div className="border-border flex flex-wrap items-center gap-2 border-t px-3 py-2 text-sm" cy-id="snap-incomplete">
              {retryCount > 0 && <span className="text-warning">{t('MessageSnapIncomplete', { count: retryCount })}</span>}
              {failedCount > 0 && <span className="text-warning">{t('MessageSnapAnalysisFailed', { count: failedCount })}</span>}
              {retryCount > 0 && (
                <Btn size="small" loading={isRunning} disabled={controlsDisabled} onClick={() => void handleRetry()}>
                  {t('ButtonSnapRetryRemaining')}
                </Btn>
              )}
            </div>
          )}

          {visibleRows.length > 0 && (
            <div className="border-border max-h-72 overflow-auto border-t">
              <table className="w-full min-w-[24rem] table-fixed text-sm sm:min-w-[32rem]" cy-id="snap-table">
                <colgroup>
                  <col className="w-9" />
                  <col />
                  <col className="w-[5.5rem] sm:w-[11.5rem]" />
                  <col className="w-16" />
                  {showSpeech && <col className="w-10" />}
                  <col className="w-[4.75rem]" />
                </colgroup>
                <thead className="bg-bg sticky top-0 z-1">
                  <tr className="border-border text-foreground-muted border-b text-xs">
                    <th className="px-2 py-1">
                      <Checkbox
                        value={allSelectableChecked}
                        partial={checkedSelectableCount > 0 && !allSelectableChecked}
                        size="small"
                        ariaLabel={t('LabelSnapSelectAllChanges')}
                        disabled={selectableRows.length === 0}
                        onChange={toggleAllSelectable}
                      />
                    </th>
                    <th className="px-1 py-1 text-start font-normal">{t('LabelTitle')}</th>
                    <th className="px-1 py-1 text-start font-normal">{t('LabelStart')}</th>
                    <th className="px-1 py-1 text-end font-normal">{t('LabelSnapChange')}</th>
                    {showSpeech && (
                      <th className="px-1 py-1 text-center font-normal">
                        <span className="material-symbols text-sm" aria-hidden="true">
                          mic
                        </span>
                        <span className="sr-only">{t('LabelSnapSpeech')}</span>
                      </th>
                    )}
                    <th className="p-0">
                      <span className="sr-only">{t('LabelSnapActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const previewId = `${SNAP_PREVIEW_PREFIX}${row.index}`
                    const isPreviewSelected = preview?.selectedChapterId === previewId
                    const isPlaying = isPreviewSelected && !!preview?.isPlayingChapter
                    const playLabel = isPlaying ? t('MessagePauseChapter') : t('MessagePlaySnapProposal')
                    const speechStatus = getSnapSpeechStatus(row.speech)
                    const flag = attention.get(row.index) ?? null
                    const isExpanded = expanded.has(row.index)
                    const detailsId = `${detailsIdPrefix}-details-${row.index}`
                    const heardTitle = heardTitles.get(row.index)
                    const selectable = row.changed || !!heardTitle
                    const title = row.title || t('LabelTitle')
                    const confidenceText = confidenceReasonText(row.confidence, snapReasonLabel(row.reason, t), t)
                    const deltaText = row.changed ? t('LabelSnapDelta', { delta: formatSnapDelta(row.delta) }) : ''
                    return (
                      <Fragment key={row.clientKey}>
                        <tr
                          cy-id="snap-row"
                          data-index={row.index}
                          data-speech={speechStatus ?? undefined}
                          data-flag={flag ?? undefined}
                          className={mergeClasses(
                            'border-border h-8 border-b whitespace-nowrap last:border-b-0',
                            !row.changed && 'text-foreground-muted',
                            flag && 'bg-warning/10',
                            isExpanded && 'border-b-0'
                          )}
                        >
                          <td className="px-2">
                            <Checkbox
                              value={selectable && checked.has(row.index)}
                              size="small"
                              ariaLabel={title}
                              disabled={!selectable}
                              onChange={(value) => toggleRow(row.index, value)}
                            />
                          </td>
                          <td className="px-1" cy-id="snap-row-title-cell">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="flex shrink-0" cy-id="snap-confidence">
                                <Tooltip lazy text={confidenceText} position="right">
                                  <span
                                    role="img"
                                    aria-label={confidenceText}
                                    data-confidence={row.confidence}
                                    className={mergeClasses('inline-block size-2 rounded-full', CONFIDENCE_DOT_CLASS[row.confidence])}
                                  />
                                </Tooltip>
                              </span>
                              <span className="truncate" title={row.title} cy-id="snap-row-title">
                                {row.title}
                              </span>
                              {heardTitle && (
                                <Tooltip lazy text={t('LabelSnapSpeechHeard', { title: heardTitle })} position="top">
                                  <span
                                    role="img"
                                    aria-label={t('LabelSnapSpeechHeard', { title: heardTitle })}
                                    className="material-symbols text-primary shrink-0 text-sm"
                                    cy-id="snap-heard-badge"
                                  >
                                    edit_note
                                  </span>
                                </Tooltip>
                              )}
                            </div>
                          </td>
                          <td className="px-1 font-mono text-xs tabular-nums" cy-id="snap-row-start">
                            {row.changed ? (
                              <>
                                <span className="text-foreground-muted max-sm:sr-only">{formatSnapClock(row.originalStart)}</span>
                                <span className="text-foreground-muted px-1 max-sm:hidden" aria-hidden="true">
                                  {'→'}
                                </span>
                                <span className="sr-only"> {t('LabelSnapTo')} </span>
                                {formatSnapClock(row.newStart)}
                              </>
                            ) : (
                              formatSnapClock(row.originalStart)
                            )}
                          </td>
                          <td className="px-1 text-end font-mono text-xs tabular-nums" cy-id="snap-row-delta">
                            {deltaText}
                          </td>
                          {showSpeech && (
                            <td className="px-1 text-center" cy-id="snap-speech">
                              {speechStatus && (
                                <Tooltip lazy text={speechStatusMessage(speechStatus, t)} position="left">
                                  <span
                                    role="img"
                                    aria-label={speechStatusLabel(speechStatus, t)}
                                    className={mergeClasses('material-symbols align-middle text-base', SPEECH_STATUS_CLASS[speechStatus])}
                                    cy-id="snap-speech-icon"
                                  >
                                    {SPEECH_STATUS_ICON[speechStatus]}
                                  </span>
                                </Tooltip>
                              )}
                            </td>
                          )}
                          <td className="px-1">
                            <div className="flex items-center justify-end">
                              {preview && (
                                <IconBtn
                                  borderless
                                  size="small"
                                  ariaLabel={playLabel}
                                  loading={isPreviewSelected && preview.isLoadingChapter}
                                  variant="muted"
                                  onClick={() => preview.playChapter(previewId, row.newStart)}
                                >
                                  {isPlaying ? 'pause' : 'play_arrow'}
                                </IconBtn>
                              )}
                              <IconBtn
                                borderless
                                size="small"
                                ariaLabel={t('LabelSnapRowDetails', { title })}
                                aria-expanded={isExpanded}
                                aria-controls={isExpanded ? detailsId : undefined}
                                variant="muted"
                                cy-id="snap-row-toggle"
                                onClick={() => toggleExpanded(row.index)}
                              >
                                {isExpanded ? 'expand_less' : 'expand_more'}
                              </IconBtn>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr cy-id="snap-row-details" className={mergeClasses('border-border border-b last:border-b-0', flag && 'bg-warning/10')}>
                            <td />
                            <td colSpan={showSpeech ? 5 : 4} className="px-1 pb-2">
                              <div id={detailsId} className="flex flex-col gap-1.5 text-xs">
                                <p className="break-words whitespace-normal">
                                  <span className="font-semibold">{row.title}</span>
                                  {' · '}
                                  {confidenceText}
                                </p>
                                {speechStatus && <p className={SPEECH_STATUS_CLASS[speechStatus]}>{speechStatusMessage(speechStatus, t)}</p>}
                                {row.speech && <SnapSpeechTranscript speech={row.speech} />}
                                {heardTitle && (
                                  <div className="flex flex-wrap items-center gap-2" cy-id="snap-heard-title">
                                    <span>{t('LabelSnapSpeechHeard', { title: heardTitle })}</span>
                                    <Btn size="small" disabled={controlsDisabled} onClick={() => applyHeardTitles([row])}>
                                      {t('ButtonSnapUseHeardTitle')}
                                    </Btn>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {visibleRows.length === 0 && onlyFlagged && (
            <p className="border-border text-foreground-muted border-t px-3 py-2 text-sm">{t('MessageSnapNoFlagged')}</p>
          )}

          <div className="border-border flex flex-wrap justify-end gap-2 border-t px-3 py-2">
            {heardTitles.size > 0 && (
              <Btn size="small" disabled={controlsDisabled || checkedHeardRows.length === 0} onClick={() => applyHeardTitles(checkedHeardRows)}>
                {t('ButtonSnapUseHeardTitles', { count: checkedHeardRows.length })}
              </Btn>
            )}
            <Btn size="small" disabled={busy} onClick={handleClose}>
              {t('ButtonClose')}
            </Btn>
            <Btn size="small" color="bg-success text-success-foreground" disabled={controlsDisabled || checkedChangedCount === 0} onClick={handleApply}>
              {t('ButtonSnapApply', { count: checkedChangedCount })}
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
