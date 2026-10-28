'use server'

import { ActionResult, toActionResult } from '@/lib/actionResult'
import * as api from '@/lib/api'
import { GetFilesystemPathsResponse, Library, SaveLibraryOrderApiResponse } from '@/types/api'
import { revalidatePath } from 'next/cache'

export async function createLibrary(newLibrary: Library): Promise<ActionResult<Library>> {
  const result = await toActionResult(() => api.createLibrary(newLibrary))
  if (result.ok) {
    revalidatePath('/settings/libraries')
    revalidatePath('/library')
  }
  return result
}

export async function editLibrary(libraryId: string, updatedLibrary: Library): Promise<ActionResult<Library>> {
  const result = await toActionResult(() => api.updateLibrary(libraryId, updatedLibrary))
  if (result.ok) {
    revalidatePath('/settings/libraries')
  }
  return result
}

export async function deleteLibrary(libraryId: string): Promise<ActionResult<Library>> {
  const result = await toActionResult(() => api.deleteLibrary(libraryId))
  if (result.ok) {
    revalidatePath('/settings/libraries')
    revalidatePath('/settings/general', 'layout')
    revalidatePath('/library')
  }
  return result
}

export async function saveLibraryOrder(reorderObjects: { id: string; newOrder: number }[]): Promise<ActionResult<SaveLibraryOrderApiResponse>> {
  return toActionResult(() => api.saveLibraryOrder(reorderObjects))
}

export async function requestScanLibrary(libraryId: string): Promise<ActionResult> {
  return toActionResult(() => api.scanLibrary(libraryId))
}

export async function matchAll(libraryId: string): Promise<ActionResult> {
  return toActionResult(() => api.matchAll(libraryId))
}

export async function getFilesystemPaths(path: string, level: number): Promise<GetFilesystemPathsResponse> {
  return api.getFilesystemPaths(path, level)
}
