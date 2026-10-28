'use server'

import * as api from '@/lib/api'
import { ApiError } from '@/lib/apiErrors'
import { isNextRedirectError } from '@/lib/nextErrors'
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
export type SnapChaptersActionResult = { ok: true; data: SnapChaptersResponse } | { ok: false; status: number; error: string }

function snapErrorMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
      return parsed.error
    }
  } catch {
    // Plain-text body such as "Forbidden"
  }
  return body.trim()
}

export async function snapChaptersAction(libraryItemId: string, payload: SnapChaptersPayload): Promise<SnapChaptersActionResult> {
  try {
    return { ok: true, data: await api.snapChapters(libraryItemId, payload) }
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error
    }
    if (error instanceof ApiError) {
      return { ok: false, status: error.status, error: snapErrorMessage(error.message) }
    }
    console.error('Failed to snap chapters', error)
    return { ok: false, status: 0, error: '' }
  }
}
