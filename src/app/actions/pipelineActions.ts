'use server'

import * as api from '@/lib/api'
import { toStatusActionResult, type StatusActionResult } from '@/lib/actionResult'
import { pickPipelineUndoBackup } from '@/lib/autoPipeline'
import { toItemHealth, toNeedsWorkItems } from '@/lib/itemHealth'
import type {
  AutoPipelineSettings,
  Chapter,
  ItemHealth,
  Library,
  LibraryPipelineResponse,
  NeedsWorkItem,
  PipelineBackup,
  PipelineItemState,
  PipelineItemStatus,
  PipelineProposal
} from '@/types/api'

/** Server Actions for the auto pipeline (fork only; callers check the `autoPipeline` server feature first). */

export async function getLibraryPipelineAction(libraryId: string, status?: PipelineItemStatus): Promise<StatusActionResult<LibraryPipelineResponse>> {
  return toStatusActionResult(() => api.getLibraryPipeline(libraryId, status))
}

export async function runLibraryPipelineAction(libraryId: string, scope: 'unprocessed' | 'all'): Promise<StatusActionResult<{ queued: number }>> {
  return toStatusActionResult(() => api.runLibraryPipeline(libraryId, scope))
}

export async function getItemPipelineAction(libraryItemId: string): Promise<StatusActionResult<PipelineItemState>> {
  return toStatusActionResult(() => api.getItemPipeline(libraryItemId))
}

/** `fix`: Fix it for me. `repairSeekIndex`: consent to rewrite drifting MP3s for this run (admin only). */
export async function runItemPipelineAction(
  libraryItemId: string,
  options?: { fix?: boolean; repairSeekIndex?: boolean }
): Promise<StatusActionResult<PipelineItemState>> {
  return toStatusActionResult(() => api.runItemPipeline(libraryItemId, options))
}

export async function getItemHealthAction(libraryItemId: string, measure = false): Promise<StatusActionResult<ItemHealth | null>> {
  const result = await toStatusActionResult(() => api.getItemHealth(libraryItemId, measure))
  return result.ok ? { ok: true, data: toItemHealth(result.data) } : result
}

export async function getLibraryNeedsWorkAction(libraryId: string): Promise<StatusActionResult<NeedsWorkItem[]>> {
  const result = await toStatusActionResult(() => api.getLibraryNeedsWork(libraryId))
  return result.ok ? { ok: true, data: toNeedsWorkItems(result.data) } : result
}

export async function updateLibraryAutoPipelineAction(libraryId: string, autoPipeline: Partial<AutoPipelineSettings>): Promise<StatusActionResult<Library>> {
  return toStatusActionResult(() => api.updateLibraryAutoPipeline(libraryId, autoPipeline))
}

export async function dismissItemPipelineAction(libraryItemId: string): Promise<StatusActionResult<void>> {
  return toStatusActionResult(() => api.dismissItemPipeline(libraryItemId))
}

export async function getPipelineProposalAction(libraryItemId: string): Promise<StatusActionResult<PipelineProposal>> {
  return toStatusActionResult(() => api.getPipelineProposal(libraryItemId))
}

export async function approvePipelineProposalAction(libraryItemId: string, chapters?: Chapter[]): Promise<StatusActionResult<PipelineItemState>> {
  return toStatusActionResult(() => api.approvePipelineProposal(libraryItemId, chapters))
}

export async function rejectPipelineProposalAction(libraryItemId: string, continuePipeline: boolean): Promise<StatusActionResult<PipelineItemState>> {
  return toStatusActionResult(() => api.rejectPipelineProposal(libraryItemId, continuePipeline))
}

/**
 * Undo the pipeline's chapters: restores the backup it made before writing them (`preferredBackup`, the state's
 * `chapters.backup`), else the newest backup that is not a "before restoring" copy. The server backs up the current
 * chapters first.
 */
export async function undoPipelineChaptersAction(libraryItemId: string, preferredBackup?: string | null): Promise<StatusActionResult<{ restored: string }>> {
  const list = await toStatusActionResult(() => api.getPipelineBackups(libraryItemId))
  if (!list.ok) return list
  const backups: PipelineBackup[] = Array.isArray(list.data) ? list.data : (list.data?.backups ?? [])
  const target = pickPipelineUndoBackup(backups, preferredBackup)
  if (!target) return { ok: false, status: 404, error: '' }
  const restored = await toStatusActionResult(() => api.restorePipelineBackup(libraryItemId, target.name))
  return restored.ok ? { ok: true, data: { restored: target.name } } : restored
}
