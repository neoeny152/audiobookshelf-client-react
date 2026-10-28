import { getBookDuration } from '@/lib/book'
import { getEpisodeDuration } from '@/lib/episode'
import type { LibraryItem, Playlist, PlaylistItem } from '@/types/api'
import { isBookMedia } from '@/types/api'
import type { SortableBookshelfEntry } from '@/types/compilation'

export function getPlaylistItemKey(item: Pick<PlaylistItem, 'libraryItemId' | 'episodeId'>): string {
  return `${item.libraryItemId}:${item.episodeId ?? ''}`
}

export function toSortablePlaylistItems(items: PlaylistItem[]): SortableBookshelfEntry[] {
  return items.map((item) => ({
    sortableId: getPlaylistItemKey(item),
    libraryItem: item.libraryItem,
    episode: item.episode
  }))
}

export function getPlaylistItemDuration(item: PlaylistItem): number {
  if (item.episode) {
    return getEpisodeDuration(item.episode)
  }
  const media = item.libraryItem.media
  if (isBookMedia(media)) {
    return getBookDuration(media)
  }
  return 0
}

export function playlistItemsToPayload(items: PlaylistItem[]) {
  return items.map((i) => ({
    libraryItemId: i.libraryItemId,
    episodeId: i.episodeId ?? null
  }))
}

export function matchesPlaylistItem(item: Pick<PlaylistItem, 'libraryItemId' | 'episodeId'>, libraryItemId: string, episodeId?: string | null): boolean {
  return item.libraryItemId === libraryItemId && (item.episodeId ?? null) === (episodeId ?? null)
}

function withoutBookFiles(libraryItem: LibraryItem): LibraryItem {
  const media = libraryItem.media
  if (!isBookMedia(media)) return libraryItem
  return {
    ...libraryItem,
    libraryFiles: undefined,
    media: { ...media, audioFiles: undefined, tracks: undefined, chapters: undefined }
  } as LibraryItem
}

/**
 * A playlist as the add/remove-from-playlist modal needs it: membership (item and episode ids) and the
 * group cover. Book items come back fully expanded (audio files, tracks, chapters, library files), which
 * is dropped here before the batch add/remove result is sent to the browser.
 */
export function toPlaylistMembershipSummary(playlist: Playlist): Playlist {
  if (!playlist.items) return playlist
  return { ...playlist, items: playlist.items.map((item) => (item.episode ? item : { ...item, libraryItem: withoutBookFiles(item.libraryItem) })) }
}
