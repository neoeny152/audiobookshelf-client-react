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
}

export interface EpubFromAudioProps {
  libraryItemId: string
  bookTitle: string
  /** The confirm dialog; the host opens it from its menu. */
  confirmOpen: boolean
  onConfirmClose: () => void
  actions: EpubFromAudioActions
  notify: (message: string, type: EpubToastType) => void
  /** The latest job the server pushed (`chapterbot_epub_done` / `_failed`), if any. */
  jobEvent?: EpubJob | null
  /** A job finished with an EPUB in the book folder; the host refreshes the item so it shows. */
  onFinished?: (job: EpubJob) => void
  pollIntervalMs?: number
}

function statusMessage(job: EpubJob, t: TypeSafeTranslations): string {
  if (job.status === 'downloading') return t('MessageEpubFromAudioSaving')
  if (job.cancelRequested) return t('MessageEpubFromAudioCancelling')
  if (job.status === 'queued') return t('MessageEpubFromAudioQueued')
  return t('MessageEpubFromAudioRunning')
}

/**
 * "Make EPUB from audio": the confirm dialog, then the job's progress with a Cancel button until the server reports
 * it done, failed or cancelled. Follows the job by polling GET and by the server's socket events (`jobEvent`).
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
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}: EpubFromAudioProps) {
  const t = useTypeSafeTranslations()
  const [job, setJob] = useState<EpubJob | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const jobIdRef = useRef<string | null>(null)

  // Latest callbacks, so the polling and socket effects do not restart when the host re-renders
  const latest = useRef({ actions, notify, onFinished, t })
  useEffect(() => {
    latest.current = { actions, notify, onFinished, t }
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

  /** Apply a status for the followed job. A finished job is reported once and then dropped. */
  const applyJob = useCallback(
    (next: EpubJob) => {
      if (next.libraryItemId !== libraryItemId || next.jobId !== jobIdRef.current) return
      if (isEpubJobActive(next)) {
        // A poll sent before the cancel can answer after it; the server never takes a cancel back
        setJob((prev) => (prev?.jobId === next.jobId && prev.cancelRequested && !next.cancelRequested ? { ...next, cancelRequested: true } : next))
        return
      }
      follow(null)
      const { notify: show, onFinished: finished, t: tr } = latest.current
      if (next.status === 'done') {
        show(next.fileName ? tr('ToastEpubFromAudioDone', { fileName: next.fileName }) : tr('ToastEpubFromAudioDoneNoName'), 'success')
        finished?.(next)
      } else if (next.status === 'cancelled') {
        show(tr('ToastEpubFromAudioCancelled'), 'info')
      } else {
        show(next.error ? tr('ToastEpubFromAudioFailedWithError', { error: next.error }) : tr('ToastEpubFromAudioFailed'), 'error')
      }
    },
    [follow, libraryItemId]
  )

  // A job started earlier in this browser (the server keeps one per item, in memory)
  useEffect(() => {
    const jobId = recallEpubJob(libraryItemId)
    if (!jobId) return
    let active = true
    void callStatusAction(() => latest.current.actions.get(libraryItemId, jobId)).then((result) => {
      if (!active) return
      if (result.ok && isEpubJobActive(result.data)) {
        jobIdRef.current = result.data.jobId
        setJob(result.data)
      } else if (result.ok || result.status === 404) {
        // Finished while away (the file is already in the folder) or forgotten by a server restart
        forgetEpubJob(libraryItemId)
      }
    })
    return () => {
      active = false
    }
  }, [libraryItemId])

  const jobId = job?.jobId ?? null
  const polling = !!job && isEpubJobActive(job)
  useEffect(() => {
    if (!jobId || !polling) return
    let inFlight = false
    const timer = setInterval(() => {
      if (inFlight) return
      inFlight = true
      void callStatusAction(() => latest.current.actions.get(libraryItemId, jobId))
        .then((result) => {
          if (result.ok) {
            applyJob(result.data)
          } else if (result.status === 404 && jobIdRef.current === jobId) {
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
            <Btn size="small" loading={isCancelling} disabled={!canCancelEpubJob(job)} onClick={() => void handleCancel()}>
              {t('ButtonCancel')}
            </Btn>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        title={t('ButtonMakeEpubFromAudio')}
        message={t('MessageConfirmEpubFromAudio', { title: bookTitle })}
        yesButtonText={t('ButtonStartEpubFromAudio')}
        onClose={onConfirmClose}
        onConfirm={() => void handleStart()}
      />
    </>
  )
}
