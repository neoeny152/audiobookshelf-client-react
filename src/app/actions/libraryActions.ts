'use server'

import { toActionResult, type ActionResult } from '@/lib/actionResult'
import {
  checkLibraryDuplicates,
  getLibraryAuthors,
  getLibraryDuplicates,
  getLibraryCollections,
  getLibraryFilterData,
  getLibraryItems,
  getLibraryPersonalized,
  getLibraryPlaylists,
  getLibrarySeries,
  getRecentEpisodes,
  removeLibraryItemsWithIssues,
  updateDuplicateGroup
} from '@/lib/api'
import { RECENT_EPISODES_PAGE_SIZE } from '@/lib/recentEpisodes'
import type { LibraryDuplicatesResponse, UpdateDuplicateGroupResponse } from '@/types/api'

export async function fetchLibraryItemsAction(libraryId: string, query: string) {
  return getLibraryItems(libraryId, query)
}

export async function fetchLibraryFilterDataAction(libraryId: string) {
  return getLibraryFilterData(libraryId)
}

export async function fetchLibraryPersonalizedAction(libraryId: string) {
  return getLibraryPersonalized(libraryId)
}

export async function fetchSeriesAction(libraryId: string, query: string) {
  return getLibrarySeries(libraryId, query)
}

export async function fetchAuthorsAction(libraryId: string, query: string) {
  return getLibraryAuthors(libraryId, query)
}

export async function fetchCollectionsAction(libraryId: string, query: string) {
  return getLibraryCollections(libraryId, query)
}

export async function fetchPlaylistsAction(libraryId: string, query: string) {
  return getLibraryPlaylists(libraryId, query)
}

export async function fetchRecentEpisodesAction(libraryId: string, page: number) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid recent episodes page')
  return getRecentEpisodes(libraryId, RECENT_EPISODES_PAGE_SIZE, page)
}

export async function removeLibraryItemsWithIssuesAction(libraryId: string) {
  return removeLibraryItemsWithIssues(libraryId)
}

/** Possible duplicate items (server feature duplicateItems, admin only) */
export async function getLibraryDuplicatesAction(libraryId: string, includeDismissed: boolean): Promise<ActionResult<LibraryDuplicatesResponse>> {
  return toActionResult(() => getLibraryDuplicates(libraryId, includeDismissed))
}

export async function checkLibraryDuplicatesAction(libraryId: string, includeDismissed: boolean): Promise<ActionResult<LibraryDuplicatesResponse>> {
  return toActionResult(() => checkLibraryDuplicates(libraryId, includeDismissed))
}

export async function updateDuplicateGroupAction(libraryId: string, groupId: string, dismissed: boolean): Promise<ActionResult<UpdateDuplicateGroupResponse>> {
  return toActionResult(() => updateDuplicateGroup(libraryId, groupId, dismissed))
}
