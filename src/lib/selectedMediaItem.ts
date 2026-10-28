import { isPlayableBook } from '@/lib/book'
import { isPlayableEpisode } from '@/lib/episode'
import type { LibraryItem, PodcastEpisode } from '@/types/api'

export type SelectionKind = 'book' | 'podcast' | 'episode'

export interface SelectedMediaItem {
  selectionKey: string
  libraryItemId: string
  episodeId?: string
  hasTracks: boolean
  title?: string
  downloadSize?: number
}

export function getSelectionKind(libraryItem: LibraryItem, episode?: PodcastEpisode): SelectionKind {
  if (episode) return 'episode'
  if (libraryItem.mediaType === 'podcast') return 'podcast'
  return 'book'
}

export function getSelectionCountMessageKey(kind: SelectionKind): 'MessageBooksSelected' | 'MessagePodcastsSelected' | 'MessageEpisodesSelected' {
  switch (kind) {
    case 'podcast':
      return 'MessagePodcastsSelected'
    case 'episode':
      return 'MessageEpisodesSelected'
    default:
      return 'MessageBooksSelected'
  }
}

export function libraryItemSelectionKey(libraryItemId: string): string {
  return `li:${libraryItemId}`
}

export function episodeSelectionKey(episodeId: string): string {
  return `ep:${episodeId}`
}

export function getSelectionKey(params: { libraryItemId: string; episodeId?: string }): string {
  if (params.episodeId) return episodeSelectionKey(params.episodeId)
  return libraryItemSelectionKey(params.libraryItemId)
}

function isPlayableLibraryItem(libraryItem: LibraryItem): boolean {
  if (libraryItem.mediaType === 'podcast') return true
  return isPlayableBook(libraryItem)
}

export function libraryItemToSelectedMediaItem(item: LibraryItem): SelectedMediaItem {
  return {
    selectionKey: libraryItemSelectionKey(item.id),
    libraryItemId: item.id,
    hasTracks: isPlayableLibraryItem(item),
    title: item.media.metadata.title ?? '',
    downloadSize: item.size ?? item.media.size ?? 0
  }
}

export function episodeToSelectedMediaItem(libraryItem: LibraryItem, episode: PodcastEpisode): SelectedMediaItem {
  return {
    selectionKey: episodeSelectionKey(episode.id),
    libraryItemId: libraryItem.id,
    episodeId: episode.id,
    hasTracks: isPlayableEpisode(libraryItem, episode)
  }
}

export function toSelectedMediaItem(libraryItem: LibraryItem, episode?: PodcastEpisode): SelectedMediaItem {
  if (episode) return episodeToSelectedMediaItem(libraryItem, episode)
  return libraryItemToSelectedMediaItem(libraryItem)
}

export interface SelectionKeySource {
  libraryItem: LibraryItem
  episode?: PodcastEpisode
}

export function getUniqueLibraryItemIds(selectedItems: readonly SelectedMediaItem[]): string[] {
  return [...new Set(selectedItems.map((item) => item.libraryItemId))]
}
