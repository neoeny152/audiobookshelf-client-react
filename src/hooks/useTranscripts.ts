'use client'

import { useSocketEvent } from '@/contexts/SocketContext'
import {
  isTranscriptList,
  parseTranscriptContent,
  transcriptListUrl,
  transcriptUrl,
  type TranscriptContent,
  type TranscriptJob,
  type TranscriptList
} from '@/lib/transcripts'
import { useCallback, useEffect, useState } from 'react'

export type TranscriptLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface TranscriptUpdatedEvent {
  libraryItemId?: string
  episodeId?: string | null
}

function matches(event: TranscriptUpdatedEvent | null | undefined, libraryItemId: string, episodeId: string | null): boolean {
  if (!event || event.libraryItemId !== libraryItemId) return false
  // a feed refresh of a podcast reports no episode: it may have changed any of them
  return !event.episodeId || event.episodeId === (episodeId ?? null)
}

/**
 * The transcript list of a book or a podcast episode (fork feature `transcripts`). Reloads when the server reports a
 * change (`transcript_updated`) and follows a generation job (`transcript_job_updated`, admins only).
 * Does nothing while `enabled` is false (a stock server, or no item).
 */
export function useTranscripts(libraryItemId: string | null | undefined, episodeId: string | null | undefined, enabled: boolean) {
  const key = enabled && libraryItemId ? `${libraryItemId}/${episodeId ?? ''}` : ''
  const [state, setState] = useState<{ key: string; list: TranscriptList | null; status: TranscriptLoadStatus }>({ key: '', list: null, status: 'idle' })
  const [reloadToken, setReloadToken] = useState(0)
  const [jobEvent, setJobEvent] = useState<TranscriptJob | null>(null)

  useEffect(() => {
    if (!key || !libraryItemId) return
    const controller = new AbortController()
    setState((prev) => (prev.key === key ? { ...prev, status: prev.list ? 'ready' : 'loading' } : { key, list: null, status: 'loading' }))
    void (async () => {
      try {
        const response = await fetch(transcriptListUrl(libraryItemId, episodeId), {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        })
        if (!response.ok) throw new Error(`Transcript list request failed (${response.status})`)
        const body: unknown = await response.json()
        if (!isTranscriptList(body)) throw new Error('Invalid transcript list')
        setState({ key, list: body, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('[Transcripts] failed to load the transcript list', error)
        setState({ key, list: null, status: 'error' })
      }
    })()
    return () => controller.abort()
  }, [episodeId, key, libraryItemId, reloadToken])

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  const handleUpdated = useCallback(
    (event: TranscriptUpdatedEvent) => {
      if (key && libraryItemId && matches(event, libraryItemId, episodeId ?? null)) reload()
    },
    [episodeId, key, libraryItemId, reload]
  )
  useSocketEvent<TranscriptUpdatedEvent>('transcript_updated', handleUpdated, [handleUpdated])

  const handleJob = useCallback(
    (job: TranscriptJob) => {
      if (!key || !libraryItemId || job?.libraryItemId !== libraryItemId || (job.episodeId ?? null) !== (episodeId ?? null)) return
      setJobEvent(job)
    },
    [episodeId, key, libraryItemId]
  )
  useSocketEvent<TranscriptJob>('transcript_job_updated', handleJob, [handleJob])

  if (!key || state.key !== key) return { list: null, status: key ? ('loading' as const) : ('idle' as const), reload, jobEvent: null }
  return { list: state.list, status: state.status, reload, jobEvent: jobEvent && jobEvent.libraryItemId === libraryItemId ? jobEvent : null }
}

/** Loads one transcript's cues (or untimed text) for the player. */
export function useTranscriptContent(
  libraryItemId: string | null | undefined,
  episodeId: string | null | undefined,
  transcriptId: string | null | undefined,
  version?: number | null
) {
  const key = libraryItemId && transcriptId ? `${libraryItemId}/${episodeId ?? ''}/${transcriptId}/${version ?? ''}` : ''
  const [state, setState] = useState<{ key: string; content: TranscriptContent | null; status: TranscriptLoadStatus }>({
    key: '',
    content: null,
    status: 'idle'
  })

  useEffect(() => {
    if (!key || !libraryItemId || !transcriptId) return
    const controller = new AbortController()
    setState({ key, content: null, status: 'loading' })
    void (async () => {
      try {
        const response = await fetch(transcriptUrl(libraryItemId, transcriptId, episodeId, 'json'), {
          credentials: 'include',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        })
        if (!response.ok) throw new Error(`Transcript request failed (${response.status})`)
        const content = parseTranscriptContent(await response.json())
        if (!content) throw new Error('Invalid transcript')
        setState({ key, content, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return
        console.warn('[Transcripts] failed to load the transcript', error)
        setState({ key, content: null, status: 'error' })
      }
    })()
    return () => controller.abort()
  }, [episodeId, key, libraryItemId, transcriptId])

  if (!key || state.key !== key) return { content: null, status: key ? ('loading' as const) : ('idle' as const) }
  return state
}
