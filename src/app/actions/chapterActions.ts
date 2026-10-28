'use server'

import * as api from '@/lib/api'
import { toStatusActionResult, type StatusActionResult } from '@/lib/actionResult'
import type { Chapter, SnapChaptersPayload, SnapChaptersResponse } from '@/types/api'

export async function updateChaptersAction(libraryItemId: string, chapters: Chapter[]) {
  return api.updateChapters(libraryItemId, chapters)
}

export async function searchChaptersAction(asin: string, region: string) {
  return api.searchChapters(asin, region)
}

/**
 * Snap failures carry the HTTP status so the client can explain 409 (already running) and 429 (busy).
 * `status` is 0 when the server could not be reached; `error` is the server's message, or empty.
 */
export type SnapChaptersActionResult = StatusActionResult<SnapChaptersResponse>

export async function snapChaptersAction(libraryItemId: string, payload: SnapChaptersPayload): Promise<SnapChaptersActionResult> {
  return toStatusActionResult(() => api.snapChapters(libraryItemId, payload))
}
