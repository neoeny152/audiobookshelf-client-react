'use client'

import { getItemHealthAction } from '@/app/actions/pipelineActions'
import { useSocketEvent } from '@/contexts/SocketContext'
import { useTasks } from '@/contexts/TasksContext'
import { SEEK_INDEX_TASK_ACTIONS } from '@/hooks/useSeekIndex'
import { callStatusAction } from '@/lib/actionResult'
import { toPipelineItemState } from '@/lib/autoPipeline'
import type { ItemHealth } from '@/types/api'
import { useCallback, useEffect, useRef, useState } from 'react'

interface UseItemHealthOptions {
  enabled: boolean
  /** The first read measures MP3s without a seek header (admin only, seconds per file the first time) */
  measure?: boolean
}

/**
 * A book's health (fork only), read again when the pipeline reports on the book and when a seek index repair or
 * restore of it finishes. Null while unknown, on a server without the endpoint, or when `enabled` is false.
 */
export function useItemHealth(libraryItemId: string, { enabled, measure = false }: UseItemHealthOptions) {
  const { getTasksByLibraryItemId } = useTasks()
  const [health, setHealth] = useState<ItemHealth | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const result = await callStatusAction(() => getItemHealthAction(libraryItemId))
    setLoading(false)
    const next = result.ok ? result.data : null
    setHealth(next)
    return next
  }, [libraryItemId])

  useEffect(() => {
    setHealth(null)
    if (!enabled) return
    let active = true
    setLoading(true)
    void callStatusAction(() => getItemHealthAction(libraryItemId, measure)).then((result) => {
      if (!active) return
      setLoading(false)
      setHealth(result.ok ? result.data : null)
    })
    return () => {
      active = false
    }
  }, [enabled, libraryItemId, measure])

  // A run saves its state on every poll and log line; the health only changes with its status
  const lastStatusRef = useRef<string | null>(null)
  const handlePipelineUpdate = useCallback(
    (data: unknown) => {
      const state = toPipelineItemState(data)
      if (!enabled || state?.libraryItemId !== libraryItemId || state.status === lastStatusRef.current) return
      lastStatusRef.current = state.status
      void reload()
    },
    [enabled, libraryItemId, reload]
  )
  useSocketEvent<unknown>('pipeline_item_updated', handlePipelineUpdate)

  const seekTasks = getTasksByLibraryItemId(libraryItemId).filter((task) => SEEK_INDEX_TASK_ACTIONS.includes(task.action) && task.isFinished)
  const lastSeekTaskId = seekTasks[seekTasks.length - 1]?.id ?? null
  useEffect(() => {
    if (enabled && lastSeekTaskId) void reload()
  }, [enabled, lastSeekTaskId, reload])

  return { health, loading, reload }
}
