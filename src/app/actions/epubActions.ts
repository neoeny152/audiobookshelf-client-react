'use server'

import * as api from '@/lib/api'
import { parseApiErrorBody, toStatusActionResult, type StatusActionResult } from '@/lib/actionResult'
import { ApiError } from '@/lib/apiErrors'
import { parseEpubConflictJobId } from '@/lib/epubFromAudio'
import { isNextRedirectError } from '@/lib/nextErrors'
import type { EpubJob } from '@/types/api'

/** `alreadyRunning`: the item already had a job (409), which is returned instead of starting a second one. */
export type StartEpubJobActionResult = StatusActionResult<{ job: EpubJob; alreadyRunning: boolean }>

/**
 * Server Action: start an EPUB-from-audio job. A 409 means one is already running for this book; its status is
 * looked up and returned so the client can follow it.
 */
export async function startEpubJobAction(libraryItemId: string): Promise<StartEpubJobActionResult> {
  try {
    return { ok: true, data: { job: await api.startEpubJob(libraryItemId), alreadyRunning: false } }
  } catch (error) {
    if (isNextRedirectError(error)) throw error
    if (error instanceof ApiError) {
      if (error.status === 409) {
        const jobId = parseEpubConflictJobId(error.message)
        if (jobId) {
          const existing = await toStatusActionResult(() => api.getEpubJob(libraryItemId, jobId))
          if (existing.ok) return { ok: true, data: { job: existing.data, alreadyRunning: true } }
        }
      }
      return { ok: false, status: error.status, error: parseApiErrorBody(error.message) }
    }
    console.error('Starting the EPUB job failed', error)
    return { ok: false, status: 0, error: '' }
  }
}

export async function getEpubJobAction(libraryItemId: string, jobId: string): Promise<StatusActionResult<EpubJob>> {
  return toStatusActionResult(() => api.getEpubJob(libraryItemId, jobId))
}

export async function cancelEpubJobAction(libraryItemId: string, jobId: string): Promise<StatusActionResult<EpubJob>> {
  return toStatusActionResult(() => api.cancelEpubJob(libraryItemId, jobId))
}

/** The item's current or latest job (newer servers, `chapterbotEpubCurrent`); 404 when it has none. */
export async function getCurrentEpubJobAction(libraryItemId: string): Promise<StatusActionResult<EpubJob>> {
  return toStatusActionResult(() => api.getCurrentEpubJob(libraryItemId))
}
