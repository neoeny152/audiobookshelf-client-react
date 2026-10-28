import { batchDeleteLibraryItemsAction, batchEmbedMetadataAction, batchScanLibraryItemsAction } from '@/app/actions/batchActions'
import { batchDeletePodcastEpisodesAction, batchUpdateMediaFinishedAction, deleteLibraryItemMediaEpisodeAction } from '@/app/actions/mediaActions'
import { runEpisodeRequests, type EpisodeBatchOutcome, type EpisodeBatchRunOptions, type EpisodeRef } from '@/lib/batchSelection/episodeBatch'
import { fetchSelectedPodcasts } from '@/lib/batchSelection/selectionEpisodes'
import type { ActionResult } from '@/lib/actionResult'
import { downloadLibraryItemFile, downloadLibraryItems } from '@/lib/download'
import type { SelectedMediaItem } from '@/lib/selectedMediaItem'

/** Throws with the server's message so batch callers keep their try/catch flow. */
function throwIfFailed(result: ActionResult<unknown>) {
  if (!result.ok) throw new Error(result.error)
}

export async function toggleFinishedSelection(selectedItems: readonly SelectedMediaItem[], allFinished: boolean) {
  const result = await batchUpdateMediaFinishedAction(
    selectedItems.map((item) => ({
      libraryItemId: item.libraryItemId,
      episodeId: item.episodeId,
      isFinished: !allFinished
    }))
  )
  throwIfFailed(result)
}

export async function deleteLibraryItemsSelection(uniqueLibraryItemIds: string[], hardDelete: boolean) {
  await batchDeleteLibraryItemsAction(uniqueLibraryItemIds, hardDelete)
}

export function selectedEpisodeRefs(selectedItems: readonly SelectedMediaItem[]): EpisodeRef[] {
  return selectedItems.flatMap((item) => (item.episodeId ? [{ libraryItemId: item.libraryItemId, episodeId: item.episodeId }] : []))
}

/** Removes the selected episodes (see runEpisodeRequests); failures are counted, not thrown. */
export async function deleteEpisodesSelection(
  selectedItems: readonly SelectedMediaItem[],
  hardDelete: boolean,
  options: EpisodeBatchRunOptions = {}
): Promise<EpisodeBatchOutcome> {
  return runEpisodeRequests(
    selectedEpisodeRefs(selectedItems),
    {
      one: ({ libraryItemId, episodeId }) => deleteLibraryItemMediaEpisodeAction(libraryItemId, episodeId, hardDelete),
      many: (entries) => batchDeletePodcastEpisodesAction([...entries], hardDelete)
    },
    options
  )
}

export async function downloadEpisodesSelection(selectedItems: readonly SelectedMediaItem[]) {
  const podcasts = await fetchSelectedPodcasts(selectedItems)
  for (const item of selectedItems) {
    if (!item.episodeId) continue
    const episode = podcasts.get(item.libraryItemId)?.episodesById.get(item.episodeId)
    if (!episode?.audioFile) continue
    downloadLibraryItemFile(item.libraryItemId, episode.audioFile.ino, episode.audioFile.metadata?.filename)
  }
}

export function downloadLibraryItemsSelection(libraryId: string, uniqueLibraryItemIds: string[], usePost = false) {
  downloadLibraryItems(libraryId, uniqueLibraryItemIds, { usePost })
}

export async function rescanLibraryItemsSelection(uniqueLibraryItemIds: string[]) {
  await batchScanLibraryItemsAction(uniqueLibraryItemIds)
}

export async function embedMetadataSelection(uniqueLibraryItemIds: string[]) {
  await batchEmbedMetadataAction(uniqueLibraryItemIds)
}
