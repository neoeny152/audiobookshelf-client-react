import { getExpandedLibraryItemAction } from '@/app/actions/mediaActions'
import type { SelectedMediaItem } from '@/lib/selectedMediaItem'
import type { LibraryItem, PodcastEpisode } from '@/types/api'
import { isPodcastMedia } from '@/types/api'

export interface SelectedPodcast {
  libraryItem: LibraryItem
  episodesById: Map<string, PodcastEpisode>
}

/**
 * Fetches each selected podcast once (expanded, so it carries its episodes) instead of
 * one request per selected episode. Requests run in selection order, one at a time.
 */
export async function fetchSelectedPodcasts(selectedItems: readonly SelectedMediaItem[]): Promise<Map<string, SelectedPodcast>> {
  const podcasts = new Map<string, SelectedPodcast>()

  for (const selected of selectedItems) {
    if (!selected.episodeId || podcasts.has(selected.libraryItemId)) continue

    const libraryItem = await getExpandedLibraryItemAction(selected.libraryItemId)
    const episodes = isPodcastMedia(libraryItem.media) ? (libraryItem.media.episodes ?? []) : []
    podcasts.set(selected.libraryItemId, {
      libraryItem,
      episodesById: new Map(episodes.map((episode) => [episode.id, episode]))
    })
  }

  return podcasts
}
