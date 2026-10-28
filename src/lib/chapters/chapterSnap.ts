import { chapterStartsEqual, normalizeChapterStartSec, type EditableChapter } from '@/lib/chapters/chapterEditorUtils'
import type { StatusActionResult } from '@/lib/actionResult'
import { secondsToTimestamp } from '@/lib/datefns'
import type { SnapChapterConfidence, SnapChapterPause, SnapChapterReason, SnapChaptersPayload, SnapChaptersResponse } from '@/types/api'
import type { TranslationKey } from '@/types/translations'

/** The advanced settings the panel exposes; the server echoes back what it used. */
export interface SnapAdvancedOptions {
  windowSec: number
  minSilenceSec: number
  noiseDb: number
  headingLookbackSec: number
}

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
  options: SnapAdvancedOptions
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
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Clamp a settings value to the server's range; non-finite input falls back to the default. */
export function clampSnapOption(key: keyof SnapAdvancedOptions, value: number): number {
  const [min, max] = SNAP_OPTION_BOUNDS[key]
  if (!Number.isFinite(value)) return SNAP_DEFAULT_OPTIONS[key]
  return Math.min(max, Math.max(min, value))
}

/**
 * Request for the CURRENT editor rows (so unsaved edits are snapped). With a selection, only the selected
 * rows are snapped; the others come back `not-requested`. Starts are sent at millisecond precision, the value the
 * editor saves.
 */
export function buildSnapPayload(
  chapters: EditableChapter[],
  selectedKeys: ReadonlySet<string>,
  options: SnapAdvancedOptions
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
    options: { ...options }
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
export function buildSnapRetryPayload(response: SnapChaptersResponse, options: SnapAdvancedOptions): SnapChaptersPayload | null {
  const indexes = getSnapRetryIndexes(response)
  if (!indexes.length) return null
  return {
    chapters: response.proposedChapters.map((chapter, i) => ({ id: i, title: chapter.title, start: chapter.start })),
    indexes,
    options: { ...options }
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
      pause: entry.pause
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

/** Every row that would move is pre-checked, except low-confidence ones. */
export function getDefaultSnapChecked(rows: SnapRow[]): Set<number> {
  return new Set(rows.filter((row) => row.changed && (row.confidence === 'high' || row.confidence === 'medium')).map((row) => row.index))
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
