'use client'

import { useBookshelfSelection } from '@/contexts/BookshelfSelectionContext'
import { getShelfSelectionIndex } from '@/lib/batchSelection/shelfSelectionIndex'
import { getSelectionKey } from '@/lib/selectedMediaItem'
import type { ShelfNavigationEntity } from '@/lib/shelfNavigationEntity'
import type { LibraryItem, PodcastEpisode } from '@/types/api'
import { useCallback, useMemo, type MouseEvent } from 'react'

export interface UseBookshelfCardSelectionOptions {
  scopeId: string
  enabled?: boolean
  isSelectable?: boolean
  /** When true, shelf entities use episode keys (homepage episode shelves). */
  selectEpisodes?: boolean
}

export function useBookshelfCardSelection(
  libraryItem: LibraryItem,
  entityIndex: number | undefined,
  shelfEntities: readonly (ShelfNavigationEntity | null)[] | undefined,
  episode: PodcastEpisode | undefined,
  options: UseBookshelfCardSelectionOptions
) {
  const { scopeId, enabled = true, isSelectable = true, selectEpisodes = false } = options
  const { isSelectionMode, isSelected, isScopeActive, selectItem } = useBookshelfSelection()

  // Built once per shelf array and shared by every card on the shelf
  const shelfIndex = getShelfSelectionIndex(shelfEntities, selectEpisodes)

  const selectionKey = useMemo(() => getSelectionKey({ libraryItemId: libraryItem.id, episodeId: episode?.id }), [libraryItem.id, episode?.id])

  const scopeActive = isScopeActive(scopeId)
  const effectiveSelectionMode = isSelectionMode && scopeActive
  const selected = isSelected(selectionKey)

  const onSelect = useCallback(
    (event: MouseEvent) => {
      if (!enabled || !isSelectable) return

      const index = entityIndex != null && shelfIndex.keys[entityIndex] === selectionKey ? entityIndex : shelfIndex.indexOfKey(selectionKey)
      if (index < 0) return

      selectItem(scopeId, {
        shiftKey: event.shiftKey,
        index,
        shelfIndex,
        selectionKey,
        libraryItem,
        episode
      })
    },
    [enabled, isSelectable, entityIndex, shelfIndex, selectionKey, selectItem, scopeId, libraryItem, episode]
  )

  if (!enabled || !isSelectable) {
    return {
      isSelectionMode: false,
      selected: false,
      onSelect: undefined,
      selectionKey
    }
  }

  return {
    isSelectionMode: effectiveSelectionMode,
    selected,
    onSelect,
    selectionKey
  }
}
