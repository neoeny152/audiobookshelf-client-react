'use server'

import * as api from '@/lib/api'
import { toStatusActionResult, type StatusActionResult } from '@/lib/actionResult'
import type { TranscriptJob } from '@/lib/transcripts'

/** Server Actions for transcripts (fork feature `transcripts`). All of them are admin-only on the server. */

export async function generateTranscriptAction(
  libraryItemId: string,
  episodeId: string | null,
  method: TranscriptJob['method'] = 'auto'
): Promise<StatusActionResult<{ job: TranscriptJob }>> {
  return toStatusActionResult(() => api.generateTranscript(libraryItemId, episodeId, method))
}

export async function cancelTranscriptJobAction(libraryItemId: string, episodeId: string | null): Promise<StatusActionResult<{ job: TranscriptJob }>> {
  return toStatusActionResult(() => api.cancelTranscriptJob(libraryItemId, episodeId))
}

export async function deleteGeneratedTranscriptAction(libraryItemId: string, episodeId: string | null): Promise<StatusActionResult<void>> {
  return toStatusActionResult(() => api.deleteGeneratedTranscript(libraryItemId, episodeId))
}

export async function refreshTranscriptsFromFeedAction(
  libraryItemId: string,
  episodeId: string | null
): Promise<StatusActionResult<{ updated: number; withTranscripts: number }>> {
  return toStatusActionResult(() => api.refreshTranscriptsFromFeed(libraryItemId, episodeId))
}
