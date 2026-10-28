'use server'

import { ActionResult, toActionResult } from '@/lib/actionResult'
import * as api from '@/lib/api'
import { RssPodcastEpisode, UpdateLibraryItemMediaPayload, UpdatePodcastEpisodePayload, type BatchUpdateLibraryItemPayload } from '@/types/api'
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

export async function deleteLibraryItemAction(libraryItemId: string, hardDelete: boolean) {
  return toActionResult(() => api.deleteLibraryItem(libraryItemId, hardDelete))
}

export async function getExpandedLibraryItemAction(libraryItemId: string) {
  return api.getLibraryItem(libraryItemId, true)
}

export async function deleteLibraryItemMediaEpisodeAction(libraryItemId: string, episodeId: string, hardDelete = false) {
  return toActionResult(() => api.deleteLibraryItemMediaEpisode(libraryItemId, episodeId, hardDelete))
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

export async function searchPodcastEpisodeAction(libraryItemId: string, title: string) {
  return api.searchPodcastEpisode(libraryItemId, title)
}
