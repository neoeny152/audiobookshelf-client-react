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

/** Speech check verdict for one row, worst first: the heading sits on the wrong side of the start, then heard or not. */
export type SnapSpeechStatus = 'late' | 'early' | 'heading' | 'no-heading'

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

/** The speech check's result for one chapter, or null when it did not run (or sent something unexpected). */
export function toSnapSpeech(value: unknown): SnapChapterSpeech | null {
  if (!value || typeof value !== 'object') return null
  const speech = value as Record<string, unknown>
  return {
    before: typeof speech.before === 'string' ? speech.before : '',
    after: typeof speech.after === 'string' ? speech.after : '',
    heading: speech.heading === true,
    late: speech.late === true,
    early: speech.early === true
  }
}

export function getSnapSpeechStatus(speech: SnapChapterSpeech | null): SnapSpeechStatus | null {
  if (!speech) return null
  if (speech.late) return 'late'
  if (speech.early) return 'early'
  return speech.heading ? 'heading' : 'no-heading'
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
  return (response.warnings ?? []).filter((warning) => typeof warning === 'string' && /^speech check/i.test(warning))
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
    chapters: snapshot.map((chapter, i) => {
      const title = chapter.title.slice(0, MAX_SNAP_TITLE_LENGTH)
      return title ? { id: i, title, start: chapter.start } : { id: i, start: chapter.start }
    }),
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
