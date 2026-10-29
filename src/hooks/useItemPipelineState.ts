'use client'

import { getItemPipelineAction } from '@/app/actions/pipelineActions'
import { useSocketEvent } from '@/contexts/SocketContext'
import { callStatusAction } from '@/lib/actionResult'
import { getDismissedPipelineItemId, toPipelineItemState } from '@/lib/autoPipeline'
import type { PipelineItemState } from '@/types/api'
import { useCallback, useEffect, useState } from 'react'

/**
 * The auto pipeline's state for one book, kept current by `pipeline_item_updated`. Null while unknown, when the
 * pipeline never saw the book (404) or when `enabled` is false (feature missing, or the viewer cannot update).
 */
export function useItemPipelineState(libraryItemId: string, enabled: boolean): PipelineItemState | null {
  const [state, setState] = useState<PipelineItemState | null>(null)

  useEffect(() => {
    setState(null)
    if (!enabled) return
    let active = true
    void callStatusAction(() => getItemPipelineAction(libraryItemId)).then((result) => {
      if (!active || !result.ok) return
      const next = toPipelineItemState(result.data)
      if (next?.libraryItemId === libraryItemId) setState(next)
    })
    return () => {
      active = false
    }
  }, [enabled, libraryItemId])

  const handleUpdate = useCallback(
    (data: unknown) => {
      if (!enabled) return
      if (getDismissedPipelineItemId(data) === libraryItemId) {
        setState(null)
        return
      }
      const next = toPipelineItemState(data)
      if (next?.libraryItemId === libraryItemId) setState(next)
    },
    [enabled, libraryItemId]
  )
  useSocketEvent<unknown>('pipeline_item_updated', handleUpdate)

  return state
}
