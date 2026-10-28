import type { StatusActionResult } from '@/lib/actionResult'
import { isBookMediaWithTracks, type EpubJob, type EpubJobStatus, type LibraryItem } from '@/types/api'
import type { TranslationKey } from '@/types/translations'

/** EPUB from audio (chapterbot, `POST /api/items/:id/epub`). The server follows the job; the client only shows it. */

const ACTIVE_STATUSES: ReadonlySet<EpubJobStatus> = new Set(['queued', 'running', 'downloading'])
const ALL_STATUSES: ReadonlySet<string> = new Set(['queued', 'running', 'downloading', 'done', 'failed', 'cancelled'])
const STORAGE_PREFIX = 'abs-epub-from-audio-job:'

/** The server still works on the job (it writes the file during `downloading`). */
export function isEpubJobActive(job: Pick<EpubJob, 'status'> | null | undefined): boolean {
  return !!job && ACTIVE_STATUSES.has(job.status)
}

/** The server only cancels queued or running jobs, and only once. */
export function canCancelEpubJob(job: EpubJob | null | undefined): boolean {
  return !!job && (job.status === 'queued' || job.status === 'running') && !job.cancelRequested
}

export function getEpubJobPercent(job: Pick<EpubJob, 'progress'>): number {
  const progress = Number.isFinite(job.progress) ? job.progress : 0
  return Math.round(Math.min(1, Math.max(0, progress)) * 100)
}

/**
 * A server job record (GET, POST, DELETE or a socket event), or null when it is not one. Socket payloads are the only
 * input that does not come straight from a typed request, so this is the gate for them.
 */
export function toEpubJob(value: unknown): EpubJob | null {
  if (!value || typeof value !== 'object') return null
  const job = value as Record<string, unknown>
  if (typeof job.jobId !== 'string' || !job.jobId || typeof job.libraryItemId !== 'string') return null
  if (typeof job.status !== 'string' || !ALL_STATUSES.has(job.status)) return null
  return {
    jobId: job.jobId,
    libraryItemId: job.libraryItemId,
    status: job.status as EpubJobStatus,
    stage: typeof job.stage === 'string' ? job.stage : null,
    progress: typeof job.progress === 'number' && Number.isFinite(job.progress) ? job.progress : 0,
    chaptersDone: typeof job.chaptersDone === 'number' ? job.chaptersDone : 0,
    chaptersTotal: typeof job.chaptersTotal === 'number' ? job.chaptersTotal : 0,
    cancelRequested: job.cancelRequested === true,
    error: typeof job.error === 'string' ? job.error : null,
    fileName: typeof job.fileName === 'string' ? job.fileName : null,
    createdAt: typeof job.createdAt === 'number' ? job.createdAt : 0,
    finishedAt: typeof job.finishedAt === 'number' ? job.finishedAt : null
  }
}

/** The running job's id from a 409 body (`{ error, jobId }`), or null. */
export function parseEpubConflictJobId(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && 'jobId' in parsed && typeof parsed.jobId === 'string' && parsed.jobId) {
      return parsed.jobId
    }
  } catch {
    // Plain-text body
  }
  return null
}

/** Only books with audio and a folder of their own can get an EPUB (the server checks the same). */
export function canMakeEpubFromAudio(libraryItem: LibraryItem): boolean {
  return libraryItem.mediaType === 'book' && !libraryItem.isFile && !libraryItem.isMissing && isBookMediaWithTracks(libraryItem.media)
}

export interface EpubToast {
  key: TranslationKey
  values?: Record<string, string>
  type: 'error' | 'warning'
}

/** Toast for a failed start or cancel request. 429 (chapterbot queue full) is worth retrying later. */
export function getEpubRequestErrorToast(result: Extract<StatusActionResult<unknown>, { ok: false }>, action: 'start' | 'cancel'): EpubToast {
  if (result.status === 403) return { key: 'ToastEpubFromAudioForbidden', type: 'error' }
  if (action === 'start' && result.status === 429) return { key: 'ToastEpubFromAudioBusy', type: 'warning' }
  const key: TranslationKey = action === 'start' ? 'ToastEpubFromAudioStartFailed' : 'ToastEpubFromAudioCancelFailed'
  const withErrorKey: TranslationKey = action === 'start' ? 'ToastEpubFromAudioStartFailedWithError' : 'ToastEpubFromAudioCancelFailedWithError'
  return result.error ? { key: withErrorKey, values: { error: result.error }, type: 'error' } : { key, type: 'error' }
}

/*
 * The job id is remembered per item in this browser so the progress comes back after leaving the page. The server
 * keeps jobs in memory only; a 404 on the next look means it is gone and the id is forgotten.
 */

export function rememberEpubJob(libraryItemId: string, jobId: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${libraryItemId}`, jobId)
  } catch {
    // Storage unavailable (private window, blocked site data): progress just is not restored
  }
}

export function recallEpubJob(libraryItemId: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${libraryItemId}`) || null
  } catch {
    return null
  }
}

export function forgetEpubJob(libraryItemId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${libraryItemId}`)
  } catch {
    // Nothing to forget
  }
}
