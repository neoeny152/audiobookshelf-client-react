'use client'

import { dismissItemPipelineAction, getLibraryPipelineAction, runItemPipelineAction, updateLibraryAutoPipelineAction } from '@/app/actions/pipelineActions'
import { useSocketEvent } from '@/contexts/SocketContext'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { callStatusAction, type StatusActionResult } from '@/lib/actionResult'
import { getDismissedPipelineItemId, toPipelineItemState, toPipelineItemStates, upsertPipelineItem } from '@/lib/autoPipeline'
import type { PipelineItemState } from '@/types/api'
import { useCallback, useEffect, useState } from 'react'

/**
 * The library's books the pipeline stopped for review, kept current by `pipeline_item_updated`, with the "Needs your
 * OK" actions: repair the MP3s and go on, or take the book off the pipeline for now.
 */
export function useNeedsRepairItems(libraryId: string, enabled: boolean) {
  const t = useTypeSafeTranslations()
  const { showToast } = useGlobalToast()
  const [items, setItems] = useState<PipelineItemState[]>([])
  const [busyItemIds, setBusyItemIds] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    setItems([])
    if (!enabled) return
    let active = true
    void callStatusAction(() => getLibraryPipelineAction(libraryId, 'needs-review')).then((result) => {
      if (active && result.ok) setItems(toPipelineItemStates(result.data.items))
    })
    return () => {
      active = false
    }
  }, [enabled, libraryId])

  const handleItemUpdated = useCallback(
    (data: unknown) => {
      if (!enabled) return
      const dismissed = getDismissedPipelineItemId(data)
      if (dismissed) {
        setItems((prev) => prev.filter((item) => item.libraryItemId !== dismissed))
        return
      }
      const next = toPipelineItemState(data)
      if (next) setItems((prev) => upsertPipelineItem(prev, next, libraryId))
    },
    [enabled, libraryId]
  )
  useSocketEvent<unknown>('pipeline_item_updated', handleItemUpdated)

  const runItemAction = useCallback(
    async (item: PipelineItemState, request: () => Promise<StatusActionResult<unknown>>) => {
      setBusyItemIds((prev) => new Set(prev).add(item.libraryItemId))
      const result = await callStatusAction(request)
      setBusyItemIds((prev) => {
        const next = new Set(prev)
        next.delete(item.libraryItemId)
        return next
      })
      if (!result.ok) {
        showToast(result.error ? t('ToastAutoPipelineActionFailedWithError', { error: result.error }) : t('ToastAutoPipelineActionFailed'), { type: 'error' })
      }
      return result.ok
    },
    [showToast, t]
  )

  const repair = useCallback(
    async (item: PipelineItemState, always: boolean) => {
      if (always && !(await runItemAction(item, () => updateLibraryAutoPipelineAction(libraryId, { autoRepairSeekIndex: true })))) return
      void runItemAction(item, () => runItemPipelineAction(item.libraryItemId, { repairSeekIndex: true }))
    },
    [libraryId, runItemAction]
  )

  const notNow = useCallback(
    async (item: PipelineItemState) => {
      if (await runItemAction(item, () => dismissItemPipelineAction(item.libraryItemId))) {
        setItems((prev) => prev.filter((entry) => entry.libraryItemId !== item.libraryItemId))
      }
    },
    [runItemAction]
  )

  return { items, busyItemIds, repair, notNow }
}
