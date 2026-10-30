'use client'

import { getSeekIndexStatusAction, repairSeekIndexAction } from '@/app/actions/toolsActions'
import { useTasks } from '@/contexts/TasksContext'
import type { SeekIndexRepairOptions, SeekIndexRepairResult, SeekIndexStatus } from '@/types/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const SEEK_INDEX_TASK_ACTION = 'repair-seek-index'

interface UseSeekIndexOptions {
  libraryItemId: string
  /** Server has the mp3SeekIndex feature and the user is an admin (the endpoints are admin only) */
  enabled: boolean
}

/**
 * State for the MP3 seek index check and repair of one book: the stored check (refreshed on load), an on-demand
 * drift measurement, and the repair task (progress and result come from the shared tasks context).
 */
export function useSeekIndex({ libraryItemId, enabled }: UseSeekIndexOptions) {
  const { getTasksByLibraryItemId, getTaskProgress } = useTasks()
  const [status, setStatus] = useState<SeekIndexStatus | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultDismissed, setResultDismissed] = useState(false)

  const task = useMemo(() => getTasksByLibraryItemId(libraryItemId).find((t) => t.action === SEEK_INDEX_TASK_ACTION), [getTasksByLibraryItemId, libraryItemId])
  const running = !!task && !task.isFinished
  const progress = (running && getTaskProgress(libraryItemId)) || '0%'
  const taskResult = task?.isFinished ? ((task.data?.result as SeekIndexRepairResult | undefined) ?? null) : null
  const result = taskResult ?? status?.lastResult ?? null
  const taskError = task?.isFinished && task.isFailed ? task.error || '' : null

  const load = useCallback(
    async (measure: boolean) => {
      const res = await getSeekIndexStatusAction(libraryItemId, measure)
      if (res.ok) {
        setStatus(res.data)
        setError(null)
      } else {
        setError(res.error || null)
      }
    },
    [libraryItemId]
  )

  useEffect(() => {
    if (!enabled) return
    void load(false)
  }, [enabled, load])

  // When the repair finishes the files are rescanned: read the check again
  const finishedTaskId = task?.isFinished ? task.id : null
  const seenFinishedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || !finishedTaskId || seenFinishedRef.current === finishedTaskId) return
    seenFinishedRef.current = finishedTaskId
    setResultDismissed(false)
    void load(false)
  }, [enabled, finishedTaskId, load])

  const measure = useCallback(async () => {
    setMeasuring(true)
    try {
      await load(true)
    } finally {
      setMeasuring(false)
    }
  }, [load])

  const repair = useCallback(
    async (options: SeekIndexRepairOptions) => {
      setStarting(true)
      setResultDismissed(true)
      try {
        const res = await repairSeekIndexAction(libraryItemId, options)
        if (!res.ok) setError(res.error || null)
        else setError(null)
        return res.ok
      } finally {
        setStarting(false)
      }
    },
    [libraryItemId]
  )

  const dismissResult = useCallback(() => setResultDismissed(true), [])

  return {
    status,
    running: running || !!status?.processing,
    progress,
    measuring,
    starting,
    error,
    taskError,
    result: resultDismissed ? null : result,
    measure,
    repair,
    dismissResult
  }
}
