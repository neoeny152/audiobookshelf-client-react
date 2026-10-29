import type { PipelineItemState } from '@/types/api'

export const LIBRARY_ID = 'lib_1'

export function pipelineState(partial: Partial<PipelineItemState> = {}): PipelineItemState {
  return {
    libraryItemId: 'li_1',
    libraryId: LIBRARY_ID,
    title: 'Dungeon Crawler Carl',
    status: 'queued',
    step: null,
    reason: null,
    dryRun: false,
    queuedAt: 1,
    updatedAt: 1,
    attempts: 0,
    notBefore: null,
    match: null,
    chapters: null,
    epub: null,
    ...partial
  }
}
