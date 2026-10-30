'use client'

import { deleteSeekIndexBackupAction, getSeekIndexStatusAction, repairSeekIndexAction, restoreSeekIndexBackupAction } from '@/app/actions/toolsActions'
import { useTasks } from '@/contexts/TasksContext'
import type { ActionResult } from '@/lib/actionResult'
import type { SeekIndexRepairOptions, SeekIndexRepairResult, SeekIndexStatus } from '@/types/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export const SEEK_INDEX_TASK_ACTIONS = ['repair-seek-index', 'restore-seek-index']

/** While waiting for a task, the status is also polled in case its socket event is missed */
const WAIT_POLL_MS = 5000

interface UseSeekIndexOptions {
  libraryItemId: string
  /** Server has the mp3SeekIndex feature and the user is an admin (the endpoints are admin only) */
  enabled: boolean
}

export type SeekIndexState = ReturnType<typeof useSeekIndex>

/**
 * State for the MP3 seek index check, repair, and backups of one book. The status (files that drift, backups) is
 * read on load; the first read of a file without a seek header measures it on the server, so it can take seconds.
 * Task progress and results come from the shared tasks context.
 */
export function useSeekIndex({ libraryItemId, enabled }: UseSeekIndexOptions) {
  const { getTasksByLibraryItemId, getTaskProgress } = useTasks()
  const [status, setStatus] = useState<SeekIndexStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultDismissed, setResultDismissed] = useState(false)
  const loadPromiseRef = useRef<Promise<SeekIndexStatus | null> | null>(null)
  const waitersRef = useRef<Map<string, (result: SeekIndexRepairResult | null) => void>>(new Map())

  const task = useMemo(() => {
    const tasks = getTasksByLibraryItemId(libraryItemId).filter((t) => SEEK_INDEX_TASK_ACTIONS.includes(t.action))
    return tasks.find((t) => !t.isFinished) ?? tasks[tasks.length - 1]
  }, [getTasksByLibraryItemId, libraryItemId])
  const running = !!task && !task.isFinished
  const progress = (running && getTaskProgress(libraryItemId)) || '0%'
  const taskResult = task?.isFinished ? ((task.data?.result as SeekIndexRepairResult | undefined) ?? null) : null
  const result = taskResult ?? status?.lastResult ?? null
  const taskError = task?.isFinished && task.isFailed ? task.error || '' : null

  const load = useCallback((): Promise<SeekIndexStatus | null> => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    setLoading(true)
    const promise = getSeekIndexStatusAction(libraryItemId)
      .then((res) => {
        if (res.ok) {
          setStatus(res.data)
          setError(null)
          return res.data
        }
        setError(res.error || null)
        return null
      })
      .finally(() => {
        loadPromiseRef.current = null
        setLoading(false)
      })
    loadPromiseRef.current = promise
    return promise
  }, [libraryItemId])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load])

  /** The status, waiting for the read in progress (or starting one) when there is none yet */
  const ensureStatus = useCallback(async () => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    return status ?? load()
  }, [load, status])

  // When a task finishes the files were rescanned: read the status again, and settle anyone waiting for it
  const finishedTaskId = task?.isFinished ? task.id : null
  const seenFinishedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled || !finishedTaskId || seenFinishedRef.current === finishedTaskId) return
    seenFinishedRef.current = finishedTaskId
    setResultDismissed(false)
    void load()
    const waiter = waitersRef.current.get(finishedTaskId)
    if (waiter) waiter(taskResult)
  }, [enabled, finishedTaskId, load, taskResult])

  /**
   * Resolve when the task ends with its result (null when it has none). Polls the status too, so a missed
   * task_finished event does not leave the caller waiting forever.
   */
  const waitForTask = useCallback(
    (taskId: string) =>
      new Promise<SeekIndexRepairResult | null>((resolve) => {
        let settled = false
        const timer = setInterval(async () => {
          const res = await getSeekIndexStatusAction(libraryItemId)
          if (res.ok && !res.data.processing) {
            setStatus(res.data)
            settle(res.data.lastResult)
          }
        }, WAIT_POLL_MS)
        function settle(value: SeekIndexRepairResult | null) {
          if (settled) return
          settled = true
          clearInterval(timer)
          waitersRef.current.delete(taskId)
          resolve(value)
        }
        waitersRef.current.set(taskId, settle)
      }),
    [libraryItemId]
  )

  const startTask = useCallback(async (start: () => Promise<ActionResult<{ taskId: string }>>) => {
    setStarting(true)
    setResultDismissed(true)
    try {
      const res = await start()
      if (!res.ok) {
        setError(res.error || null)
        return null
      }
      setError(null)
      return res.data.taskId
    } finally {
      setStarting(false)
    }
  }, [])

  const repair = useCallback((options: SeekIndexRepairOptions) => startTask(() => repairSeekIndexAction(libraryItemId, options)), [libraryItemId, startTask])

  /** Start the repair and resolve with its result once the files are rescanned (null if it did not start) */
  const repairAndWait = useCallback(
    async (options: SeekIndexRepairOptions) => {
      const taskId = await repair(options)
      return taskId ? waitForTask(taskId) : null
    },
    [repair, waitForTask]
  )

  const restore = useCallback((backupId: string) => startTask(() => restoreSeekIndexBackupAction(libraryItemId, backupId)), [libraryItemId, startTask])

  const deleteBackup = useCallback(
    async (backupId: string) => {
      const res = await deleteSeekIndexBackupAction(libraryItemId, backupId)
      if (!res.ok) setError(res.error || null)
      await load()
      return res.ok
    },
    [libraryItemId, load]
  )

  const dismissResult = useCallback(() => setResultDismissed(true), [])

  return {
    status,
    loading,
    running: running || !!status?.processing,
    progress,
    starting,
    error,
    taskError,
    result: resultDismissed ? null : result,
    ensureStatus,
    repair,
    repairAndWait,
    restore,
    deleteBackup,
    dismissResult
  }
}
