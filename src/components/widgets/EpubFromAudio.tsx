'use client'

import type { StartEpubJobActionResult } from '@/app/actions/epubActions'
import Btn from '@/components/ui/Btn'
import ProgressIndicator from '@/components/ui/ProgressIndicator'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { callStatusAction, type StatusActionResult } from '@/lib/actionResult'
import {
  canCancelEpubJob,
  forgetEpubJob,
  getEpubJobPercent,
  getEpubRequestErrorToast,
  isEpubJobActive,
  recallEpubJob,
  rememberEpubJob
} from '@/lib/epubFromAudio'
import type { TranslationKey, TypeSafeTranslations } from '@/types/translations'
import type { EpubJob } from '@/types/api'
import { useCallback, useEffect, useRef, useState } from 'react'

/** The server only refreshes from chapterbot when its last poll is older than 5 s, and jobs take hours. */
const DEFAULT_POLL_INTERVAL_MS = 15_000

/** ProgressIndicator takes the key, not the text. */
const PROGRESS_LABEL: TranslationKey = 'HeaderEpubFromAudio'

export type EpubToastType = 'success' | 'error' | 'warning' | 'info'

/** Injected so the page passes the server actions and tests pass stubs. */
export interface EpubFromAudioActions {
  start: (libraryItemId: string) => Promise<StartEpubJobActionResult>
  get: (libraryItemId: string, jobId: string) => Promise<StatusActionResult<EpubJob>>
  cancel: (libraryItemId: string, jobId: string) => Promise<StatusActionResult<EpubJob>>
  /** `GET /api/items/:id/epub`: the item's current or latest job (newer servers, `chapterbotEpubCurrent`). */
  getCurrent?: (libraryItemId: string) => Promise<StatusActionResult<EpubJob>>
}

export interface EpubFromAudioProps {
  libraryItemId: string
  bookTitle: string
  /** The confirm dialog; the host opens it from its menu. */
  confirmOpen: boolean
  onConfirmClose: () => void
  actions: EpubFromAudioActions
  notify: (message: string, type: EpubToastType) => void
  /** The latest job the server pushed (`chapterbot_epub_updated` / `_done` / `_failed`), if any. */
  jobEvent?: EpubJob | null
  /** A job finished with an EPUB in the book folder; the host refreshes the item so it shows. */
  onFinished?: (job: EpubJob) => void
  /**
   * The server returns the item's job without its id (`chapterbotEpubCurrent`), so anyone who opens the book sees
   * the progress. Without it, only a job started in this browser (remembered in localStorage) is shown.
   */
  currentJobAvailable?: boolean
  /** The viewer may cancel (and start) jobs. Others only see the progress. */
  canUpdate?: boolean
  /** The book already has an EPUB made from its audio. */
  readyEbook?: { fileName: string } | null
  /** Opens the e-reader on `readyEbook`. Without it the chip has no Read button. */
  onReadEbook?: () => void
  pollIntervalMs?: number
}

function statusMessage(job: EpubJob, t: TypeSafeTranslations): string {
  if (job.status === 'downloading') return t('MessageEpubFromAudioSaving')
  if (job.cancelRequested) return t('MessageEpubFromAudioCancelling')
  if (job.status === 'queued') return t('MessageEpubFromAudioQueued')
  // chapterbot pauses the job while a speech check runs
  if (job.stage === 'paused') return t('MessageEpubFromAudioPaused')
  return t('MessageEpubFromAudioRunning')
}

/**
 * "Make EPUB from audio": the confirm dialog, then the job's progress until the server reports it done, failed or
 * cancelled, and an "EPUB ready" chip once the book has one. Follows the job by polling and by the server's socket
 * events (`jobEvent`). The progress shows for every viewer of the book; only `canUpdate` users get Cancel.
 */
export default function EpubFromAudio({
  libraryItemId,
  bookTitle,
  confirmOpen,
  onConfirmClose,
  actions,
  notify,
  jobEvent = null,
  onFinished,
  currentJobAvailable = false,
  canUpdate = true,
  readyEbook = null,
  onReadEbook,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}: EpubFromAudioProps) {
  const t = useTypeSafeTranslations()
  const [job, setJob] = useState<EpubJob | null>(null)
  /** A job that finished while this page was open (its file may not be in the item yet). */
  const [finishedJob, setFinishedJob] = useState<EpubJob | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const jobIdRef = useRef<string | null>(null)
  /** The last job reported as ended: the socket can deliver the end twice (to the starter, and to everyone). */
  const endedJobIdRef = useRef<string | null>(null)

  // Latest callbacks, so the polling and socket effects do not restart when the host re-renders
  const latest = useRef({ actions, notify, onFinished, t, currentJobAvailable })
  useEffect(() => {
    latest.current = { actions, notify, onFinished, t, currentJobAvailable }
  })

  const follow = useCallback(
    (next: EpubJob | null) => {
      jobIdRef.current = next?.jobId ?? null
      setJob(next)
      if (next) rememberEpubJob(libraryItemId, next.jobId)
      else forgetEpubJob(libraryItemId)
    },
    [libraryItemId]
  )

  /** Report a finished job once (toast, refresh) and drop it. */
  const finish = useCallback(
    (next: EpubJob, announce: boolean) => {
      follow(null)
      if (endedJobIdRef.current === next.jobId) return
      endedJobIdRef.current = next.jobId
      const { notify: show, onFinished: finished, t: tr } = latest.current
      if (next.status === 'done') {
        setFinishedJob(next)
        if (announce) show(next.fileName ? tr('ToastEpubFromAudioDone', { fileName: next.fileName }) : tr('ToastEpubFromAudioDoneNoName'), 'success')
        finished?.(next)
      } else if (!announce) {
        return
      } else if (next.status === 'cancelled') {
        show(tr('ToastEpubFromAudioCancelled'), 'info')
      } else {
        show(next.error ? tr('ToastEpubFromAudioFailedWithError', { error: next.error }) : tr('ToastEpubFromAudioFailed'), 'error')
      }
    },
    [follow]
  )

  /**
   * Apply a status for this item. The followed job is updated (and reported once when it ends). With no job followed,
   * an active one is picked up (started by someone else, another device or the auto pipeline) and a finished one only
   * refreshes the item, without a toast. A different job while one is followed is ignored.
   */
  const applyJob = useCallback(
    (next: EpubJob) => {
      if (next.libraryItemId !== libraryItemId) return
      const followed = jobIdRef.current
      if (followed && next.jobId !== followed) return
      if (isEpubJobActive(next)) {
        if (!followed) {
          follow(next)
          return
        }
        // A poll sent before the cancel can answer after it; the server never takes a cancel back
        setJob((prev) => (prev?.jobId === next.jobId && prev.cancelRequested && !next.cancelRequested ? { ...next, cancelRequested: true } : next))
        return
      }
      finish(next, !!followed)
    },
    [finish, follow, libraryItemId]
  )

  // Pick up the item's job: from the server when it can say (any viewer, any device), else one started in this browser
  useEffect(() => {
    let active = true
    const fromStorage = () => {
      const jobId = recallEpubJob(libraryItemId)
      if (!jobId) return
      void callStatusAction(() => latest.current.actions.get(libraryItemId, jobId)).then((result) => {
        if (!active) return
        if (result.ok && isEpubJobActive(result.data)) {
          if (!jobIdRef.current) follow(result.data)
        } else if (result.ok || result.status === 404) {
          // Finished while away (the file is already in the folder) or forgotten by a server restart
          forgetEpubJob(libraryItemId)
        }
      })
    }
    const getCurrent = latest.current.actions.getCurrent
    if (!currentJobAvailable || !getCurrent) {
      fromStorage()
      return () => {
        active = false
      }
    }
    void callStatusAction(() => getCurrent(libraryItemId)).then((result) => {
      if (!active) return
      if (result.ok && result.data.libraryItemId === libraryItemId) {
        if (isEpubJobActive(result.data)) {
          if (!jobIdRef.current || jobIdRef.current === result.data.jobId) follow(result.data)
        } else if (!jobIdRef.current) {
          // The latest job already ended; the file (if any) is in the item
          forgetEpubJob(libraryItemId)
        }
        return
      }
      // No job on the server, or an error: an id remembered here is the last resort
      fromStorage()
    })
    return () => {
      active = false
    }
  }, [currentJobAvailable, follow, libraryItemId])

  const jobId = job?.jobId ?? null
  const polling = !!job && isEpubJobActive(job)
  useEffect(() => {
    if (!jobId || !polling) return
    let inFlight = false
    const timer = setInterval(() => {
      if (inFlight) return
      inFlight = true
      const { actions: current, currentJobAvailable: byItem } = latest.current
      const request = byItem && current.getCurrent ? () => current.getCurrent!(libraryItemId) : () => current.get(libraryItemId, jobId)
      void callStatusAction(request)
        .then((result) => {
          if (jobIdRef.current !== jobId) return
          if (result.ok) {
            if (result.data.jobId === jobId) {
              applyJob(result.data)
            } else {
              // The server moved on to a newer job for this book: follow that one
              follow(null)
              applyJob(result.data)
            }
          } else if (result.status === 404) {
            follow(null)
            latest.current.notify(latest.current.t('ToastEpubFromAudioLost'), 'warning')
          }
          // Anything else (server busy, connection lost): keep following, the next poll may work
        })
        .finally(() => {
          inFlight = false
        })
    }, pollIntervalMs)
    return () => clearInterval(timer)
  }, [applyJob, follow, jobId, libraryItemId, pollIntervalMs, polling])

  useEffect(() => {
    if (jobEvent) applyJob(jobEvent)
  }, [applyJob, jobEvent])

  const handleStart = useCallback(async () => {
    onConfirmClose()
    if (isStarting) return
    setIsStarting(true)
    try {
      const result = await callStatusAction(() => latest.current.actions.start(libraryItemId))
      if (!result.ok) {
        const toast = getEpubRequestErrorToast(result, 'start')
        notify(toast.values ? t(toast.key, toast.values) : t(toast.key), toast.type)
        return
      }
      setFinishedJob(null)
      follow(result.data.job)
      notify(result.data.alreadyRunning ? t('ToastEpubFromAudioAlreadyRunning') : t('ToastEpubFromAudioStarted'), 'info')
      // A job can finish between the 409 and the lookup
      if (!isEpubJobActive(result.data.job)) applyJob(result.data.job)
    } finally {
      setIsStarting(false)
    }
  }, [applyJob, follow, isStarting, libraryItemId, notify, onConfirmClose, t])

  const handleCancel = useCallback(async () => {
    if (!job || !canCancelEpubJob(job) || isCancelling) return
    setIsCancelling(true)
    try {
      const result = await callStatusAction(() => latest.current.actions.cancel(libraryItemId, job.jobId))
      if (!result.ok) {
        const toast = getEpubRequestErrorToast(result, 'cancel')
        notify(toast.values ? t(toast.key, toast.values) : t(toast.key), toast.type)
        return
      }
      applyJob(result.data)
    } finally {
      setIsCancelling(false)
    }
  }, [applyJob, isCancelling, job, libraryItemId, notify, t])

  const showProgress = !!job && isEpubJobActive(job)
  const readyName = readyEbook?.fileName ?? finishedJob?.fileName ?? null
  const showReady = !showProgress && (!!readyEbook || !!finishedJob)

  return (
    <>
      {showProgress && (
        <div className="border-border mt-4 max-w-md rounded-md border px-3 py-2" cy-id="epub-from-audio-progress" data-status={job.status}>
          <ProgressIndicator progress={getEpubJobPercent(job)} label={PROGRESS_LABEL} className="pt-0" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-foreground-muted" role="status">
              {statusMessage(job, t)}
              {job.chaptersTotal > 0 && (
                <span className="ps-1" cy-id="epub-from-audio-chapters">
                  {t('MessageEpubFromAudioChapters', { done: job.chaptersDone, total: job.chaptersTotal })}
                </span>
              )}
            </p>
            {canUpdate && (
              <Btn size="small" loading={isCancelling} disabled={!canCancelEpubJob(job)} onClick={() => void handleCancel()}>
                {t('ButtonCancel')}
              </Btn>
            )}
          </div>
        </div>
      )}

      {showReady && (
        <div
          className="border-success/60 bg-success/10 mt-4 inline-flex max-w-md flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
          cy-id="epub-from-audio-ready"
        >
          <span className="material-symbols text-success text-lg" aria-hidden>
            auto_stories
          </span>
          <span className="font-semibold">{t('LabelEpubFromAudioReady')}</span>
          {readyName && (
            <span className="text-foreground-muted min-w-0 truncate" title={readyName}>
              {readyName}
            </span>
          )}
          {onReadEbook && readyEbook && (
            <Btn size="small" onClick={onReadEbook}>
              {t('ButtonRead')}
            </Btn>
          )}
        </div>
      )}

      {canUpdate && (
        <ConfirmDialog
          isOpen={confirmOpen}
          title={t('ButtonMakeEpubFromAudio')}
          message={t('MessageConfirmEpubFromAudio', { title: bookTitle })}
          yesButtonText={t('ButtonStartEpubFromAudio')}
          onClose={onConfirmClose}
          onConfirm={() => void handleStart()}
        />
      )}
    </>
  )
}
