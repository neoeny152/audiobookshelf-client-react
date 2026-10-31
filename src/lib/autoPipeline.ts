import { chapterStartsEqual } from '@/lib/chapters/chapterEditorUtils'
import { buildSnapRows, getDefaultSnapChecked, SNAP_DEFAULT_OPTIONS, type SnapSession } from '@/lib/chapters/chapterSnap'
import type { AutoPipelineMode, AutoPipelineSettings, Chapter, PipelineBackup, PipelineItemState, PipelineItemStatus, PipelineProposal } from '@/types/api'
import type { TranslationKey } from '@/types/translations'

/**
 * Auto pipeline (fork only, `/status` lists `autoPipeline`): new books are matched, get checked chapters and, if
 * enabled, an EPUB, without anyone doing it by hand. The server does the work; these helpers only shape what it sends.
 */

export const AUTO_PIPELINE_MODES: readonly AutoPipelineMode[] = Object.freeze(['off', 'dryRun', 'on'])

/** The server's book defaults (`getDefaultLibrarySettingsForMediaType`). */
export const AUTO_PIPELINE_DEFAULTS: Readonly<AutoPipelineSettings> = Object.freeze({
  mode: 'off',
  autoMatch: true,
  autoMatchMinConfidence: 95,
  autoMatchProvider: null,
  autoChapters: true,
  autoEpub: false,
  settleMinutes: 5,
  autoRepairSeekIndex: false,
  nightlySweep: false,
  sweepStart: '01:00',
  sweepEnd: '06:00'
})

export const MIN_CONFIDENCE_BOUNDS = Object.freeze([50, 100] as const)
export const SETTLE_MINUTES_BOUNDS = Object.freeze([1, 120] as const)
const SWEEP_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
/**
 * Below this minimum match confidence the settings warn: the server's caps for a wrong title (60), a duration more than
 * 15 % off (70) or a missing author or duration (80) no longer keep those matches out.
 */
export const LOW_CONFIDENCE_WARNING = 90

function clampInt(value: number, [min, max]: readonly [number, number], fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampMinConfidence(value: number): number {
  return clampInt(value, MIN_CONFIDENCE_BOUNDS, AUTO_PIPELINE_DEFAULTS.autoMatchMinConfidence)
}

export function clampSettleMinutes(value: number): number {
  return clampInt(value, SETTLE_MINUTES_BOUNDS, AUTO_PIPELINE_DEFAULTS.settleMinutes)
}

/** The stored settings with defaults for anything missing or of the wrong type (older libraries have none). */
export function withAutoPipelineDefaults(value: unknown): AutoPipelineSettings {
  const stored = value && typeof value === 'object' ? (value as Partial<Record<keyof AutoPipelineSettings, unknown>>) : {}
  const bool = (key: 'autoMatch' | 'autoChapters' | 'autoEpub' | 'autoRepairSeekIndex' | 'nightlySweep') =>
    typeof stored[key] === 'boolean' ? (stored[key] as boolean) : AUTO_PIPELINE_DEFAULTS[key]
  const time = (key: 'sweepStart' | 'sweepEnd') =>
    typeof stored[key] === 'string' && SWEEP_TIME_RE.test(stored[key] as string) ? (stored[key] as string) : AUTO_PIPELINE_DEFAULTS[key]
  return {
    mode: AUTO_PIPELINE_MODES.includes(stored.mode as AutoPipelineMode) ? (stored.mode as AutoPipelineMode) : AUTO_PIPELINE_DEFAULTS.mode,
    autoMatch: bool('autoMatch'),
    autoMatchMinConfidence:
      typeof stored.autoMatchMinConfidence === 'number' ? clampMinConfidence(stored.autoMatchMinConfidence) : AUTO_PIPELINE_DEFAULTS.autoMatchMinConfidence,
    autoMatchProvider: typeof stored.autoMatchProvider === 'string' && stored.autoMatchProvider ? stored.autoMatchProvider : null,
    autoChapters: bool('autoChapters'),
    autoEpub: bool('autoEpub'),
    settleMinutes: typeof stored.settleMinutes === 'number' ? clampSettleMinutes(stored.settleMinutes) : AUTO_PIPELINE_DEFAULTS.settleMinutes,
    autoRepairSeekIndex: bool('autoRepairSeekIndex'),
    nightlySweep: bool('nightlySweep'),
    sweepStart: time('sweepStart'),
    sweepEnd: time('sweepEnd')
  }
}

/** v1 matches and takes chapters from Audible only (`audible`, `audible.uk`, ...). */
export function isAudibleProvider(provider: string | null | undefined): boolean {
  return !!provider && (provider === 'audible' || provider.startsWith('audible.'))
}

export const PIPELINE_STATUSES: readonly PipelineItemStatus[] = Object.freeze([
  'queued',
  'waiting',
  'repairing',
  'matching',
  'chapters',
  'epub',
  'done',
  'needs-review',
  'failed',
  'skipped'
])

export type PipelineTab = 'queue' | 'review' | 'done' | 'failed'
export const PIPELINE_TABS: readonly PipelineTab[] = Object.freeze(['queue', 'review', 'done', 'failed'])

export function getPipelineTab(status: PipelineItemStatus): PipelineTab {
  if (status === 'needs-review') return 'review'
  if (status === 'failed') return 'failed'
  if (status === 'done' || status === 'skipped') return 'done'
  return 'queue'
}

/** The pipeline is still working on the book (or will). */
export function isPipelineActive(status: PipelineItemStatus): boolean {
  return getPipelineTab(status) === 'queue'
}

export const PIPELINE_STATUS_LABEL: Readonly<Record<PipelineItemStatus, TranslationKey>> = Object.freeze({
  queued: 'LabelPipelineStatusQueued',
  waiting: 'LabelPipelineStatusWaiting',
  repairing: 'LabelPipelineStatusRepairing',
  matching: 'LabelPipelineStatusMatching',
  chapters: 'LabelPipelineStatusChapters',
  epub: 'LabelPipelineStatusEpub',
  done: 'LabelPipelineStatusDone',
  'needs-review': 'LabelPipelineStatusNeedsReview',
  failed: 'LabelPipelineStatusFailed',
  skipped: 'LabelPipelineStatusSkipped'
})

/** Chip colours by tab (theme tokens). */
export const PIPELINE_TAB_CHIP_CLASS: Readonly<Record<PipelineTab, string>> = Object.freeze({
  queue: 'bg-info/20 text-foreground border-info/60',
  review: 'bg-warning/20 text-foreground border-warning/70',
  done: 'bg-success/20 text-foreground border-success/60',
  failed: 'bg-error/20 text-foreground border-error/60'
})

type RepairResult = NonNullable<PipelineItemState['repair']>['result']
const REPAIR_RESULTS: readonly RepairResult[] = ['not-needed', 'needs-ok', 'would-repair', 'running', 'repaired', 'failed']
const PIPELINE_TRIGGERS: readonly NonNullable<PipelineItemState['trigger']>[] = ['scan', 'manual', 'fix', 'sweep']

export function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * A pipeline state from the server (GET or the `pipeline_item_updated` socket event), or null when it is not one.
 * Socket payloads are untyped, so everything the UI reads is checked here.
 */
export function toPipelineItemState(value: unknown): PipelineItemState | null {
  const state = obj(value)
  if (!state) return null
  if (typeof state.libraryItemId !== 'string' || !state.libraryItemId) return null
  if (typeof state.status !== 'string' || !PIPELINE_STATUSES.includes(state.status as PipelineItemStatus)) return null
  const repair = obj(state.repair)
  const repairResult = REPAIR_RESULTS.find((result) => result === repair?.result)
  const match = obj(state.match)
  const chapters = obj(state.chapters)
  const partial = obj(chapters?.partial)
  const seekIndex = obj(chapters?.seekIndex)
  const epub = obj(state.epub)
  return {
    libraryItemId: state.libraryItemId,
    libraryId: typeof state.libraryId === 'string' ? state.libraryId : '',
    title: str(state.title),
    status: state.status as PipelineItemStatus,
    step: str(state.step),
    reason: str(state.reason),
    dryRun: state.dryRun === true,
    trigger: PIPELINE_TRIGGERS.find((trigger) => trigger === state.trigger) ?? null,
    queuedAt: num(state.queuedAt),
    updatedAt: num(state.updatedAt),
    attempts: num(state.attempts) ?? 0,
    notBefore: num(state.notBefore),
    repair: repair && repairResult ? { result: repairResult, files: num(repair.files), maxDrift: num(repair.maxDrift) } : null,
    match: match
      ? {
          result: str(match.result),
          reason: str(match.reason),
          confidence: num(match.confidence),
          asin: str(match.asin),
          candidates: Array.isArray(match.candidates) ? match.candidates.filter((c) => !!obj(c)) : [],
          would: str(match.would)
        }
      : null,
    chapters: chapters
      ? {
          result: str(chapters.result),
          reason: str(chapters.reason),
          // the server sends `{ kind: 'aligned' | 'near' | 'scanner' | ..., asin, region, variant, ... }`
          source: typeof chapters.source === 'string' ? chapters.source : (str(obj(chapters.source)?.kind) ?? str(obj(chapters.source)?.type)),
          diffSec: num(chapters.diffSec),
          applied: chapters.applied === true,
          needsReview: normalizePipelineFailing(Array.isArray(chapters.needsReview) ? chapters.needsReview : chapters.failing).map((entry) => ({
            index: entry.index,
            why: entry.why.join(', ')
          })),
          backup: str(chapters.backup),
          count: num(chapters.count),
          would: str(chapters.would),
          partial: partial ? { applied: num(partial.applied) ?? 0, flagged: num(partial.flagged) ?? 0 } : null,
          seekIndex: seekIndex ? { files: num(seekIndex.files) ?? 0, maxDrift: num(seekIndex.maxDrift) ?? 0 } : null
        }
      : null,
    epub: epub ? { result: str(epub.result), jobId: str(epub.jobId), fileName: str(epub.fileName), would: str(epub.would) } : null,
    would: str(state.would)
  }
}

/** Failing chapters as `{ index, why: codes[] }` (the server sends `why` as an array of codes; older drafts a string). */
export function normalizePipelineFailing(value: unknown): { index: number; why: string[] }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const e = obj(entry)
    if (!e || typeof e.index !== 'number') return []
    const why = Array.isArray(e.why) ? e.why.filter((w): w is string => typeof w === 'string' && !!w) : typeof e.why === 'string' && e.why ? [e.why] : []
    return [{ index: e.index, why }]
  })
}

const WHY_LABEL: Readonly<Record<string, TranslationKey>> = Object.freeze({
  late: 'LabelAutoPipelineWhyLate',
  early: 'LabelAutoPipelineWhyEarly',
  'heading-not-heard': 'LabelAutoPipelineWhyHeadingNotHeard',
  'heard-other-heading': 'LabelAutoPipelineWhyOtherHeading',
  'no-speech-check': 'LabelAutoPipelineWhyNoSpeechCheck',
  'not-analysed': 'LabelAutoPipelineWhyNotAnalysed',
  'analysis-failed': 'LabelAutoPipelineWhyAnalysisFailed'
})

/** Reasons that hold the whole proposal back (`blockers`, server `chapterPlan.evaluatePolicy` and the chapters step). */
const BLOCKER_LABEL: Readonly<Record<string, TranslationKey>> = Object.freeze({
  'source-near': 'LabelAutoPipelineBlockerSourceNear',
  'source-mismatch': 'LabelAutoPipelineBlockerSourceMismatch',
  'snap-incomplete': 'LabelAutoPipelineBlockerSnapIncomplete',
  'user-edited': 'LabelAutoPipelineBlockerUserEdited',
  'speech-check-unavailable': 'LabelAutoPipelineBlockerSpeechCheckUnavailable',
  'no-snap': 'LabelAutoPipelineBlockerNoSnap',
  'titles-differ': 'LabelAutoPipelineBlockerTitlesDiffer'
})

/**
 * A translatable label for a policy code (`late`, `confidence-low`, a blocker such as `source-near`): the key and its
 * values, or null for a code this client does not know (shown as the server sent it).
 */
export function getPipelineWhyLabel(code: string): { key: TranslationKey; values?: Record<string, string> } | null {
  if (code.startsWith('confidence-')) return { key: 'LabelAutoPipelineWhyConfidence', values: { confidence: code.slice('confidence-'.length) } }
  // `current-<problem>`: the person's chapters are clearly broken (no-chapters, overlapping, ...)
  if (code.startsWith('current-')) return { key: 'LabelAutoPipelineBlockerCurrentBad' }
  const key = WHY_LABEL[code] ?? BLOCKER_LABEL[code]
  return key ? { key } : null
}

/** The library-wide response: a list of valid states (anything malformed is dropped). */
export function toPipelineItemStates(value: unknown): PipelineItemState[] {
  return Array.isArray(value) ? value.flatMap((entry) => toPipelineItemState(entry) ?? []) : []
}

/** Replace (or add) one item's state, keeping the list order. A state for another library is ignored. */
export function upsertPipelineItem(items: PipelineItemState[], next: PipelineItemState, libraryId: string): PipelineItemState[] {
  if (next.libraryId && libraryId && next.libraryId !== libraryId) return items
  const index = items.findIndex((item) => item.libraryItemId === next.libraryItemId)
  if (index === -1) return [...items, next]
  const copy = items.slice()
  copy[index] = next
  return copy
}

export function countPipelineTabs(items: PipelineItemState[]): Record<PipelineTab, number> {
  const counts: Record<PipelineTab, number> = { queue: 0, review: 0, done: 0, failed: 0 }
  for (const item of items) counts[getPipelineTab(item.status)]++
  return counts
}

/** Queue in processing order (oldest first), finished tabs newest first. */
export function sortPipelineItems(items: PipelineItemState[], tab: PipelineTab): PipelineItemState[] {
  const sorted = items.slice()
  if (tab === 'queue') sorted.sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0))
  else sorted.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return sorted
}

/** The match confidence to show, as an integer percent, or null when the match step did not score anything. */
export function getPipelineMatchPercent(state: Pick<PipelineItemState, 'match'>): number | null {
  const confidence = state.match?.confidence
  if (confidence == null) return null
  // Older drafts of the server reported 0..1
  const percent = confidence <= 1 && confidence > 0 && !Number.isInteger(confidence) ? confidence * 100 : confidence
  return Math.round(Math.min(100, Math.max(0, percent)))
}

/**
 * Dry-run lines ("would match B0xx at 97 %"), in step order. Empty unless the state is a dry run. A finished dry run
 * carries the server's summary (`would`, parts joined by "; "); one still running has only the per-step lines.
 */
export function getPipelineWouldLines(state: PipelineItemState): string[] {
  if (!state.dryRun) return []
  const lines = state.would
    ? state.would.split('; ')
    : [state.match?.would, state.chapters?.would, state.epub?.would].filter((line): line is string => !!line)
  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)))
}

/**
 * The pipeline wrote chapters (applied or approved, with a backup), so "Undo chapters" can restore the earlier ones.
 * Not after an undo: the newest backup is then the pipeline's own chapters, and undoing again would put them back.
 */
export function canUndoPipelineChapters(state: PipelineItemState): boolean {
  const chapters = state.chapters
  if (state.dryRun || !chapters || chapters.result === 'restored') return false
  return chapters.applied || chapters.result === 'applied' || chapters.result === 'approved'
}

/**
 * The backup "Undo chapters" restores: the one the pipeline made before writing (`chapters.backup` of the state), else
 * the newest backup that is not the server's own "before restoring" copy.
 */
export function pickPipelineUndoBackup(backups: PipelineBackup[], preferred?: string | null): PipelineBackup | null {
  if (preferred) {
    const exact = backups.find((backup) => backup.name === preferred)
    if (exact) return exact
  }
  const candidates = backups.filter((backup) => backup.source !== 'restore')
  return [...candidates].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.name.localeCompare(a.name))[0] ?? null
}

/**
 * The chapters step stopped for review with a proposal to look at. Not for a dry run: the server refuses to approve
 * a dry-run proposal, so reviewing it in the editor would lead nowhere.
 */
export function hasPipelineChapterReview(state: PipelineItemState): boolean {
  return !state.dryRun && state.status === 'needs-review' && state.chapters?.result === 'needs-review'
}

/** The match step stopped (review, or failed while matching): the stock match dialog is the way out. */
export function hasPipelineMatchReview(state: PipelineItemState): boolean {
  if (state.status !== 'needs-review' && state.status !== 'failed') return false
  if (state.step === 'matching') return true
  if (state.status === 'failed') return false
  return state.match?.result === 'needs-review' || (!!state.reason && state.reason.startsWith('match:'))
}

/**
 * `pipeline_item_updated` for a book taken off the pipeline (Dismiss): `{ libraryItemId, libraryId, status: 'dismissed' }`.
 * Returns the item id, or null for any other payload.
 */
export function getDismissedPipelineItemId(value: unknown): string | null {
  const event = obj(value)
  return event && event.status === 'dismissed' && typeof event.libraryItemId === 'string' ? event.libraryItemId : null
}

/** `worker.current` is the state of the book being processed (older drafts sent its id). */
export function getPipelineWorkerItemId(current: unknown): string | null {
  if (typeof current === 'string') return current || null
  const state = obj(current)
  return state && typeof state.libraryItemId === 'string' ? state.libraryItemId : null
}

/** Item page link that opens the chapter editor on the pipeline's proposal. */
export function getPipelineReviewHref(libraryId: string, libraryItemId: string): string {
  return `/library/${libraryId}/item/${libraryItemId}?edit=chapters&proposal=pipeline`
}

export function getPipelineMatchHref(libraryId: string, libraryItemId: string): string {
  return `/library/${libraryId}/item/${libraryItemId}?edit=match`
}

export function getProcessingHref(libraryId: string, tab?: PipelineTab): string {
  return `/library/${libraryId}/processing${tab ? `?tab=${tab}` : ''}`
}

/** The chapters the pipeline proposes (`proposedChapters`, else the stored snap's). */
export function getPipelineProposalChapters(proposal: PipelineProposal): Chapter[] {
  if (Array.isArray(proposal.proposedChapters) && proposal.proposedChapters.length) return proposal.proposedChapters
  return Array.isArray(proposal.snap?.proposedChapters) ? proposal.snap.proposedChapters : []
}

/**
 * The chapters the review opens with: the proposal, except that a start the snap panel would leave unticked (flagged
 * LATE or EARLY by the speech check, or low confidence) stays where it was before the snap. The panel then shows those
 * rows unticked and still able to move, and Save never writes a move the policy and the panel both held back.
 */
export function getPipelineReviewChapters(proposal: PipelineProposal): Chapter[] {
  const chapters = getPipelineProposalChapters(proposal)
  const session = buildPipelineProposalSession(proposal, chapters)
  if (!session) return chapters
  const ticked = getDefaultSnapChecked(buildSnapRows(session))
  const entries = session.response.chapters
  const starts = chapters.map((chapter, i) => {
    const entry = entries[i]
    if (i === 0 || !entry.changed || ticked.has(i) || !Number.isFinite(entry.originalStart)) return chapter.start
    return entry.originalStart
  })
  // A start put back can cross a neighbour that moved: then nothing moves (the pre-snap list is in order)
  const ordered = starts.every((start, i) => i === 0 || start > starts[i - 1])
  const finalStarts = ordered ? starts : chapters.map((chapter, i) => (i === 0 ? chapter.start : entries[i].originalStart))
  if (finalStarts.every((start, i) => start === chapters[i].start)) return chapters
  const last = chapters[chapters.length - 1]
  return chapters.map((chapter, i) => ({ ...chapter, start: finalStarts[i], end: i < chapters.length - 1 ? finalStarts[i + 1] : last.end }))
}

/**
 * The editor's chapters are the pipeline's proposal as it stands (same titles and starts), so approving needs no
 * chapters: the server then applies its own list and keeps treating the chapters as the pipeline's, not a person's.
 */
export function isUnchangedPipelineProposal(chapters: Pick<Chapter, 'title' | 'start'>[], proposed: Pick<Chapter, 'title' | 'start'>[]): boolean {
  return (
    chapters.length > 0 &&
    chapters.length === proposed.length &&
    chapters.every((chapter, i) => (chapter.title ?? '') === (proposed[i].title ?? '') && chapterStartsEqual(chapter.start, proposed[i].start))
  )
}

/**
 * The stored snap as a snap panel session for the editor rows made from the proposal, so the panel shows its LATE,
 * EARLY and heading verdicts without running again. The snapshot holds the starts before the snap (what the panel
 * compares against). Null when the rows do not line up with the snap's chapters.
 */
export function buildPipelineProposalSession(proposal: PipelineProposal, rows: { clientKey?: string; title?: string | null }[]): SnapSession | null {
  const snap = proposal.snap
  if (!snap || !Array.isArray(snap.chapters) || snap.chapters.length === 0 || snap.chapters.length !== rows.length) return null
  const options = snap.options ?? {}
  return {
    snapshot: rows.map((row, i) => ({
      clientKey: row.clientKey ?? `index-${i}`,
      start: snap.chapters[i].originalStart,
      title: row.title ?? snap.chapters[i].title ?? ''
    })),
    response: snap,
    options: {
      windowSec: options.windowSec ?? SNAP_DEFAULT_OPTIONS.windowSec,
      minSilenceSec: options.minSilenceSec ?? SNAP_DEFAULT_OPTIONS.minSilenceSec,
      noiseDb: options.noiseDb ?? SNAP_DEFAULT_OPTIONS.noiseDb,
      headingLookbackSec: options.headingLookbackSec ?? SNAP_DEFAULT_OPTIONS.headingLookbackSec,
      ...(options.verify ? { verify: true } : {})
    }
  }
}
