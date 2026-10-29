'use client'

import { withBasePath } from '@/lib/basePath'
import { parseReadAlong, type ReadAlongMap } from '@/lib/ereader/readAlong'
import { useEffect, useState } from 'react'

/** none: no data for this EPUB (404) or the feature is off; error: unreadable or unsupported data. */
export type ReadAlongLoadStatus = 'idle' | 'loading' | 'none' | 'ready' | 'error'

export function readAlongUrl(libraryItemId: string, fileId: string): string {
  return withBasePath(`/internal-api/items/${encodeURIComponent(libraryItemId)}/ebook/${encodeURIComponent(fileId)}/readalong`)
}

/** Loads the read-along map once per open reader. Does nothing (status idle) unless enabled with a file id. */
export function useReadAlong(libraryItemId: string, fileId: string | undefined, enabled: boolean) {
  const [state, setState] = useState<{ key: string; map: ReadAlongMap | null; status: ReadAlongLoadStatus }>({ key: '', map: null, status: 'idle' })
  const key = enabled && fileId ? `${libraryItemId}/${fileId}` : ''

  useEffect(() => {
    if (!key || !fileId) return
    const controller = new AbortController()
    setState({ key, map: null, status: 'loading' })

    void (async () => {
      try {
        const response = await fetch(readAlongUrl(libraryItemId, fileId), {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        })
        if (response.status === 404) {
          setState({ key, map: null, status: 'none' })
          return
        }
        if (!response.ok) throw new Error(`Read-along request failed (${response.status})`)
        const map = parseReadAlong(await response.json())
        if (!map) console.warn('[ReadAlong] unsupported or invalid read-along data')
        setState({ key, map, status: map ? 'ready' : 'error' })
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('[ReadAlong] failed to load read-along data', error)
        setState({ key, map: null, status: 'error' })
      }
    })()

    return () => controller.abort()
  }, [fileId, key, libraryItemId])

  if (!key || state.key !== key) return { map: null, status: key ? ('loading' as const) : ('idle' as const) }
  return { map: state.map, status: state.status }
}
