import { chapterStartsEqual, normalizeChapterStartSec, type EditableChapter } from '@/lib/chapters/chapterEditorUtils'
import type { StatusActionResult } from '@/lib/actionResult'
import { secondsToTimestamp } from '@/lib/datefns'
import type {
  SnapChapterConfidence,
  SnapChapterPause,
  SnapChapterReason,
  SnapChapterSpeech,
  SnapChaptersOptions,
  SnapChaptersPayload,
  SnapChaptersResponse
} from '@/types/api'
import type { TranslationKey } from '@/types/translations'

/** The advanced settings the panel exposes; the server echoes back what it used. */
export interface SnapAdvancedOptions {
  windowSec: number
  minSilenceSec: number
  noiseDb: number
  headingLookbackSec: number
}

/** What one snap request asks for: the advanced settings, plus the speech check when the server has it. */
export type SnapRequestOptions = SnapAdvancedOptions & { verify?: boolean }

/** Server defaults (`chapterSnap.js` DEFAULT_OPTIONS). */
export const SNAP_DEFAULT_OPTIONS: Readonly<SnapAdvancedOptions> = Object.freeze({
  windowSec: 25,
  minSilenceSec: 0.7,
  noiseDb: -38,
  headingLookbackSec: 3
})

/** Server clamp ranges (`chapterSnap.js` NUMERIC_OPTION_BOUNDS). */
export const SNAP_OPTION_BOUNDS: Readonly<Record<keyof SnapAdvancedOptions, readonly [number, number]>> = Object.freeze({
  windowSec: [2, 60],
  minSilenceSec: [0.2, 5],
  noiseDb: [-80, -20],
  headingLookbackSec: [0, 6]
})

/** The server rejects longer titles; they are only echoed back, so trimming them is harmless. */
const MAX_SNAP_TITLE_LENGTH = 1000
/** A heard heading is short ("Chapter 21"); anything longer is not one. */
const MAX_HEARD_TITLE_LENGTH = 200

/** One editor row as it was when the snap was requested. */
export interface SnapSnapshotChapter {
  clientKey: string
  start: number
  title: string
}

/** A snap result together with the editor rows it was computed for. */
export interface SnapSession {
  snapshot: SnapSnapshotChapter[]
  response: SnapChaptersResponse
  /** Reused for the retry, so a retry checks speech when the first request did. */
  options: SnapRequestOptions
}

export interface SnapRow {
  index: number
  clientKey: string
  title: string
  originalStart: number
  /** Raw server proposal (may be fractional). */
  proposedStart: number
  /** What Apply writes into the editor: the proposal at millisecond precision, like every other editor start. */
  newStart: number
  delta: number
  changed: boolean
  reason: SnapChapterReason
  confidence: SnapChapterConfidence
  pause: SnapChapterPause | null
  /** Null unless the speech check ran for this chapter. */
  speech: SnapChapterSpeech | null
}

/**
 * Speech check verdict for one row, worst first: the heading sits on the wrong side of the start, then heard or not.
 * 'not-expected': not heard, but the server says the title is front or back matter that is often not read out.
 */
export type SnapSpeechStatus = 'late' | 'early' | 'heading' | 'no-heading' | 'not-expected'

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Clamp a settings value to the server's range; non-finite input falls back to the default. */
export function clampSnapOption(key: keyof SnapAdvancedOptions, value: number): number {
  const [min, max] = SNAP_OPTION_BOUNDS[key]
  if (!Number.isFinite(value)) return SNAP_DEFAULT_OPTIONS[key]
  return Math.min(max, Math.max(min, value))
}

/** `options` for the request body: `verify` is only sent when true, so a server without the speech check is never asked. */
function toPayloadOptions(options: SnapRequestOptions): SnapChaptersOptions {
  const { verify, ...rest } = options
  return verify === true ? { ...rest, verify: true } : rest
}

/** Snapshot rows as request chapters; ids are the row indexes. */
function toPayloadChapters(snapshot: SnapSnapshotChapter[]): NonNullable<SnapChaptersPayload['chapters']> {
  return snapshot.map((chapter, i) => {
    const title = chapter.title.slice(0, MAX_SNAP_TITLE_LENGTH)
    return title ? { id: i, title, start: chapter.start } : { id: i, start: chapter.start }
  })
}

/** The speech check's result for one chapter, or null when it did not run (or sent something unexpected). */
export function toSnapSpeech(value: unknown): SnapChapterSpeech | null {
  if (!value || typeof value !== 'object') return null
  const speech = value as Record<string, unknown>
  return {
    before: typeof speech.before === 'string' ? speech.before : '',
    after: typeof speech.after === 'string' ? speech.after : '',
    heading: speech.heading === true,
    late: speech.late === true,
    early: speech.early === true,
    heard: toHeardTitle(speech.heard),
    // only an explicit false counts: servers that predate it expect every heading
    expected: speech.expected !== false
  }
}

function toHeardTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const heard = value.trim()
  return heard && heard.length <= MAX_HEARD_TITLE_LENGTH ? heard : null
}

/** Case, punctuation and spacing do not make a title different ("chapter 3." is "Chapter 3"). */
function comparableTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The heading the speech check heard at the start of this row, when it is worth offering as the title: the server
 * reported one (fork servers only), the row's title differs from it, and the title's own heading was not heard (so
 * "Chapter Twelve" or "Chapter 3: The Rain" are not offered "Chapter 12" or "Chapter 3"). Not at a start flagged EARLY or
 * LATE: the clip there may hold the neighbouring chapter ("End of chapter three. ... Chapter four." hears "Chapter 3").
 */
export function getSnapHeardTitle(row: Pick<SnapRow, 'title' | 'speech'>): string | null {
  const heard = row.speech?.heard
  if (!heard || row.speech?.heading || row.speech?.early || row.speech?.late) return null
  return comparableTitle(heard) === comparableTitle(row.title) ? null : heard
}

/**
 * The session after heard titles were applied in the editor (keyed by clientKey): the rows show the new titles, and a
 * retry sends them.
 */
export function withSnapTitles(session: SnapSession, titles: ReadonlyMap<string, string>): SnapSession {
  if (titles.size === 0) return session
  const titleAt = (i: number): string | undefined => {
    const key = session.snapshot[i]?.clientKey
    return key === undefined ? undefined : titles.get(key)
  }
  return {
    ...session,
    snapshot: session.snapshot.map((chapter) => (titles.has(chapter.clientKey) ? { ...chapter, title: titles.get(chapter.clientKey)! } : chapter)),
    response: {
      ...session.response,
      chapters: session.response.chapters.map((chapter, i) => {
        const title = titleAt(i)
        return title === undefined ? chapter : { ...chapter, title }
      }),
      proposedChapters: session.response.proposedChapters.map((chapter, i) => {
        const title = titleAt(i)
        return title === undefined ? chapter : { ...chapter, title }
      })
    }
  }
}

export function getSnapSpeechStatus(speech: SnapChapterSpeech | null): SnapSpeechStatus | null {
  if (!speech) return null
  if (speech.late) return 'late'
  if (speech.early) return 'early'
  if (speech.heading) return 'heading'
  return speech.expected === false ? 'not-expected' : 'no-heading'
}

/** The speech check heard the heading on the wrong side of the proposed start. */
export function isSnapSpeechFlagged(speech: SnapChapterSpeech | null): boolean {
  return !!speech && (speech.late || speech.early)
}

/** Whether this snap ran the speech check (the server echoes `verify` only then). */
export function snapSessionCheckedSpeech(session: SnapSession): boolean {
  return session.options.verify === true || session.response.options?.verify === true
}

/**
 * The server's speech check warnings (busy, time limit, chapters over the per-request limit). Its other warnings are
 * developer notes about the retry contract, which the panel already explains.
 */
export function getSnapSpeechWarnings(response: SnapChaptersResponse): string[] {
  // The server's "Resend with indexes" hint is for API callers; the panel resends by itself (see the speech batches),
  // and the per-request limit is what those batches work around, so that warning is noise here.
  return (response.warnings ?? [])
    .filter((warning) => typeof warning === 'string' && isSpeechWarning(warning) && !SPEECH_LIMIT_WARNING.test(warning))
    .map((warning) => warning.replace(/\s*Resend with "indexes".*$/i, ''))
}

function isSpeechWarning(warning: string): boolean {
  return /^speech check/i.test(warning)
}

const SPEECH_LIMIT_WARNING = /^speech check limited to/i

/** The speech check could not run at all: chapterbot is busy or failed (`chapterbotSpeech.js` createVerifier). */
const SPEECH_STOPPED_WARNING = /^speech check (skipped|failed)/i
/** The speech check can never run for this book: a resend would fail the same way. */
const SPEECH_UNAVAILABLE_WARNING = /^speech check skipped: (the audio files are outside|no audio files)/i

/**
 * Why sending (more) speech batches for this response would be wasted: 'unavailable' when the audio can never reach
 * chapterbot (path map, no audio files), 'stopped' when chapterbot was busy or failed this time, else null.
 */
export function getSnapSpeechBlock(response: SnapChaptersResponse): 'unavailable' | 'stopped' | null {
  const warnings = (response.warnings ?? []).filter((warning): warning is string => typeof warning === 'string')
  if (warnings.some((warning) => SPEECH_UNAVAILABLE_WARNING.test(warning))) return 'unavailable'
  if (warnings.some((warning) => SPEECH_STOPPED_WARNING.test(warning))) return 'stopped'
  return null
}

/**
 * Starts the server checks per snap request (`chapterbotSpeech.js` MAX_VERIFY_STARTS). The panel checks a whole book in
 * batches of this size; a server with a lower limit just leaves some unchecked, which the next batch picks up.
 */
export const SNAP_SPEECH_BATCH_SIZE = 15

/** Reasons the server does not run the speech check for (`chapterSnap.js` SKIP_REASONS). */
const SPEECH_SKIP_REASONS: ReadonlySet<SnapChapterReason> = new Set(['not-requested', 'not-analysed', 'analysis-failed'])

/** Chapters the speech check can run for: the server skips the first chapter, starts under 1 s and skipped chapters. */
function isSpeechCheckable(chapter: SnapChaptersResponse['chapters'][number]): boolean {
  return chapter.index > 0 && chapter.proposedStart >= 1 && !SPEECH_SKIP_REASONS.has(chapter.reason)
}

/** Speech check coverage: how many checkable chapters have a verdict, out of how many. */
export function getSnapSpeechProgress(response: SnapChaptersResponse): { checked: number; total: number } {
  let checked = 0
  let total = 0
  for (const chapter of response.chapters) {
    if (!isSpeechCheckable(chapter)) continue
    total++
    if (toSnapSpeech(chapter.speech)) checked++
  }
  return { checked, total }
}

/** Checkable chapters without a speech verdict yet, in book order. */
export function getSnapSpeechPendingIndexes(response: SnapChaptersResponse): number[] {
  return response.chapters.filter((chapter) => isSpeechCheckable(chapter) && !toSnapSpeech(chapter.speech)).map((chapter) => chapter.index)
}

/**
 * Speech check for some chapters of a session: the chapters exactly as they were snapped (the editor rows at snap time,
 * with any heard titles applied since), so the server proposes the same starts again, and `indexes` set to the batch.
 * Every other chapter comes back `not-requested` and is not checked.
 */
export function buildSnapSpeechPayload(session: SnapSession, indexes: number[]): SnapChaptersPayload {
  return {
    chapters: toPayloadChapters(session.snapshot),
    indexes,
    options: toPayloadOptions({ ...session.options, verify: true })
  }
}

/**
 * One speech batch request. `busy`: the server turned it away (409 a snap is already running for this book, 429 the
 * snap slots are full), so it is worth trying again shortly; the caller does not show a toast for it.
 */
export type SnapSpeechBatchResult = { ok: true; response: SnapChaptersResponse } | { ok: false; busy: boolean }

/** Server minimum gap between chapter starts (`chapterSnap.js` MIN_GAP), kept where the original gap allows it. */
const SNAP_MIN_GAP = 1

/** `chapterSnap.js` orderOk: whether `later` may follow `earlier`, given their original starts. */
function snapOrderOk(earlier: number, later: number, originalEarlier: number, originalLater: number): boolean {
  if (originalLater - originalEarlier < 2 * SNAP_MIN_GAP) return later > earlier
  return later >= earlier + SNAP_MIN_GAP - 1e-6
}

/**
 * Fold one speech batch into the session's result. A batched chapter takes the batch's proposal (its speech verdict was
 * heard at that start), keeping the original start. The batch bounds each chapter by the original neighbours, so a
 * proposal that differs from the session's could break the server's order rule (strictly increasing, a minimum gap)
 * against a neighbour that moved, or undo an order conflict the full snap resolved: that chapter keeps the session's
 * proposal and stays unchecked. Speech warnings come from the latest batch only (they describe what is still unchecked).
 */
export function mergeSnapSpeechBatch(
  previous: SnapChaptersResponse,
  batch: SnapChaptersResponse,
  indexes: number[]
): { response: SnapChaptersResponse; checked: number[] } {
  if (batch.chapters.length !== previous.chapters.length) return { response: previous, checked: [] }
  const chapters = previous.chapters.slice()
  const checked: number[] = []
  for (const i of [...new Set(indexes)].sort((a, b) => a - b)) {
    const prev = chapters[i]
    const next = batch.chapters[i]
    if (!prev || !next || SPEECH_SKIP_REASONS.has(next.reason) || !toSnapSpeech(next.speech)) continue
    const moved = Math.abs(next.proposedStart - prev.proposedStart) >= 0.001
    if (moved) {
      if (prev.reason === 'order-conflict') continue
      const before = chapters[i - 1]
      const after = chapters[i + 1]
      if (before && !snapOrderOk(before.proposedStart, next.proposedStart, before.originalStart, prev.originalStart)) continue
      if (after && !snapOrderOk(next.proposedStart, after.proposedStart, prev.originalStart, after.originalStart)) continue
    }
    const delta = round3(next.proposedStart - prev.originalStart)
    chapters[i] = { ...next, title: prev.title, originalStart: prev.originalStart, delta, changed: delta !== 0 }
    checked.push(i)
  }

  const proposedChapters = previous.proposedChapters.map((chapter, i) => {
    const start = chapters[i]?.proposedStart ?? chapter.start
    const end = chapters[i + 1]?.proposedStart ?? chapter.end
    return { ...chapter, start, end }
  })
  const warnings = [
    ...(previous.warnings ?? []).filter((warning) => typeof warning === 'string' && !isSpeechWarning(warning)),
    ...(batch.warnings ?? []).filter((warning) => typeof warning === 'string' && isSpeechWarning(warning))
  ]

  return {
    response: {
      ...previous,
      options: { ...previous.options, verify: true },
      chapters,
      proposedChapters,
      warnings,
      stats: { ...previous.stats, elapsedMs: previous.stats.elapsedMs + batch.stats.elapsedMs }
    },
    checked
  }
}

/** Why a row may need a look: low confidence, the speech check heard the heading on the wrong side, or not at all. */
export type SnapAttention = 'low-confidence' | 'late' | 'early' | 'no-heading'

/**
 * The most serious reason to look at this row, or null. Low or no confidence only counts for a row that would move (an
 * unchanged row with no pause nearby is left alone); a speech verdict counts either way, since it says the start is off.
 */
export function getSnapAttention(row: Pick<SnapRow, 'changed' | 'confidence' | 'speech'>): SnapAttention | null {
  const status = getSnapSpeechStatus(row.speech)
  if (status === 'late' || status === 'early') return status
  if (status === 'no-heading') return 'no-heading'
  if (row.changed && (row.confidence === 'low' || row.confidence === 'none')) return 'low-confidence'
  return null
}

export interface SnapSummary {
  moved: number
  headingHeard: number
  flagged: number
  /** Checkable chapters the speech check has not reached (only when it ran). */
  notChecked: number
}

export function getSnapSummary(rows: SnapRow[], response: SnapChaptersResponse, checkedSpeech: boolean): SnapSummary {
  const progress = checkedSpeech ? getSnapSpeechProgress(response) : { checked: 0, total: 0 }
  return {
    moved: rows.filter((row) => row.changed).length,
    headingHeard: rows.filter((row) => getSnapSpeechStatus(row.speech) === 'heading').length,
    flagged: rows.filter((row) => getSnapAttention(row) !== null).length,
    notChecked: progress.total - progress.checked
  }
}

/** Signed change with one decimal (`+20.3`, `-1.7`); a move under 0.05 s keeps more so it does not read as 0. */
export function formatSnapDelta(delta: number): string {
  const abs = Math.abs(delta)
  const digits = abs === 0 || abs >= 0.05 ? 1 : abs >= 0.005 ? 2 : 3
  const text = abs.toFixed(digits)
  return `${delta < 0 ? '-' : '+'}${text}`
}

/** `h:mm:ss.s` (tenths truncated like `formatSnapStart`), so every start in the list has the same width. */
export function formatSnapClock(seconds: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '-'
  const tenths = Math.floor(round3(seconds) * 10 + 1e-6)
  const whole = Math.floor(tenths / 10)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths % 10}`
}

/**
 * Request for the CURRENT editor rows (so unsaved edits are snapped). With a selection, only the selected
 * rows are snapped; the others come back `not-requested`. Starts are sent at millisecond precision, the value the
 * editor saves.
 */
export function buildSnapPayload(
  chapters: EditableChapter[],
  selectedKeys: ReadonlySet<string>,
  options: SnapRequestOptions
): { payload: SnapChaptersPayload; snapshot: SnapSnapshotChapter[] } {
  const snapshot = chapters.map((chapter, i) => ({
    clientKey: chapter.clientKey ?? `index-${i}`,
    start: normalizeChapterStartSec(chapter.start),
    title: (chapter.title || '').trim()
  }))

  const payload: SnapChaptersPayload = {
    chapters: toPayloadChapters(snapshot),
    options: toPayloadOptions(options)
  }

  if (selectedKeys.size > 0) {
    const indexes = snapshot.flatMap((chapter, i) => (selectedKeys.has(chapter.clientKey) ? [i] : []))
    if (indexes.length > 0) payload.indexes = indexes
  }

  return { payload, snapshot }
}

/** Chapters the server ran out of time for. */
export function getSnapRetryIndexes(response: SnapChaptersResponse): number[] {
  return response.chapters.filter((chapter) => chapter.reason === 'not-analysed').map((chapter) => chapter.index)
}

/**
 * Server retry contract: resend this response's proposedChapters as `chapters` (bounds come from the neighbours
 * in the request) and `indexes` set to the not-analysed chapters. Null when there is nothing to retry.
 */
export function buildSnapRetryPayload(response: SnapChaptersResponse, options: SnapRequestOptions): SnapChaptersPayload | null {
  const indexes = getSnapRetryIndexes(response)
  if (!indexes.length) return null
  return {
    chapters: response.proposedChapters.map((chapter, i) => ({ id: i, title: chapter.title, start: chapter.start })),
    indexes,
    options: toPayloadOptions(options)
  }
}

/**
 * Fold a retry into the previous result. Retried rows take the new proposal but keep the original start
 * (not-analysed rows were left unchanged, so the retry's input start is the original). The retry's
 * proposedChapters is the full list.
 */
export function mergeSnapRetry(previous: SnapChaptersResponse, retry: SnapChaptersResponse, retriedIndexes: number[]): SnapChaptersResponse {
  if (retry.chapters.length !== previous.chapters.length) return previous
  const retried = new Set(retriedIndexes)
  const chapters = previous.chapters.map((chapter, i) => {
    if (!retried.has(i)) return chapter
    const next = retry.chapters[i]
    const delta = round3(next.proposedStart - chapter.originalStart)
    return { ...next, originalStart: chapter.originalStart, delta, changed: delta !== 0 }
  })
  return {
    ...retry,
    chapters,
    stats: { ...retry.stats, elapsedMs: previous.stats.elapsedMs + retry.stats.elapsedMs }
  }
}

export function buildSnapRows(session: SnapSession): SnapRow[] {
  return session.response.chapters.map((entry, i) => {
    const snapshotRow = session.snapshot[i]
    const originalStart = snapshotRow ? snapshotRow.start : entry.originalStart
    const newStart = entry.changed ? normalizeChapterStartSec(entry.proposedStart) : originalStart
    const changed = !chapterStartsEqual(newStart, originalStart)
    return {
      index: i,
      clientKey: snapshotRow?.clientKey ?? `index-${i}`,
      title: snapshotRow?.title || entry.title,
      originalStart,
      proposedStart: entry.proposedStart,
      newStart,
      delta: changed ? round3(newStart - originalStart) : 0,
      changed,
      reason: entry.reason,
      confidence: entry.confidence,
      pause: entry.pause,
      speech: toSnapSpeech(entry.speech)
    }
  })
}

/**
 * Snap moves are often under a second, so the panel shows starts with tenths (e.g. `01:36.7`). Truncates like
 * `secondsToTimestamp` so 59.99 shows as 00:59.9, never 00:59.10 or 01:00.0.
 */
export function formatSnapStart(seconds: number): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return secondsToTimestamp(seconds)
  const tenths = Math.floor(round3(seconds) * 10 + 1e-6)
  return `${secondsToTimestamp(Math.floor(tenths / 10))}.${tenths % 10}`
}

/**
 * Every row that would move is pre-checked, except low-confidence ones and ones the speech check flagged as late or
 * early (the server already lowers those to low; this does not depend on it).
 */
export function getDefaultSnapChecked(rows: SnapRow[]): Set<number> {
  return new Set(
    rows.filter((row) => row.changed && (row.confidence === 'high' || row.confidence === 'medium') && !isSnapSpeechFlagged(row.speech)).map((row) => row.index)
  )
}

export interface SnapErrorToast {
  key: TranslationKey
  values?: Record<string, string>
  type: 'error' | 'warning'
}

/**
 * Toast for a failed snap request. 409 (a snap is already running for this book) and 429 (the server's snap slots are
 * full) are worth retrying, so they are warnings; status 0 means the server could not be reached.
 */
export function getSnapErrorToast(result: Extract<StatusActionResult<unknown>, { ok: false }>): SnapErrorToast {
  switch (result.status) {
    case 400:
      return result.error
        ? { key: 'ToastSnapChaptersInvalidWithError', values: { error: result.error }, type: 'error' }
        : { key: 'ToastSnapChaptersFailed', type: 'error' }
    case 403:
      return { key: 'ToastSnapChaptersForbidden', type: 'error' }
    case 409:
      return { key: 'ToastSnapChaptersAlreadyRunning', type: 'warning' }
    case 429:
      return { key: 'ToastSnapChaptersBusy', type: 'warning' }
    default:
      return result.error
        ? { key: 'ToastSnapChaptersFailedWithError', values: { error: result.error }, type: 'error' }
        : { key: 'ToastSnapChaptersFailed', type: 'error' }
  }
}
