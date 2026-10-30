'use client'

import { getLibraryNeedsWorkAction } from '@/app/actions/pipelineActions'
import { useSeekIndexEnabled } from '@/components/widgets/seek-index/SeekIndexWarning'
import { useLibrary } from '@/contexts/LibraryContext'
import { useSocketEvent } from '@/contexts/SocketContext'
import { useGuidancePreference } from '@/hooks/useGuidancePreference'
import { callStatusAction } from '@/lib/actionResult'
import { obj } from '@/lib/autoPipeline'
import type { NeedsWorkItem } from '@/types/api'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** The list is read again once changes stop for this long (a scan or a pipeline run sends many)... */
const RELOAD_QUIET_MS = 5000
/** ...or this long after the first of them, so a long scan still shows its progress */
const RELOAD_MAX_WAIT_MS = 30000

export interface NeedsWork {
  /** By title */
  items: NeedsWorkItem[]
  byId: ReadonlyMap<string, NeedsWorkItem>
}

const EMPTY: NeedsWork = { items: [], byId: new Map() }

const NeedsWorkContext = createContext<NeedsWork>(EMPTY)

/**
 * The library's books that need work (fork only, same gating as the item page's guided fix hint), read once per
 * library and again shortly after its books or their pipeline states change. Empty for other users, other libraries,
 * on a stock server and when guidance is turned off.
 */
export function NeedsWorkProvider({ children }: { children: ReactNode }) {
  const { library } = useLibrary()
  const guidanceOff = useGuidancePreference() === 'off'
  const enabled = useSeekIndexEnabled() && library.mediaType === 'book' && !guidanceOff
  const [items, setItems] = useState<NeedsWorkItem[]>([])
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** When the first change not read yet arrived */
  const pendingSinceRef = useRef<number | null>(null)
  /** Bumped when the library or the gating changes, so a late answer for the previous one is dropped */
  const generationRef = useRef(0)

  const load = useCallback(() => {
    const generation = generationRef.current
    void callStatusAction(() => getLibraryNeedsWorkAction(library.id)).then((result) => {
      if (result.ok && generation === generationRef.current) setItems(result.data)
    })
  }, [library.id])

  useEffect(() => {
    generationRef.current++
    setItems([])
    if (!enabled) return
    load()
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = null
      pendingSinceRef.current = null
    }
  }, [enabled, load])

  const handleChange = useCallback(
    (data: unknown) => {
      const changed = Array.isArray(data) ? data : [data]
      if (!enabled || !changed.some((entry) => obj(entry)?.libraryId === library.id)) return
      const now = Date.now()
      pendingSinceRef.current ??= now
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current)
      reloadTimerRef.current = setTimeout(
        () => {
          reloadTimerRef.current = null
          pendingSinceRef.current = null
          load()
        },
        Math.min(RELOAD_QUIET_MS, pendingSinceRef.current + RELOAD_MAX_WAIT_MS - now)
      )
    },
    [enabled, library.id, load]
  )
  useSocketEvent<unknown>('item_added', handleChange)
  useSocketEvent<unknown>('items_added', handleChange)
  useSocketEvent<unknown>('item_updated', handleChange)
  useSocketEvent<unknown>('items_updated', handleChange)
  useSocketEvent<unknown>('item_removed', handleChange)
  useSocketEvent<unknown>('pipeline_item_updated', handleChange)

  const value = useMemo<NeedsWork>(() => ({ items, byId: new Map(items.map((item) => [item.libraryItemId, item])) }), [items])
  return <NeedsWorkContext.Provider value={value}>{children}</NeedsWorkContext.Provider>
}

export function useNeedsWork(): NeedsWork {
  return useContext(NeedsWorkContext)
}
