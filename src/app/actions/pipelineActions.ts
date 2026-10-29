'use server'

import * as api from '@/lib/api'
import { toStatusActionResult, type StatusActionResult } from '@/lib/actionResult'
import type { Chapter, LibraryPipelineResponse, PipelineBackup, PipelineItemState, PipelineItemStatus, PipelineProposal } from '@/types/api'

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

export async function runItemPipelineAction(libraryItemId: string): Promise<StatusActionResult<PipelineItemState>> {
  return toStatusActionResult(() => api.runItemPipeline(libraryItemId))
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

/** Restores the newest chapter backup (the server backs up the current chapters first). */
export async function undoPipelineChaptersAction(libraryItemId: string): Promise<StatusActionResult<{ restored: string }>> {
  const list = await toStatusActionResult(() => api.getPipelineBackups(libraryItemId))
  if (!list.ok) return list
  const backups: PipelineBackup[] = Array.isArray(list.data) ? list.data : (list.data?.backups ?? [])
  // Backup names carry an ISO timestamp, so the last one sorted by name is the newest
  const latest = [...backups].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.name.localeCompare(a.name))[0]
  if (!latest) return { ok: false, status: 404, error: '' }
  const restored = await toStatusActionResult(() => api.restorePipelineBackup(libraryItemId, latest.name))
  return restored.ok ? { ok: true, data: { restored: latest.name } } : restored
}
