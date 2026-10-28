import { getSelectionKey, toSelectedMediaItem, type SelectedMediaItem, type SelectionKeySource } from '@/lib/selectedMediaItem'
import { isPlaylistItem, type ShelfNavigationEntity } from '@/lib/shelfNavigationEntity'
import type { LibraryItem } from '@/types/api'

/**
 * Selection lookup for one shelf, shared by every card on it.
 *
 * `keys` is aligned with the shelf's entity array: `keys[i]` is the selection key of the entity at
 * position `i`, or null when that slot cannot be selected (a page that is not loaded yet, a collapsed
 * series, or an entity that is not a library item). Card indexes can therefore be used directly, and
 * a shift-click range that crosses unloaded pages selects only the loaded items in it.
 */
export interface ShelfSelectionIndex {
  keys: readonly (string | null)[]
  indexOfKey: (key: string) => number
  sourceOfKey: (key: string) => SelectionKeySource | undefined
}

type ShelfEntities = readonly (ShelfNavigationEntity | null | undefined)[]

function entitySelectionSource(entity: ShelfNavigationEntity | null | undefined, selectEpisodes: boolean): SelectionKeySource | null {
  if (!entity) return null
  if (isPlaylistItem(entity)) {
    return entity.episode ? { libraryItem: entity.libraryItem, episode: entity.episode } : { libraryItem: entity.libraryItem }
  }
  if (!('mediaType' in entity)) return null
  const libraryItem = entity as LibraryItem
  if (libraryItem.collapsedSeries) return null
  if (selectEpisodes) {
    return libraryItem.recentEpisode ? { libraryItem, episode: libraryItem.recentEpisode } : null
  }
  return { libraryItem }
}

function buildShelfSelectionIndex(entities: ShelfEntities, selectEpisodes: boolean): ShelfSelectionIndex {
  const keys: (string | null)[] = new Array(entities.length).fill(null)
  const positions = new Map<string, number>()
  const sources = new Map<string, SelectionKeySource>()

  // Index loop (not forEach/for-of) so holes in a sparse page array stay null slots
  for (let i = 0; i < entities.length; i++) {
    const source = entitySelectionSource(entities[i], selectEpisodes)
    if (!source) continue
    const key = getSelectionKey({ libraryItemId: source.libraryItem.id, episodeId: source.episode?.id })
    keys[i] = key
    if (!positions.has(key)) positions.set(key, i)
    sources.set(key, source)
  }

  return {
    keys,
    indexOfKey: (key) => positions.get(key) ?? -1,
    sourceOfKey: (key) => sources.get(key)
  }
}

const EMPTY_INDEX: ShelfSelectionIndex = { keys: [], indexOfKey: () => -1, sourceOfKey: () => undefined }

const cache: Record<'items' | 'episodes', WeakMap<ShelfEntities, ShelfSelectionIndex>> = {
  items: new WeakMap(),
  episodes: new WeakMap()
}

/**
 * The selection index for a shelf's entity array, built once per array (every card on the shelf gets
 * the same instance). Shelves replace their array when a page loads, which builds a fresh index.
 */
export function getShelfSelectionIndex(entities: ShelfEntities | undefined, selectEpisodes = false): ShelfSelectionIndex {
  if (!entities) return EMPTY_INDEX
  const store = cache[selectEpisodes ? 'episodes' : 'items']
  let index = store.get(entities)
  if (!index) {
    index = buildShelfSelectionIndex(entities, selectEpisodes)
    // An episode shelf where no entity has an episode falls back to library item keys
    if (selectEpisodes && index.keys.every((key) => key === null)) {
      index = buildShelfSelectionIndex(entities, false)
    }
    store.set(entities, index)
  }
  return index
}

/**
 * Next selected items after a click: keeps the existing entries (and their order) that are still selected,
 * then appends newly selected keys in shelf order. Only new keys are converted, so the cost is the size
 * of the selection plus the change, not the size of the shelf.
 */
export function nextSelectedItems(prev: readonly SelectedMediaItem[], nextKeys: ReadonlySet<string>, shelfIndex: ShelfSelectionIndex): SelectedMediaItem[] {
  const next: SelectedMediaItem[] = []
  const kept = new Set<string>()
  for (const item of prev) {
    if (nextKeys.has(item.selectionKey)) {
      next.push(item)
      kept.add(item.selectionKey)
    }
  }
  for (const key of nextKeys) {
    if (kept.has(key)) continue
    const source = shelfIndex.sourceOfKey(key)
    if (source) next.push(toSelectedMediaItem(source.libraryItem, source.episode))
  }
  return next
}
