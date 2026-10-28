import type { SelectedMediaItem } from '@/lib/selectedMediaItem'
import type { MediaProgress } from '@/types/api'

export interface SelectionProgressLookup {
  /** Keyed by `mediaItemId ?? episodeId`, used for episode selections */
  byEpisodeId: Map<string, MediaProgress>
  /** Keyed by `libraryItemId`, only progress without an episodeId (books) */
  byLibraryItemId: Map<string, MediaProgress>
}

/**
 * Indexes the progress list in one pass. The first match wins, the same as a linear `find`.
 */
export function buildSelectionProgressLookup(progressList: readonly MediaProgress[]): SelectionProgressLookup {
  const byEpisodeId = new Map<string, MediaProgress>()
  const byLibraryItemId = new Map<string, MediaProgress>()

  for (const progress of progressList) {
    const episodeKey = progress.mediaItemId ?? progress.episodeId
    if (episodeKey && !byEpisodeId.has(episodeKey)) {
      byEpisodeId.set(episodeKey, progress)
    }
    if (!progress.episodeId && !byLibraryItemId.has(progress.libraryItemId)) {
      byLibraryItemId.set(progress.libraryItemId, progress)
    }
  }

  return { byEpisodeId, byLibraryItemId }
}

export function findProgressForSelectedItem(item: SelectedMediaItem, lookup: SelectionProgressLookup): MediaProgress | undefined {
  if (item.episodeId) {
    return lookup.byEpisodeId.get(item.episodeId)
  }
  return lookup.byLibraryItemId.get(item.libraryItemId)
}

export function areAllSelectedItemsFinished(selectedItems: readonly SelectedMediaItem[], progressList: readonly MediaProgress[]): boolean {
  if (selectedItems.length === 0) return false
  const lookup = buildSelectionProgressLookup(progressList)
  return selectedItems.every((item) => Boolean(findProgressForSelectedItem(item, lookup)?.isFinished))
}
