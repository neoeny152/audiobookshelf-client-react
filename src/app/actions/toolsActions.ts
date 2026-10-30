'use server'

import type { M4bEncodeOptions, MetadataObject, SeekIndexRepairOptions, SeekIndexStatus } from '@/types/api'
import * as api from '@/lib/api'
import { toActionResult, type ActionResult } from '@/lib/actionResult'

/**
 * Server Action: Get all tasks with queue data
 */
export async function getTasksAction() {
  return api.getTasks()
}

/**
 * Server Action: Get metadata object for embedding preview
 */
export async function getMetadataObjectAction(libraryItemId: string): Promise<MetadataObject> {
  return api.getMetadataObject(libraryItemId)
}

/**
 * Server Action: Embed metadata into audio files with optional backup
 */
export async function embedMetadataAction(libraryItemId: string, backup: boolean) {
  return api.embedMetadata(libraryItemId, backup)
}

/**
 * Server Action: Start M4B encode for a library item
 */
export async function encodeM4bAction(libraryItemId: string, options: M4bEncodeOptions) {
  return api.encodeM4b(libraryItemId, options)
}

/**
 * Server Action: Cancel an in-progress M4B encode
 */
export async function cancelM4bEncodeAction(libraryItemId: string) {
  return api.cancelM4bEncode(libraryItemId)
}

/**
 * Server Action: Which MP3 files have no seek index; `measure` also reports their real duration
 */
export async function getSeekIndexStatusAction(libraryItemId: string, measure = false): Promise<ActionResult<SeekIndexStatus>> {
  return toActionResult(() => api.getSeekIndexStatus(libraryItemId, measure))
}

/**
 * Server Action: Start the seek index repair task
 */
export async function repairSeekIndexAction(libraryItemId: string, options: SeekIndexRepairOptions): Promise<ActionResult<{ taskId: string }>> {
  return toActionResult(() => api.repairSeekIndex(libraryItemId, options))
}
