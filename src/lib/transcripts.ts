import { withBasePath } from '@/lib/basePath'
import type { TranslationKey } from '@/types/translations'

/**
 * Transcripts of audiobooks and podcast episodes (fork server feature `transcripts`, see the server's
 * managers/TranscriptManager.js). Three sources, preferred in this order: the creator's transcript from the podcast
 * feed, a `.vtt`/`.srt` file next to the audio, one generated from the audio by the server (chapterbot).
 */

export type TranscriptSource = 'feed' | 'local' | 'generated'
export type TranscriptFormat = 'vtt' | 'srt' | 'json' | 'html' | 'txt'

export interface TranscriptInfo {
  /** `feed-<n>`, `local` or `generated` */
  id: string
  source: TranscriptSource
  format: TranscriptFormat
  mimeType: string
  /** Has cue times (VTT, SRT, JSON); HTML and plain text do not */
  timed: boolean
  language: string | null
  rel: string | null
  /** The creator's URL (feed transcripts only) */
  url: string | null
  /** A copy is stored on the server */
  downloaded: boolean
  updatedAt: number | null
  model: string | null
  /** Generated transcripts: `transcribe` (chapterbot) or `readalong` (from an EPUB made from the audio) */
  generatedFrom?: 'transcribe' | 'readalong'
  /** Local sidecars: how many audio files have one */
  fileCount?: number
}

export type TranscriptJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface TranscriptJob {
  libraryItemId: string
  episodeId: string | null
  origin: 'user' | 'auto'
  method: 'auto' | 'transcribe' | 'readalong'
  status: TranscriptJobStatus
  /** 0..1 */
  progress: number
  error: string | null
  generatedFrom: 'transcribe' | 'readalong' | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export interface TranscriptList {
  libraryItemId: string
  episodeId: string | null
  transcripts: TranscriptInfo[]
  preferredId: string | null
  /** The viewer is an admin and the server can generate one (chapterbot configured) */
  canGenerate: boolean
  /** Admins only */
  job: TranscriptJob | null
}

export interface TranscriptCue {
  start: number
  end: number
  text: string
  speaker?: string
}

export type TranscriptContent =
  | { id: string; source: TranscriptSource; format: TranscriptFormat; timed: true; cues: TranscriptCue[] }
  | { id: string; source: TranscriptSource; format: TranscriptFormat; timed: false; text: string }

function query(params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  const text = search.toString()
  return text ? `?${text}` : ''
}

export function transcriptListUrl(libraryItemId: string, episodeId?: string | null): string {
  return withBasePath(`/internal-api/items/${encodeURIComponent(libraryItemId)}/transcripts${query({ episodeId })}`)
}

/** `json` for the player, `vtt` (timed) or plain text, `original` downloads the file as published or stored. */
export function transcriptUrl(libraryItemId: string, transcriptId: string, episodeId?: string | null, format: 'json' | 'vtt' | 'original' = 'json'): string {
  return withBasePath(`/internal-api/items/${encodeURIComponent(libraryItemId)}/transcripts/${encodeURIComponent(transcriptId)}${query({ episodeId, format })}`)
}

export function isTranscriptJobActive(job: TranscriptJob | null | undefined): boolean {
  return !!job && (job.status === 'queued' || job.status === 'running')
}

export function isTranscriptList(value: unknown): value is TranscriptList {
  return !!value && typeof value === 'object' && Array.isArray((value as TranscriptList).transcripts)
}

/** Parse `?format=json`. Returns null for anything that is not a transcript. */
export function parseTranscriptContent(value: unknown): TranscriptContent | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as Record<string, unknown>
  if (typeof obj.id !== 'string') return null
  const base = { id: obj.id, source: obj.source as TranscriptSource, format: obj.format as TranscriptFormat }
  if (obj.timed === false) return typeof obj.text === 'string' ? { ...base, timed: false, text: obj.text } : null
  if (!Array.isArray(obj.cues)) return null
  const cues: TranscriptCue[] = []
  for (const raw of obj.cues) {
    if (!raw || typeof raw !== 'object') continue
    const c = raw as Record<string, unknown>
    if (typeof c.start !== 'number' || typeof c.end !== 'number' || typeof c.text !== 'string' || !Number.isFinite(c.start)) continue
    cues.push(
      typeof c.speaker === 'string' && c.speaker
        ? { start: c.start, end: c.end, text: c.text, speaker: c.speaker }
        : { start: c.start, end: c.end, text: c.text }
    )
  }
  cues.sort((a, b) => a.start - b.start)
  return { ...base, timed: true, cues }
}

/**
 * Index of the cue being spoken at `time`: the last cue that started at or before it. A pause between cues keeps the
 * previous cue current (so the highlight does not flicker), -1 before the first cue.
 */
export function findCueIndex(cues: readonly TranscriptCue[], time: number): number {
  let lo = 0
  let hi = cues.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= time + 0.05) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

const SOURCE_KEYS: Record<TranscriptSource, TranslationKey> = {
  feed: 'LabelTranscriptSourceFeed',
  local: 'LabelTranscriptSourceLocal',
  generated: 'LabelTranscriptSourceGenerated'
}

export function transcriptSourceKey(source: TranscriptSource): TranslationKey {
  return SOURCE_KEYS[source] ?? 'LabelTranscriptSourceFeed'
}

/** The transcript the player shows first: the server's preference, else the first timed one, else the first one. */
export function pickDefaultTranscript(list: TranscriptList | null): TranscriptInfo | null {
  if (!list?.transcripts.length) return null
  return list.transcripts.find((t) => t.id === list.preferredId) ?? list.transcripts.find((t) => t.timed) ?? list.transcripts[0]
}
