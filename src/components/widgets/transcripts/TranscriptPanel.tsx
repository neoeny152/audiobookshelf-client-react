'use client'

import Btn from '@/components/ui/Btn'
import ProgressIndicator from '@/components/ui/ProgressIndicator'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import type { TranslationKey } from '@/types/translations'
import { isTranscriptJobActive, transcriptSourceKey, transcriptUrl, type TranscriptInfo, type TranscriptJob, type TranscriptList } from '@/lib/transcripts'

/** ProgressIndicator takes the key, not the text. */
const PROGRESS_LABEL: TranslationKey = 'MessageTranscriptRunning'

export interface TranscriptPanelProps {
  libraryItemId: string
  episodeId: string | null
  list: TranscriptList | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  isPodcast: boolean
  /** The viewer is an admin (generate, cancel, delete, check the feed) */
  isAdmin: boolean
  /** The server can generate transcripts right now (`transcriptsGenerate`) */
  generateAvailable: boolean
  /** The latest job state (socket event or action result); falls back to the list's */
  job?: TranscriptJob | null
  busy?: boolean
  onGenerate?: () => void
  onCancel?: () => void
  onDelete?: () => void
  onRefreshFeed?: () => void
  /** Opens the transcript next to the playback (player panel); without it there is no View button */
  onView?: (transcript: TranscriptInfo) => void
}

function TranscriptRow({
  info,
  libraryItemId,
  episodeId,
  onView
}: {
  info: TranscriptInfo
  libraryItemId: string
  episodeId: string | null
  onView?: (t: TranscriptInfo) => void
}) {
  const t = useTypeSafeTranslations()
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" cy-id={`transcript-row-${info.id}`}>
      <span className="font-medium">{t(transcriptSourceKey(info.source))}</span>
      <span className="bg-foreground-muted/10 rounded-sm px-1.5 py-0.5 font-mono text-xs">{info.format.toUpperCase()}</span>
      {info.language && <span className="text-foreground-muted text-xs">{info.language}</span>}
      {info.source === 'generated' && (
        <span className="text-foreground-muted text-xs">
          {info.generatedFrom === 'readalong' ? t('LabelTranscriptFromReadAlong') : info.model ? t('LabelTranscriptModel', { 0: info.model }) : null}
        </span>
      )}
      {!info.timed && <span className="text-foreground-muted text-xs">{t('LabelTranscriptNotTimed')}</span>}
      <span className="ms-auto flex items-center gap-2">
        {onView && (
          <button type="button" className="link-underline cursor-pointer text-sm" onClick={() => onView(info)}>
            {t('ButtonOpen')}
          </button>
        )}
        <a className="link-underline text-sm" href={transcriptUrl(libraryItemId, info.id, episodeId, 'original')} download cy-id="transcript-download">
          {t('LabelDownload')}
        </a>
      </span>
    </li>
  )
}

/**
 * The transcripts of a book or an episode on its detail page (fork feature `transcripts`): what exists (creator, local
 * file, generated), downloads, and for admins Generate / Cancel / Delete and "Check feed" (podcasts).
 */
export default function TranscriptPanel({
  libraryItemId,
  episodeId,
  list,
  status,
  isPodcast,
  isAdmin,
  generateAvailable,
  job: jobProp,
  busy = false,
  onGenerate,
  onCancel,
  onDelete,
  onRefreshFeed,
  onView
}: TranscriptPanelProps) {
  const t = useTypeSafeTranslations()
  const transcripts = list?.transcripts ?? []
  const job = jobProp ?? list?.job ?? null
  const running = isTranscriptJobActive(job)
  const hasGenerated = transcripts.some((tr) => tr.source === 'generated')
  const canGenerate = isAdmin && generateAvailable && !!list?.canGenerate

  return (
    <div className="flex flex-col gap-2 text-sm" cy-id="transcript-panel">
      {status === 'error' && <p className="text-error">{t('MessageTranscriptLoadFailed')}</p>}
      {status === 'ready' && !transcripts.length && <p cy-id="transcript-empty">{t('MessageNoTranscripts')}</p>}
      {transcripts.length > 0 && (
        <ul className="divide-border divide-y">
          {transcripts.map((info) => (
            <TranscriptRow key={info.id} info={info} libraryItemId={libraryItemId} episodeId={episodeId} onView={onView} />
          ))}
        </ul>
      )}

      {isAdmin && running && job && (
        <div className="flex flex-wrap items-end gap-3" cy-id="transcript-job">
          {job.status === 'queued' ? (
            <p className="flex-1">{t('MessageTranscriptQueued')}</p>
          ) : (
            <ProgressIndicator progress={job.progress * 100} label={PROGRESS_LABEL} className="flex-1 pt-0" />
          )}
          {onCancel && (
            <Btn size="small" color="bg-error" onClick={onCancel} disabled={busy}>
              {t('ButtonCancel')}
            </Btn>
          )}
        </div>
      )}
      {isAdmin && !running && job?.status === 'failed' && job.error && (
        <p className="text-error" cy-id="transcript-job-error">
          {t('MessageTranscriptJobFailed', { 0: job.error })}
        </p>
      )}

      {isAdmin && (canGenerate || hasGenerated || isPodcast) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {canGenerate && !running && onGenerate && (
            <Btn size="small" onClick={onGenerate} loading={busy}>
              {hasGenerated ? t('ButtonRegenerateTranscript') : t('ButtonGenerateTranscript')}
            </Btn>
          )}
          {hasGenerated && !running && onDelete && (
            <Btn size="small" color="bg-error" onClick={onDelete} disabled={busy}>
              {t('ButtonDeleteGeneratedTranscript')}
            </Btn>
          )}
          {isPodcast && onRefreshFeed && (
            <Btn size="small" color="bg-bg-secondary" onClick={onRefreshFeed} disabled={busy}>
              {t('ButtonCheckFeedForTranscripts')}
            </Btn>
          )}
        </div>
      )}
    </div>
  )
}
