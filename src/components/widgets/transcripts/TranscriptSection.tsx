'use client'

import {
  cancelTranscriptJobAction,
  deleteGeneratedTranscriptAction,
  generateTranscriptAction,
  refreshTranscriptsFromFeedAction
} from '@/app/actions/transcriptActions'
import Modal from '@/components/modals/Modal'
import ModalOuterContent from '@/components/modals/ModalOuterContent'
import CollapsibleSection from '@/components/widgets/CollapsibleSection'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import { useMediaContext } from '@/contexts/MediaContext'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useUser } from '@/contexts/UserContext'
import { useServerFeature } from '@/hooks/useServerFeatures'
import { useTranscriptContent, useTranscripts } from '@/hooks/useTranscripts'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { usePlayerProgress } from '@/lib/player/playerProgressStore'
import type { TranscriptInfo, TranscriptJob } from '@/lib/transcripts'
import type { LibraryItem } from '@/types/api'
import { useCallback, useEffect, useState } from 'react'
import TranscriptPanel from './TranscriptPanel'
import TranscriptView from './TranscriptView'

export interface TranscriptSectionProps {
  libraryItem: LibraryItem
  /** A podcast episode; null for a book */
  episodeId?: string | null
  /** Title used in the generate confirmation */
  title: string
  /** Render inside a collapsible section (book page) or plain (episode modal) */
  variant?: 'section' | 'plain'
}

function TranscriptReader({
  libraryItem,
  episodeId,
  transcript,
  onClose
}: {
  libraryItem: LibraryItem
  episodeId: string | null
  transcript: TranscriptInfo
  onClose: () => void
}) {
  const t = useTypeSafeTranslations()
  const { isStreaming, playItem, playerControls } = useMediaContext()
  const streaming = isStreaming(libraryItem.id, episodeId)
  const progress = usePlayerProgress()
  const { content, status } = useTranscriptContent(libraryItem.id, episodeId, transcript.id, transcript.updatedAt)
  const handleSeek = useCallback(
    (time: number) => {
      // already playing this book or episode: seek, keeping the session and the queue
      if (streaming) playerControls.seek(time)
      else void playItem({ libraryItem, episodeId, startTime: time, queueItems: [] })
    },
    [episodeId, libraryItem, playItem, playerControls, streaming]
  )
  return (
    <Modal
      isOpen
      onClose={onClose}
      outerContent={<ModalOuterContent>{t('HeaderTranscript')}</ModalOuterContent>}
      className="overflow-hidden sm:max-w-xl md:max-w-2xl lg:max-w-2xl"
    >
      <TranscriptView
        className="h-[75vh] max-h-[75vh]"
        content={content}
        status={status}
        currentTime={streaming ? progress.currentTime : -1}
        onSeek={handleSeek}
      />
    </Modal>
  )
}

/**
 * Transcripts of a book or podcast episode on its detail page (fork feature `transcripts`). Hidden on servers without
 * the feature. Admins can generate one from the audio (when the list says `canGenerate`), cancel it, delete it, and check a
 * podcast's feed for creator transcripts.
 */
export default function TranscriptSection({ libraryItem, episodeId = null, title, variant = 'section' }: TranscriptSectionProps) {
  const t = useTypeSafeTranslations()
  const { showToast } = useGlobalToast()
  const { userIsAdminOrUp } = useUser()
  const transcriptsFeature = useServerFeature('transcripts')
  const isPodcast = libraryItem.mediaType === 'podcast'
  const { list, status, reload, jobEvent } = useTranscripts(libraryItem.id, episodeId, transcriptsFeature)
  const [job, setJob] = useState<TranscriptJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmGenerate, setConfirmGenerate] = useState(false)
  const [viewing, setViewing] = useState<TranscriptInfo | null>(null)

  // the newest of: the action's answer, a socket event
  useEffect(() => {
    if (jobEvent) setJob(jobEvent)
  }, [jobEvent])
  useEffect(() => {
    setJob(null)
  }, [libraryItem.id, episodeId])

  // a job that ended reloads the list (the socket's transcript_updated does too, this covers a missed event)
  const jobStatus = job?.status
  useEffect(() => {
    if (jobStatus === 'done' || jobStatus === 'failed' || jobStatus === 'cancelled') reload()
  }, [jobStatus, reload])

  const run = useCallback(
    async <T,>(action: () => Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }>, onOk: (data: T) => void) => {
      setBusy(true)
      try {
        const result = await action()
        if (result.ok) onOk(result.data)
        else showToast(result.error || t('ToastTranscriptActionFailed'), { type: 'error' })
      } catch (error) {
        console.error('Transcript action failed', error)
        showToast(t('ToastTranscriptActionFailed'), { type: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [showToast, t]
  )

  const handleGenerate = useCallback(() => {
    setConfirmGenerate(false)
    void run(
      () => generateTranscriptAction(libraryItem.id, episodeId),
      (data) => {
        setJob(data.job)
        showToast(t('ToastTranscriptGenerateStarted'), { type: 'success' })
      }
    )
  }, [episodeId, libraryItem.id, run, showToast, t])

  const handleCancel = useCallback(() => {
    void run(
      () => cancelTranscriptJobAction(libraryItem.id, episodeId),
      (data) => setJob(data.job)
    )
  }, [episodeId, libraryItem.id, run])

  const handleDelete = useCallback(() => {
    void run(
      () => deleteGeneratedTranscriptAction(libraryItem.id, episodeId),
      () => {
        showToast(t('ToastTranscriptDeleted'), { type: 'success' })
        reload()
      }
    )
  }, [episodeId, libraryItem.id, reload, run, showToast, t])

  const handleRefreshFeed = useCallback(() => {
    void run(
      () => refreshTranscriptsFromFeedAction(libraryItem.id, episodeId),
      (data) => {
        showToast(t('ToastTranscriptFeedChecked', { 0: data.withTranscripts }), { type: 'info' })
        reload()
      }
    )
  }, [episodeId, libraryItem.id, reload, run, showToast, t])

  if (!transcriptsFeature) return null
  // nothing to show a listener: keep the page as it was
  if (!userIsAdminOrUp && !(list?.transcripts.length ?? 0)) return null

  const panel = (
    <TranscriptPanel
      libraryItemId={libraryItem.id}
      episodeId={episodeId}
      list={list}
      status={status}
      isPodcast={isPodcast}
      isAdmin={userIsAdminOrUp}
      job={job}
      busy={busy}
      onGenerate={() => setConfirmGenerate(true)}
      onCancel={handleCancel}
      onDelete={handleDelete}
      onRefreshFeed={handleRefreshFeed}
      onView={(info) => setViewing(info)}
    />
  )

  return (
    <>
      {variant === 'section' ? (
        <CollapsibleSection title={t('HeaderTranscripts')} count={list?.transcripts.length ?? 0}>
          <div className="px-4 py-2">{panel}</div>
        </CollapsibleSection>
      ) : (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold">{t('HeaderTranscripts')}</p>
          {panel}
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmGenerate}
        message={t('MessageTranscriptGenerateConfirm', { 0: title })}
        onClose={() => setConfirmGenerate(false)}
        onConfirm={handleGenerate}
      />
      {viewing && <TranscriptReader libraryItem={libraryItem} episodeId={episodeId} transcript={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
