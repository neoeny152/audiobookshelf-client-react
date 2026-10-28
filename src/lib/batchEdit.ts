import { batchUpdatePodcastEpisodesAction, updatePodcastEpisodeQuietAction } from '@/app/actions/mediaActions'
import { runEpisodeRequests, type EpisodeBatchOutcome, type EpisodeBatchRunOptions } from '@/lib/batchSelection/episodeBatch'
import type { SelectedMediaItem, SelectionKind } from '@/lib/selectedMediaItem'
import type { BookLibraryItem, BookMetadata, LibraryItem, PodcastLibraryItem, PodcastMetadata, UpdatePodcastEpisodePayload } from '@/types/api'

const BATCH_EDIT_SESSION_KEY = 'abs_batch_edit_session'

export interface BatchEditSession {
  libraryId: string
  selectionKind: SelectionKind
  items: readonly SelectedMediaItem[]
  returnPath: string
}

export function writeBatchEditSession(session: BatchEditSession): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(BATCH_EDIT_SESSION_KEY, JSON.stringify(session))
}

export function readBatchEditSession(): BatchEditSession | null {
  if (typeof window === 'undefined') return null
  const raw = sessionStorage.getItem(BATCH_EDIT_SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as BatchEditSession
    if (!parsed.libraryId || !parsed.selectionKind || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearBatchEditSession(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(BATCH_EDIT_SESSION_KEY)
}

/** Deep-clone a library item so batch edit forms are isolated from fetched data. */
export function cloneLibraryItemForBatchEdit(libraryItem: LibraryItem): LibraryItem {
  const copy = { ...libraryItem } as BookLibraryItem | PodcastLibraryItem
  copy.media = { ...libraryItem.media }
  if (copy.media.tags) {
    copy.media.tags = [...copy.media.tags]
  }
  copy.media.metadata = { ...copy.media.metadata }

  if (libraryItem.mediaType === 'book') {
    const metadata = copy.media.metadata as BookMetadata
    if (Array.isArray(metadata.authors)) {
      metadata.authors = metadata.authors.map((au) => ({ ...au }))
    }
    if (Array.isArray(metadata.series)) {
      metadata.series = metadata.series.map((se) => ({ ...se }))
    }
    if (Array.isArray(metadata.narrators)) {
      metadata.narrators = [...metadata.narrators]
    }
    if (Array.isArray(metadata.genres)) {
      metadata.genres = [...metadata.genres]
    }
  } else {
    const metadata = copy.media.metadata as PodcastMetadata
    if (Array.isArray(metadata.genres)) {
      metadata.genres = [...metadata.genres]
    }
  }

  if (libraryItem.mediaType === 'podcast' && 'episodes' in copy.media && Array.isArray(copy.media.episodes)) {
    copy.media.episodes = copy.media.episodes.map((ep) => ({ ...ep }))
  }

  return copy
}

export interface EpisodeBatchUpdate {
  libraryItemId: string
  episodeId: string
  payload: UpdatePodcastEpisodePayload
}

/** Above this many selected items, batch edit asks before opening (every item gets its own form). */
export const BATCH_EDIT_SOFT_LIMIT = 150

/** Save episode batch updates (see runEpisodeRequests for how they are sent). */
export async function saveEpisodeBatch(updates: readonly EpisodeBatchUpdate[], options: EpisodeBatchRunOptions = {}): Promise<EpisodeBatchOutcome<EpisodeBatchUpdate>> {
  return runEpisodeRequests(
    updates,
    {
      one: ({ libraryItemId, episodeId, payload }) => updatePodcastEpisodeQuietAction(libraryItemId, episodeId, payload),
      many: (entries) =>
        batchUpdatePodcastEpisodesAction(entries.map(({ libraryItemId, episodeId, payload }) => ({ libraryItemId, episodeId, updates: payload })))
    },
    options
  )
}
