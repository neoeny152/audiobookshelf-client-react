'use client'

import LoadingIndicator from '@/components/ui/LoadingIndicator'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { secondsToTimestamp } from '@/lib/datefns'
import { mergeClasses } from '@/lib/merge-classes'
import { findCueIndex, type TranscriptContent, type TranscriptCue } from '@/lib/transcripts'
import { memo, useCallback, useEffect, useRef, useState } from 'react'

export interface TranscriptViewProps {
  content: TranscriptContent | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Playback position on the transcript's timeline (book time, or the episode's time) */
  currentTime: number
  /** Seek the player; without it the cues are not clickable */
  onSeek?: (time: number) => void
  className?: string
}

interface CueListProps {
  cues: TranscriptCue[]
  onSeek?: (time: number) => void
}

/**
 * Rendered once per transcript: the highlight is moved by toggling `data-active` on the rows (see TranscriptView), so
 * a long book's thousands of cues are not re-rendered on every playback tick.
 */
const CueList = memo(function CueList({ cues, onSeek }: CueListProps) {
  return (
    <ol className="flex flex-col py-1">
      {cues.map((cue, index) => {
        const label = secondsToTimestamp(cue.start)
        const body = (
          <>
            <span className="text-foreground-muted w-16 shrink-0 pt-0.5 font-mono text-xs tabular-nums">{label}</span>
            <span dir="auto" className="min-w-0 flex-1 wrap-break-word whitespace-pre-line">
              {cue.speaker && <span className="text-foreground-muted me-1 font-semibold">{cue.speaker}:</span>}
              {cue.text}
            </span>
          </>
        )
        const rowClass =
          'flex w-full gap-3 rounded-sm px-3 py-1.5 text-start text-sm [content-visibility:auto] [contain-intrinsic-size:auto_2rem] data-[active=true]:bg-button-selected-bg data-[active=true]:text-foreground'
        return (
          <li key={index} data-cue-index={index} data-active="false" className="group">
            {onSeek ? (
              <button
                type="button"
                className={mergeClasses(rowClass, 'hover:bg-bg-hover focus-visible:bg-bg-hover cursor-pointer focus:outline-none')}
                data-active="false"
                cy-id="transcript-cue"
                onClick={() => onSeek(cue.start)}
              >
                {body}
              </button>
            ) : (
              <div className={rowClass} data-active="false" cy-id="transcript-cue">
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
})

/** Pause following the playback for this long after the user scrolls the list themselves. */
const MANUAL_SCROLL_PAUSE_MS = 8000

/**
 * A transcript that follows the playback: the cue being spoken is highlighted and kept in view; clicking a cue seeks
 * there. Scrolling by hand pauses the following for a few seconds ("Follow along" resumes it at once). An untimed
 * transcript (HTML or plain text from the creator) is shown as text.
 */
export default function TranscriptView({ content, status, currentTime, onSeek, className }: TranscriptViewProps) {
  const t = useTypeSafeTranslations()
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLElement | null>(null)
  const manualUntilRef = useRef(0)
  const [following, setFollowing] = useState(true)

  const cues = content?.timed ? content.cues : null
  const activeIndex = cues ? findCueIndex(cues, currentTime) : -1

  const scrollToActive = useCallback((behavior: ScrollBehavior) => {
    const list = listRef.current
    const row = activeRef.current
    if (!list || !row) return
    const listRect = list.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const target = list.scrollTop + (rowRect.top - listRect.top) - list.clientHeight / 2 + rowRect.height / 2
    list.scrollTo({ top: Math.max(0, target), behavior })
  }, [])

  // A new transcript starts fresh
  useEffect(() => {
    activeRef.current = null
    manualUntilRef.current = 0
  }, [cues])

  // Move the highlight and keep the cue in view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const previous = activeRef.current
    const row = activeIndex >= 0 ? (list.querySelector(`[data-cue-index="${activeIndex}"]`) as HTMLElement | null) : null
    if (previous === row) return
    if (previous) {
      previous.dataset.active = 'false'
      previous.firstElementChild?.setAttribute('data-active', 'false')
      previous.removeAttribute('aria-current')
    }
    activeRef.current = row
    if (!row) return
    row.dataset.active = 'true'
    row.firstElementChild?.setAttribute('data-active', 'true')
    row.setAttribute('aria-current', 'true')
    if (following && Date.now() >= manualUntilRef.current) {
      // a jump of more than a few cues (a seek) scrolls at once, the next cue glides in
      scrollToActive(previous && Math.abs(Number(previous.dataset.cueIndex) - activeIndex) <= 3 ? 'smooth' : 'instant')
    }
  }, [activeIndex, following, scrollToActive, cues])

  const pauseFollowing = useCallback(() => {
    manualUntilRef.current = Date.now() + MANUAL_SCROLL_PAUSE_MS
    setFollowing(false)
  }, [])

  // Resume following on its own after a while
  useEffect(() => {
    if (following) return
    const timer = setTimeout(() => setFollowing(true), MANUAL_SCROLL_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [following])

  const resumeFollowing = useCallback(() => {
    manualUntilRef.current = 0
    setFollowing(true)
    scrollToActive('smooth')
  }, [scrollToActive])

  const handleSeek = useCallback(
    (time: number) => {
      // the user picked this spot: follow from here
      manualUntilRef.current = 0
      setFollowing(true)
      onSeek?.(time)
    },
    [onSeek]
  )

  if (status === 'loading' || status === 'idle') {
    return (
      <div className={mergeClasses('flex h-32 items-center justify-center', className)}>
        <LoadingIndicator variant="inline" />
      </div>
    )
  }
  if (status === 'error' || !content) {
    return (
      <div className={mergeClasses('flex h-32 items-center justify-center p-4 text-center', className)} cy-id="transcript-error">
        <p>{t('MessageTranscriptLoadFailed')}</p>
      </div>
    )
  }
  if (!content.timed) {
    return (
      <div className={mergeClasses('overflow-y-auto p-4', className)} cy-id="transcript-text">
        <p className="text-foreground-muted mb-3 text-xs">{t('LabelTranscriptNotTimed')}</p>
        <p dir="auto" className="text-sm whitespace-pre-line">
          {content.text}
        </p>
      </div>
    )
  }
  if (!content.cues.length) {
    return (
      <div className={mergeClasses('flex h-32 items-center justify-center', className)}>
        <p>{t('MessageNoTranscripts')}</p>
      </div>
    )
  }

  return (
    <div className={mergeClasses('relative flex min-h-0 flex-col', className)}>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        cy-id="transcript-cues"
        onWheel={pauseFollowing}
        onTouchMove={pauseFollowing}
        onKeyDown={(e) => {
          if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) pauseFollowing()
        }}
      >
        <CueList cues={content.cues} onSeek={onSeek ? handleSeek : undefined} />
      </div>
      {!following && activeIndex >= 0 && (
        <button
          type="button"
          className="bg-primary text-button-foreground absolute bottom-3 left-1/2 -translate-x-1/2 cursor-pointer rounded-full px-4 py-1 text-sm shadow-md"
          onClick={resumeFollowing}
          cy-id="transcript-follow"
        >
          {t('LabelTranscriptFollowAlong')}
        </button>
      )}
    </div>
  )
}
