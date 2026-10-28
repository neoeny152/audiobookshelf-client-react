'use client'

import { nextSelectedItems, type ShelfSelectionIndex } from '@/lib/batchSelection/shelfSelectionIndex'
import { getSelectionKind, type SelectedMediaItem, type SelectionKind } from '@/lib/selectedMediaItem'
import { applyShiftClickSelection } from '@/lib/shiftClickSelection'
import type { LibraryItem, PodcastEpisode } from '@/types/api'
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'

export interface SelectItemOptions {
  shiftKey?: boolean
  index: number
  /** Keys and sources of the shelf the click came from (see getShelfSelectionIndex). */
  shelfIndex: ShelfSelectionIndex
  selectionKey: string
  libraryItem: LibraryItem
  episode?: PodcastEpisode
  isKeySelectable?: (key: string) => boolean
}

export interface BookshelfSelectionState {
  selectedItems: SelectedMediaItem[]
  selectedKeys: ReadonlySet<string>
  selectionKind: SelectionKind | null
  activeScopeId: string | null
}

export interface BookshelfSelectionActions {
  selectItem: (scopeId: string, options: SelectItemOptions) => void
  ensureSelectionAnchor: (selectionKey: string) => void
  clearSelection: () => void
  /** Drops every selected item whose key is not in `keys` (e.g. keep only the failed ones of a batch). */
  keepOnlySelected: (keys: ReadonlySet<string>) => void
}

interface BookshelfSelectionContextValue extends BookshelfSelectionState, BookshelfSelectionActions {
  isSelectionMode: boolean
  isSelected: (selectionKey: string) => boolean
  isScopeActive: (scopeId: string) => boolean
}

interface SelectionStore {
  getState: () => BookshelfSelectionState
  subscribe: (listener: () => void) => () => void
  actions: BookshelfSelectionActions
}

const EMPTY_STATE: BookshelfSelectionState = { selectedItems: [], selectedKeys: new Set(), selectionKind: null, activeScopeId: null }

/**
 * Selection lives in a small external store instead of React state. Cards subscribe with a selector
 * (`useBookshelfSelectionSelector`) and only re-render when their own boolean changes, and components that
 * only need the actions never re-render on a selection change: the context value itself never changes.
 */
function createSelectionStore(): SelectionStore {
  let state = EMPTY_STATE
  let anchorKey: string | null = null
  const listeners = new Set<() => void>()

  const setState = (next: BookshelfSelectionState) => {
    state = next
    listeners.forEach((listener) => listener())
  }

  const selectItem = (scopeId: string, options: SelectItemOptions) => {
    if (state.activeScopeId !== null && state.activeScopeId !== scopeId) {
      return
    }

    const { shiftKey = false, index, shelfIndex, selectionKey, libraryItem, episode, isKeySelectable } = options

    if (anchorKey && shelfIndex.indexOfKey(anchorKey) < 0) {
      anchorKey = null
    }

    const prev = state.selectedItems
    const selectClicked = !state.selectedKeys.has(selectionKey)

    const result = applyShiftClickSelection({
      prevSelected: new Set(state.selectedKeys),
      clickedKey: selectionKey,
      clickedIndex: index,
      shiftKey,
      anchorKey,
      orderedKeys: shelfIndex.keys,
      indexOfKey: shelfIndex.indexOfKey,
      selectClicked,
      isKeySelectable
    })

    anchorKey = result.anchorKey
    const next = nextSelectedItems(prev, result.nextSelected, shelfIndex)

    if (next.length === 0) {
      setState(EMPTY_STATE)
      return
    }

    setState({
      selectedItems: next,
      selectedKeys: new Set(next.map((item) => item.selectionKey)),
      selectionKind: prev.length === 0 ? getSelectionKind(libraryItem, episode) : state.selectionKind,
      activeScopeId: scopeId
    })
  }

  const actions: BookshelfSelectionActions = {
    selectItem,
    ensureSelectionAnchor: (selectionKey) => {
      if (anchorKey === null) {
        anchorKey = selectionKey
      }
    },
    clearSelection: () => {
      anchorKey = null
      if (state !== EMPTY_STATE) setState(EMPTY_STATE)
    },
    keepOnlySelected: (keys) => {
      const next = state.selectedItems.filter((item) => keys.has(item.selectionKey))
      if (next.length === state.selectedItems.length) return
      if (next.length === 0) {
        anchorKey = null
        setState(EMPTY_STATE)
        return
      }
      if (anchorKey !== null && !keys.has(anchorKey)) anchorKey = null
      setState({ ...state, selectedItems: next, selectedKeys: new Set(next.map((item) => item.selectionKey)) })
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    actions
  }
}

const NOOP_STORE: SelectionStore = {
  getState: () => EMPTY_STATE,
  subscribe: () => () => {},
  actions: { selectItem: () => {}, ensureSelectionAnchor: () => {}, clearSelection: () => {}, keepOnlySelected: () => {} }
}

const BookshelfSelectionContext = createContext<SelectionStore | null>(null)

export function BookshelfSelectionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSelectionStore)
  return <BookshelfSelectionContext.Provider value={store}>{children}</BookshelfSelectionContext.Provider>
}

function useSelectionStore(): SelectionStore {
  const store = useContext(BookshelfSelectionContext)
  if (!store) {
    throw new Error('useBookshelfSelection must be used within BookshelfSelectionProvider')
  }
  return store
}

/**
 * Subscribe to one derived value of the selection. The component re-renders only when the selector result
 * changes (Object.is), so return primitives or slices of the state, never fresh objects.
 */
export function useBookshelfSelectionSelector<T>(selector: (state: BookshelfSelectionState) => T): T {
  const store = useSelectionStore()
  const getSnapshot = () => selector(store.getState())
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/** Whether anything is selected; for toolbars and layouts that only switch modes. */
export function useIsBookshelfSelectionMode(): boolean {
  return useBookshelfSelectionSelector((state) => state.selectedItems.length > 0)
}

/** Like useIsBookshelfSelectionMode, but false outside the library layout. */
export function useIsBookshelfSelectionModeOptional(): boolean {
  const store = useContext(BookshelfSelectionContext) ?? NOOP_STORE
  const getSnapshot = () => store.getState().selectedItems.length > 0
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/** Stable actions; using them never re-renders on a selection change. */
export function useBookshelfSelectionActions(): BookshelfSelectionActions {
  return useSelectionStore().actions
}

/** Safe optional actions for components that may render outside the library layout. */
export function useBookshelfSelectionActionsOptional(): BookshelfSelectionActions | null {
  return useContext(BookshelfSelectionContext)?.actions ?? null
}

function useFullSelection(store: SelectionStore): BookshelfSelectionContextValue {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const { selectedItems, selectedKeys, activeScopeId } = state

  const isSelected = useCallback((selectionKey: string) => selectedKeys.has(selectionKey), [selectedKeys])
  const isScopeActive = useCallback((scopeId: string) => activeScopeId === scopeId, [activeScopeId])

  return useMemo(
    () => ({ ...state, ...store.actions, isSelectionMode: selectedItems.length > 0, isSelected, isScopeActive }),
    [isScopeActive, isSelected, selectedItems.length, state, store.actions]
  )
}

/** The whole selection; re-renders on every selection change. Prefer the selector hooks in per-card code. */
export function useBookshelfSelection(): BookshelfSelectionContextValue {
  return useFullSelection(useSelectionStore())
}

/** Safe optional hook for components that may render outside library layout. */
export function useBookshelfSelectionOptional(): BookshelfSelectionContextValue | null {
  const store = useContext(BookshelfSelectionContext)
  const selection = useFullSelection(store ?? NOOP_STORE)
  return store ? selection : null
}
