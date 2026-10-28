'use server'

import { ActionResult, toActionResult } from '@/lib/actionResult'
import * as api from '@/lib/api'
import {
  isPodcastMedia,
  RssPodcastEpisode,
  UpdateLibraryItemMediaPayload,
  UpdatePodcastEpisodePayload,
  type BatchUpdateLibraryItemPayload,
  type PodcastEpisode
} from '@/types/api'
import { revalidatePath } from 'next/cache'

function revalidateSeriesPage(libraryId: string, seriesId: string) {
  revalidatePath(`/library/${libraryId}/series/${seriesId}`)
}

export async function toggleFinishedAction(libraryItemId: string, params: { isFinished: boolean; episodeId?: string }) {
  return toActionResult(() => api.updateMediaFinished(libraryItemId, params))
}

export async function deleteMediaProgressAction(progressId: string) {
  return toActionResult(() => api.deleteMediaProgress(progressId))
}

export async function batchUpdateMediaFinishedAction(payload: { libraryItemId: string; episodeId?: string; isFinished: boolean }[]) {
  return toActionResult(() => api.batchUpdateMediaFinished(payload))
}

export async function markSeriesFinishedAction(
  libraryId: string,
  seriesId: string,
  payload: { libraryItemId: string; isFinished: boolean }[]
): Promise<ActionResult> {
  const result = await toActionResult(() => api.batchUpdateMediaFinished(payload))
  if (!result.ok) return result
  revalidateSeriesPage(libraryId, seriesId)
  return { ok: true, data: undefined }
}

export async function updateLibraryItemMediaAction(libraryItemId: string, payload: UpdateLibraryItemMediaPayload) {
  return toActionResult(() => api.updateLibraryItemMedia(libraryItemId, payload))
}

export async function batchGetLibraryItemsAction(libraryItemIds: string[]) {
  return api.batchGetLibraryItems(libraryItemIds)
}

export interface SelectedEpisodeEntry {
  libraryItemId: string
  podcastTitle: string
  episode: PodcastEpisode
}

/**
 * The selected episodes for episode-mode batch edit, in selection order. Expands each podcast on the
 * server and sends back only the selected episodes, not every episode of every podcast.
 * `missing` counts selections whose podcast or episode no longer exists.
 */
export async function batchGetSelectedEpisodesAction(
  selections: { libraryItemId: string; episodeId: string }[]
): Promise<{ entries: SelectedEpisodeEntry[]; missing: number }> {
  const libraryItemIds = [...new Set(selections.map((selection) => selection.libraryItemId))]
  const response = await api.batchGetLibraryItems(libraryItemIds)
  const episodesByPodcast = new Map<string, { podcastTitle: string; episodes: Map<string, PodcastEpisode> }>()
  for (const libraryItem of response.libraryItems) {
    if (!isPodcastMedia(libraryItem.media)) continue
    episodesByPodcast.set(libraryItem.id, {
      podcastTitle: libraryItem.media.metadata.title || libraryItem.id,
      episodes: new Map((libraryItem.media.episodes ?? []).map((episode) => [episode.id, episode]))
    })
  }

  const entries: SelectedEpisodeEntry[] = []
  let missing = 0
  for (const { libraryItemId, episodeId } of selections) {
    const podcast = episodesByPodcast.get(libraryItemId)
    const episode = podcast?.episodes.get(episodeId)
    if (!podcast || !episode) {
      missing++
      continue
    }
    entries.push({ libraryItemId, podcastTitle: podcast.podcastTitle, episode })
  }
  return { entries, missing }
}

export async function batchUpdateLibraryItemsAction(payload: BatchUpdateLibraryItemPayload[]) {
  return toActionResult(() => api.batchUpdateLibraryItems(payload))
}

export async function rescanLibraryItemAction(libraryItemId: string) {
  return toActionResult(() => api.rescanLibraryItem(libraryItemId))
}

export async function sendEbookToDeviceAction(payload: { libraryItemId: string; deviceName: string }) {
  return toActionResult(() => api.sendEbookToDevice(payload))
}

export async function removeSeriesFromContinueListeningAction(seriesId: string) {
  return toActionResult(() => api.removeSeriesFromContinueListening(seriesId))
}

export async function readdSeriesToContinueListeningAction(seriesId: string) {
  return toActionResult(() => api.readdSeriesToContinueListening(seriesId))
}

export async function removeFromContinueListeningAction(progressId: string) {
  return toActionResult(() => api.removeFromContinueListening(progressId))
}

/** Callers only need success: the server's deleted item JSON is not sent back to the browser. */
export async function deleteLibraryItemAction(libraryItemId: string, hardDelete: boolean): Promise<ActionResult> {
  return toActionResult(async () => {
    await api.deleteLibraryItem(libraryItemId, hardDelete)
  })
}

export async function getExpandedLibraryItemAction(libraryItemId: string) {
  return api.getLibraryItem(libraryItemId, true)
}

/** Callers only need success: the server answers with the whole podcast, which is not sent back to the browser. */
export async function deleteLibraryItemMediaEpisodeAction(libraryItemId: string, episodeId: string, hardDelete = false): Promise<ActionResult> {
  return toActionResult(async () => {
    await api.deleteLibraryItemMediaEpisode(libraryItemId, episodeId, hardDelete)
  })
}

export async function fetchPodcastFeedAction(rssFeed: string) {
  return api.fetchPodcastFeed(rssFeed)
}

export async function downloadPodcastEpisodesAction(libraryItemId: string, episodes: RssPodcastEpisode[]) {
  return toActionResult(() => api.downloadPodcastEpisodes(libraryItemId, episodes))
}

export async function clearPodcastDownloadQueueAction(libraryItemId: string) {
  return toActionResult(() => api.clearPodcastDownloadQueue(libraryItemId))
}

export async function checkPodcastNewEpisodesAction(libraryItemId: string, limit: number) {
  return toActionResult(() => api.checkPodcastNewEpisodes(libraryItemId, limit))
}

export async function quickMatchPodcastEpisodesAction(libraryItemId: string) {
  return toActionResult(() => api.quickMatchPodcastEpisodes(libraryItemId))
}

export async function getPodcastEpisodeAction(libraryItemId: string, episodeId: string) {
  return api.getPodcastEpisode(libraryItemId, episodeId)
}

export async function updatePodcastEpisodeAction(libraryItemId: string, episodeId: string, payload: UpdatePodcastEpisodePayload) {
  return toActionResult(() => api.updatePodcastEpisode(libraryItemId, episodeId, payload))
}

/**
 * Like updatePodcastEpisodeAction, but for batch saves that do not need the result: the server answers
 * every update with the whole expanded podcast (all episodes), which is dropped here instead of being
 * sent to the browser once per episode.
 */
export async function updatePodcastEpisodeQuietAction(libraryItemId: string, episodeId: string, payload: UpdatePodcastEpisodePayload): Promise<ActionResult> {
  return toActionResult(async () => {
    await api.updatePodcastEpisode(libraryItemId, episodeId, payload)
  })
}

/**
 * Batch episode update (fork server only, check the `batchEpisodes` server feature first).
 * The response's expanded podcasts are dropped; resolves to the number of episodes that changed.
 */
export async function batchUpdatePodcastEpisodesAction(
  episodes: { libraryItemId: string; episodeId: string; updates: UpdatePodcastEpisodePayload }[]
): Promise<ActionResult<number>> {
  return toActionResult(async () => (await api.batchUpdatePodcastEpisodes(episodes)).numEpisodesUpdated)
}

/** Batch episode removal (fork server only, check the `batchEpisodes` server feature first). */
export async function batchDeletePodcastEpisodesAction(
  episodes: { libraryItemId: string; episodeId: string }[],
  hardDelete: boolean
): Promise<ActionResult<number>> {
  return toActionResult(async () => (await api.batchDeletePodcastEpisodes(episodes, hardDelete)).numEpisodesDeleted)
}

export async function searchPodcastEpisodeAction(libraryItemId: string, title: string) {
  return api.searchPodcastEpisode(libraryItemId, title)
}
