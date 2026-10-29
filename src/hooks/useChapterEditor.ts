'use client'

import { snapChaptersAction, updateChaptersAction, type SnapChaptersActionResult } from '@/app/actions/chapterActions'
import { getExpandedLibraryItemAction } from '@/app/actions/mediaActions'
import { approvePipelineProposalAction, getPipelineProposalAction, rejectPipelineProposalAction } from '@/app/actions/pipelineActions'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useUser } from '@/contexts/UserContext'
import { useChapterPreviewAudio } from '@/hooks/useChapterPreviewAudio'
import { useItemPageSocket } from '@/hooks/useItemPageSocket'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { callStatusAction } from '@/lib/actionResult'
import { buildPipelineProposalSession, getPipelineProposalChapters, normalizePipelineFailing } from '@/lib/autoPipeline'
import {
  applyChapterTitleDrafts,
  applySnapProposals,
  applySnapTitles,
  buildBulkChapters,
  buildChapterDirtyBaseline,
  buildIdenticalChapters,
  clampBulkChapterCount,
  computeChapterEnds,
  computeHasChanges,
  canMapAudibleChapterTitles,
  detectBulkChapterPattern,
  hasNonPlaceholderChapters,
  initChapters,
  insertChapterBelow,
  isClearAllChaptersState,
  mergeAudibleChapterData,
  mergeAudibleChapterTitles,
  removeBrandingFromAudibleData,
  removeChapterAt,
  savedChapterListsMatch,
  setChaptersFromTracks,
  shiftChapterTimes,
  updateChapterStart,
  updateChapterTitle,
  validateChapters,
  type EditableChapter,
  type ChapterMatchDebug,
  type SnapTitlePick
} from '@/lib/chapters/chapterEditorUtils'
import { SHOW_CHAPTER_MATCH_DEBUG } from '@/lib/chapters/chapterMatching'
import {
  buildSnapPayload,
  buildSnapRetryPayload,
  buildSnapSpeechPayload,
  getSnapErrorToast,
  getSnapRetryIndexes,
  mergeSnapRetry,
  type SnapRequestOptions,
  type SnapRow,
  type SnapSession,
  type SnapSpeechBatchResult
} from '@/lib/chapters/chapterSnap'
import { blurActiveChapterEditorField } from '@/lib/chapterEditorFocus'
import type { AudibleChapterSearchResult, BookLibraryItem, Chapter, PodcastLibraryItem } from '@/types/api'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'

interface UseChapterEditorOptions {
  initialLibraryItem: BookLibraryItem
  onItemUpdated?: (item: BookLibraryItem) => void
  /**
   * Review the auto pipeline's proposal (fork only): load it into the editor as unsaved changes, show its stored snap
   * in the snap panel, and save through `proposal/approve` so the pipeline continues.
   */
  pipelineProposal?: boolean
}

/** The auto pipeline proposal under review. `resolved`: approved or kept, saves go back to the normal route. */
export interface PipelineProposalReview {
  status: 'loading' | 'ready' | 'error' | 'resolved'
  session: SnapSession | null
  failing: { index: number; why: string[] }[]
  blockers: string[]
}

function selectedChapterIds(chapters: EditableChapter[], selectedKeys: Set<string>): Set<number> | null {
  if (selectedKeys.size === 0) return null
  const ids = new Set<number>()
  for (const chapter of chapters) {
    if (chapter.clientKey && selectedKeys.has(chapter.clientKey)) {
      ids.add(chapter.id)
    }
  }
  return ids
}

export function useChapterEditor({ initialLibraryItem, onItemUpdated, pipelineProposal = false }: UseChapterEditorOptions) {
  const [libraryItem, setLibraryItem] = useState(initialLibraryItem)

  const t = useTypeSafeTranslations()
  const { showToast } = useGlobalToast()
  const { token } = useUser()
  const [isPending, startTransition] = useTransition()

  const media = libraryItem.media
  const mediaDuration = media.duration ?? 0
  const mediaDurationRounded = Math.round(mediaDuration)
  const savedChapters = useMemo(() => media.chapters || [], [media.chapters])
  const tracks = useMemo(() => media.tracks ?? [], [media.tracks])

  const [newChapters, setNewChapters] = useState<EditableChapter[]>(() => initChapters(savedChapters, mediaDuration))
  const newChaptersRef = useRef(newChapters)
  newChaptersRef.current = newChapters
  const dirtyBaseline = useMemo(() => buildChapterDirtyBaseline(newChapters, savedChapters, mediaDuration), [mediaDuration, newChapters, savedChapters])
  const [hasChanges, setHasChanges] = useState(() => computeHasChanges(initChapters(savedChapters, mediaDuration), savedChapters, mediaDuration))
  const hasChangesRef = useRef(hasChanges)
  hasChangesRef.current = hasChanges
  const [titleResetKey, setTitleResetKey] = useState(0)
  const [lookupResult, setLookupResult] = useState<AudibleChapterSearchResult | null>(null)
  const [lookupBaselineCount, setLookupBaselineCount] = useState(0)
  const [shiftAmount, setShiftAmount] = useState(0)
  const [addChapterInput, setAddChapterInput] = useState('')
  const [bulkChapterCount, setBulkChapterCountState] = useState(1)
  const [removeBranding, setRemoveBranding] = useState(false)
  const [mapChapterTitles, setMapChapterTitles] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set())
  const [chapterMatchDebug, setChapterMatchDebug] = useState<Map<number, ChapterMatchDebug>>(() => new Map())
  const [chapterMatchDebugActive, setChapterMatchDebugActive] = useState(false)
  const [confirmState, setConfirmState] = useState<{ message: ReactNode; onConfirm: () => void } | null>(null)
  const titleDraftsRef = useRef<Map<number, string>>(new Map())
  const shiftBaseChaptersRef = useRef<EditableChapter[]>(initChapters(savedChapters, mediaDuration).map((chapter) => ({ ...chapter })))

  /** Saved chapters as editable rows — always the identity baseline for matching (not current editor). */
  const matchBaselineChapters = useMemo(() => initChapters(savedChapters, mediaDuration), [mediaDuration, savedChapters])

  const cloneMatchBaseline = useCallback(() => matchBaselineChapters.map((chapter) => ({ ...chapter })), [matchBaselineChapters])

  const clearTitleDrafts = useCallback(() => {
    titleDraftsRef.current.clear()
  }, [])

  const preview = useChapterPreviewAudio({ tracks, token })

  const clearChapterMatchDebug = useCallback(() => {
    setChapterMatchDebug(new Map())
    setChapterMatchDebugActive(false)
  }, [])

  const clearLookupUi = useCallback(() => {
    setLookupResult(null)
    setLookupBaselineCount(0)
    setMapChapterTitles(false)
    setRemoveBranding(false)
    clearChapterMatchDebug()
  }, [clearChapterMatchDebug])

  const validationMessages = useMemo(
    () => ({
      startLtPrev: t('MessageChapterErrorStartLtPrev'),
      startGteDuration: t('MessageChapterErrorStartGteDuration')
    }),
    [t]
  )

  const lookupResultForPreview = useMemo(() => {
    if (!lookupResult) return null
    return removeBranding ? removeBrandingFromAudibleData(lookupResult) : lookupResult
  }, [lookupResult, removeBranding])

  const canMapChapterTitles = useMemo(() => {
    if (!lookupResultForPreview) return false
    return canMapAudibleChapterTitles(lookupBaselineCount)
  }, [lookupBaselineCount, lookupResultForPreview])

  const runValidation = useCallback(
    (chapters: EditableChapter[], existingOverride?: Chapter[]) => {
      const result = validateChapters(chapters, existingOverride ?? savedChapters, mediaDuration, validationMessages)
      setNewChapters(result.chapters)
      setHasChanges(result.hasChanges)
      shiftBaseChaptersRef.current = result.chapters.map((chapter) => ({ ...chapter }))
      setShiftAmount(0)
      return result.chapters
    },
    [mediaDuration, savedChapters, validationMessages]
  )

  const handleShiftAmountChange = useCallback((amount: number) => {
    setShiftAmount(amount)
  }, [])

  const handleApplyShift = useCallback(() => {
    blurActiveChapterEditorField()
    const amount = shiftAmount
    if (!amount || Number.isNaN(amount) || newChapters.length <= 1) return

    const base = shiftBaseChaptersRef.current
    runValidation(shiftChapterTimes(base, amount, selectedChapterIds(base, selectedKeys), mediaDuration))
  }, [mediaDuration, newChapters.length, runValidation, selectedKeys, shiftAmount])

  const replaceChapterList = useCallback(
    (chapters: EditableChapter[], existingOverride?: Chapter[]) => {
      clearTitleDrafts()
      setTitleResetKey((key) => key + 1)
      return runValidation(chapters, existingOverride)
    },
    [clearTitleDrafts, runValidation]
  )

  const discardFocusedChapterFields = useCallback(() => {
    clearTitleDrafts()
    setTitleResetKey((key) => key + 1)
  }, [clearTitleDrafts])

  const loadSavedChapters = useCallback(
    (saved: Chapter[], duration: number) => {
      preview.destroyAudioEl()
      clearLookupUi()
      setSelectedKeys(new Set())
      clearTitleDrafts()
      const chapters = initChapters(saved, duration)
      const result = validateChapters(chapters, saved, duration, validationMessages)
      setNewChapters(result.chapters)
      setHasChanges(result.hasChanges)
      setTitleResetKey((key) => key + 1)
      shiftBaseChaptersRef.current = result.chapters.map((chapter) => ({ ...chapter }))
      setShiftAmount(0)
    },
    [clearLookupUi, clearTitleDrafts, preview, validationMessages]
  )

  const resetEditorChapters = useCallback(() => {
    loadSavedChapters(savedChapters, mediaDuration)
  }, [loadSavedChapters, mediaDuration, savedChapters])

  const refreshAfterChapterUpdate = useCallback(
    async (successToast: string) => {
      showToast(successToast, { type: 'success' })
      const refreshed = await getExpandedLibraryItemAction(libraryItem.id)
      if (refreshed.mediaType === 'book') {
        const book = refreshed as BookLibraryItem
        setLibraryItem(book)
        loadSavedChapters(book.media.chapters || [], book.media.duration ?? 0)
        onItemUpdated?.(book)
      }
    },
    [libraryItem.id, loadSavedChapters, onItemUpdated, showToast]
  )

  const handleSocketItemUpdated = useCallback(
    (updated: BookLibraryItem | PodcastLibraryItem) => {
      if (updated.id !== libraryItem.id || updated.mediaType !== 'book') return
      if (hasChangesRef.current) return

      const book = updated as BookLibraryItem
      const nextSaved = book.media.chapters || []
      const nextDuration = book.media.duration ?? 0
      const chaptersChanged = nextDuration !== mediaDuration || !savedChapterListsMatch(savedChapters, nextSaved)

      setLibraryItem(book)
      if (chaptersChanged) {
        loadSavedChapters(nextSaved, nextDuration)
      }
      onItemUpdated?.(book)
    },
    [libraryItem.id, loadSavedChapters, mediaDuration, onItemUpdated, savedChapters]
  )

  useItemPageSocket({
    libraryItemId: libraryItem.id,
    mediaId: media.id,
    isPodcast: false,
    onItemUpdated: handleSocketItemUpdated
  })

  const [proposalReview, setProposalReview] = useState<PipelineProposalReview | null>(() =>
    pipelineProposal ? { status: 'loading', session: null, failing: [], blockers: [] } : null
  )
  const proposalReviewRef = useRef(proposalReview)
  proposalReviewRef.current = proposalReview
  const replaceChapterListRef = useRef(replaceChapterList)
  replaceChapterListRef.current = replaceChapterList
  const mediaDurationRef = useRef(mediaDuration)
  mediaDurationRef.current = mediaDuration

  // Load the pipeline's proposal once per item: its chapters become unsaved edits, its snap the panel's session
  useEffect(() => {
    if (!pipelineProposal) return
    let active = true
    void callStatusAction(() => getPipelineProposalAction(libraryItem.id)).then((result) => {
      if (!active) return
      if (!result.ok) {
        setProposalReview({ status: 'error', session: null, failing: [], blockers: [] })
        showToast(result.error ? t('ToastAutoPipelineProposalFailedWithError', { error: result.error }) : t('ToastAutoPipelineProposalFailed'), {
          type: 'error'
        })
        return
      }
      const chapters = getPipelineProposalChapters(result.data)
      const rows = chapters.length ? replaceChapterListRef.current(initChapters(chapters, mediaDurationRef.current)) : []
      setProposalReview({
        status: 'ready',
        session: rows.length ? buildPipelineProposalSession(result.data, rows) : null,
        failing: normalizePipelineFailing(result.data.failing),
        blockers: Array.isArray(result.data.blockers) ? result.data.blockers.filter((b): b is string => typeof b === 'string') : []
      })
    })
    return () => {
      active = false
    }
  }, [libraryItem.id, pipelineProposal, showToast, t])

  /** Keep the current chapters; the pipeline goes on to the EPUB step (when it is enabled for the library). */
  const handleRejectProposal = useCallback(() => {
    if (proposalReviewRef.current?.status !== 'ready') return
    startTransition(async () => {
      const result = await callStatusAction(() => rejectPipelineProposalAction(libraryItem.id, true))
      if (!result.ok) {
        showToast(result.error ? t('ToastAutoPipelineActionFailedWithError', { error: result.error }) : t('ToastAutoPipelineActionFailed'), {
          type: 'error'
        })
        return
      }
      setProposalReview((prev) => (prev ? { ...prev, status: 'resolved', session: null } : prev))
      loadSavedChapters(savedChapters, mediaDuration)
      showToast(t('ToastAutoPipelineRejected'), { type: 'success' })
    })
  }, [libraryItem.id, loadSavedChapters, mediaDuration, savedChapters, showToast, t])

  const isSavingRef = useRef(false)

  const handleSave = useCallback(
    (onSaved?: () => void) => {
      if (isSavingRef.current) return false

      preview.destroyAudioEl()
      const withDrafts = applyChapterTitleDrafts(newChapters, titleDraftsRef.current)
      clearTitleDrafts()
      const validated = runValidation(withDrafts)
      const clearingAllChapters = isClearAllChaptersState(validated, savedChapters)

      if (!clearingAllChapters) {
        for (const chapter of validated) {
          if (chapter.error) {
            showToast(t('ToastChaptersHaveErrors'), { type: 'error' })
            return false
          }
          if (!(chapter.title || '').trim()) {
            showToast(t('ToastChaptersMustHaveTitles'), { type: 'error' })
            return false
          }
        }
      }

      const payload = clearingAllChapters ? [] : computeChapterEnds(validated, mediaDuration)

      const successToast = payload.length === 0 ? t('ToastChaptersRemoved') : t('ToastChaptersUpdated')

      isSavingRef.current = true
      const approving = proposalReviewRef.current?.status === 'ready'
      startTransition(async () => {
        try {
          if (approving) {
            // Backs up and applies on the server, then the pipeline continues (EPUB step)
            const result = await callStatusAction(() => approvePipelineProposalAction(libraryItem.id, payload))
            if (!result.ok) {
              showToast(
                result.error ? t('ToastAutoPipelineActionFailedWithError', { error: result.error }) : t('ToastAutoPipelineActionFailed'),
                { type: 'error' }
              )
              return
            }
            setProposalReview((prev) => (prev ? { ...prev, status: 'resolved', session: null } : prev))
            await refreshAfterChapterUpdate(t('ToastAutoPipelineApproved'))
            onSaved?.()
            return
          }
          const data = await updateChaptersAction(libraryItem.id, payload)
          if (data.updated) {
            await refreshAfterChapterUpdate(successToast)
            onSaved?.()
          } else {
            showToast(t('MessageNoUpdatesWereNecessary'), { type: 'info' })
            clearLookupUi()
          }
        } catch (error) {
          console.error('Failed to update chapters', error)
          showToast(t('ToastFailedToUpdate'), { type: 'error' })
        } finally {
          isSavingRef.current = false
        }
      })
      return true
    },
    [
      clearLookupUi,
      clearTitleDrafts,
      libraryItem.id,
      mediaDuration,
      newChapters,
      preview,
      refreshAfterChapterUpdate,
      runValidation,
      savedChapters,
      showToast,
      t
    ]
  )

  const applyLookupMerge = useCallback(
    (data: AudibleChapterSearchResult, matchBaseline: EditableChapter[], nextMapTitles: boolean, nextRemoveBranding: boolean) => {
      const processed = nextRemoveBranding ? removeBrandingFromAudibleData(data) : data
      const baselineCount = hasNonPlaceholderChapters(matchBaseline) ? matchBaseline.length : 0
      const useMapTitles = nextMapTitles && canMapAudibleChapterTitles(baselineCount)
      setMapChapterTitles(useMapTitles)
      const mergeResult = useMapTitles
        ? mergeAudibleChapterTitles(matchBaseline, processed, mediaDuration)
        : mergeAudibleChapterData(processed, mediaDuration, matchBaseline)
      setChapterMatchDebug(mergeResult.matchDebug)
      setChapterMatchDebugActive(true)
      preview.destroyAudioEl()
      replaceChapterList(mergeResult.chapters.length ? mergeResult.chapters : initChapters([], mediaDuration))
    },
    [mediaDuration, preview, replaceChapterList]
  )

  const handleLookupResult = useCallback(
    (data: AudibleChapterSearchResult) => {
      discardFocusedChapterFields()
      const matchBaseline = cloneMatchBaseline()
      setLookupResult(data)
      setLookupBaselineCount(hasNonPlaceholderChapters(matchBaseline) ? matchBaseline.length : 0)
      setMapChapterTitles(false)
      setRemoveBranding(false)
      setSelectedKeys(new Set())
      applyLookupMerge(data, matchBaseline, false, false)
    },
    [applyLookupMerge, cloneMatchBaseline, discardFocusedChapterFields]
  )

  const handleMapChapterTitlesChange = useCallback(
    (value: boolean) => {
      if (!lookupResult) {
        setMapChapterTitles(value)
        return
      }
      applyLookupMerge(lookupResult, cloneMatchBaseline(), value, removeBranding)
    },
    [applyLookupMerge, cloneMatchBaseline, lookupResult, removeBranding]
  )

  const handleRemoveBrandingChange = useCallback(
    (value: boolean) => {
      if (!lookupResult) {
        setRemoveBranding(value)
        return
      }
      setRemoveBranding(value)
      applyLookupMerge(lookupResult, cloneMatchBaseline(), mapChapterTitles, value)
    },
    [applyLookupMerge, cloneMatchBaseline, lookupResult, mapChapterTitles]
  )

  const handleChapterCheckedChange = useCallback(
    (clientKey: string, checked: boolean) => {
      const next = new Set(selectedKeys)
      if (checked) next.add(clientKey)
      else next.delete(clientKey)
      setSelectedKeys(next)
    },
    [selectedKeys]
  )

  const handleToggleAllChaptersSelected = useCallback(
    (checked: boolean) => {
      const next = checked ? new Set(newChapters.map((chapter) => chapter.clientKey).filter((key): key is string => !!key)) : new Set<string>()
      setSelectedKeys(next)
    },
    [newChapters]
  )

  const handleRemoveSelected = useCallback(() => {
    if (selectedKeys.size === 0) return
    preview.destroyAudioEl()
    const remaining = newChapters.filter((chapter) => !chapter.clientKey || !selectedKeys.has(chapter.clientKey))
    replaceChapterList(remaining.length ? remaining : initChapters([], mediaDuration))
    setSelectedKeys(new Set())
  }, [mediaDuration, newChapters, preview, replaceChapterList, selectedKeys])

  const handleSetChaptersFromTracks = useCallback(() => {
    discardFocusedChapterFields()
    preview.destroyAudioEl()
    clearLookupUi()
    setSelectedKeys(new Set())
    const mergeResult = setChaptersFromTracks(tracks, cloneMatchBaseline())
    setChapterMatchDebug(mergeResult.matchDebug)
    setChapterMatchDebugActive(true)
    replaceChapterList(mergeResult.chapters.length ? mergeResult.chapters : initChapters([], mediaDuration))
  }, [clearLookupUi, cloneMatchBaseline, discardFocusedChapterFields, mediaDuration, preview, replaceChapterList, tracks])

  const showSnapError = useCallback(
    (result: Extract<SnapChaptersActionResult, { ok: false }>) => {
      const toast = getSnapErrorToast(result)
      showToast(toast.values ? t(toast.key, toast.values) : t(toast.key), { type: toast.type })
    },
    [showToast, t]
  )

  /** Snap the current editor rows (unsaved edits included); with a selection, only the selected rows. Saves nothing. */
  const handleSnapToAudio = useCallback(
    async (options: SnapRequestOptions): Promise<SnapSession | null> => {
      blurActiveChapterEditorField()
      const chapters = applyChapterTitleDrafts(newChaptersRef.current, titleDraftsRef.current)
      if (chapters.length <= 1) return null
      if (chapters.some((chapter) => chapter.error)) {
        showToast(t('ToastChaptersHaveErrors'), { type: 'error' })
        return null
      }

      const { payload, snapshot } = buildSnapPayload(chapters, selectedKeys, options)
      const result = await callStatusAction(() => snapChaptersAction(libraryItem.id, payload))
      if (!result.ok) {
        showSnapError(result)
        return null
      }
      return { snapshot, response: result.data, options }
    },
    [libraryItem.id, selectedKeys, showSnapError, showToast, t]
  )

  /** Server retry contract: resend proposedChapters with the not-analysed indexes, then merge. */
  const handleSnapRetry = useCallback(
    async (session: SnapSession): Promise<SnapSession | null> => {
      const payload = buildSnapRetryPayload(session.response, session.options)
      if (!payload) return session
      const result = await callStatusAction(() => snapChaptersAction(libraryItem.id, payload))
      if (!result.ok) {
        showSnapError(result)
        return null
      }
      return { ...session, response: mergeSnapRetry(session.response, result.data, getSnapRetryIndexes(session.response)) }
    },
    [libraryItem.id, showSnapError]
  )

  /**
   * Speech check for some chapters of a snap session (the server checks at most SNAP_SPEECH_BATCH_SIZE per request).
   * Sends the session's snapshot, not the editor rows, so the proposals match the session. 409/429 are left to the
   * caller to retry; other failures show the usual toast.
   */
  const handleSnapSpeechBatch = useCallback(
    async (session: SnapSession, indexes: number[]): Promise<SnapSpeechBatchResult> => {
      const result = await callStatusAction(() => snapChaptersAction(libraryItem.id, buildSnapSpeechPayload(session, indexes)))
      if (result.ok) return { ok: true, response: result.data }
      const busy = result.status === 409 || result.status === 429
      if (!busy) showSnapError(result)
      return { ok: false, busy }
    },
    [libraryItem.id, showSnapError]
  )

  /** Write the checked proposals into the editor as unsaved changes (start times only). */
  const handleApplySnap = useCallback(
    (rows: SnapRow[]) => {
      blurActiveChapterEditorField()
      const picks = rows.map((row) => ({ clientKey: row.clientKey, fromStart: row.originalStart, toStart: row.newStart }))
      const result = applySnapProposals(newChaptersRef.current, picks, mediaDuration)
      if (result.applied > 0) {
        runValidation(result.chapters)
      }
      if (result.skipped > 0) {
        showToast(t('ToastSnapChaptersAppliedSomeSkipped', { count: result.applied, skipped: result.skipped }), { type: 'warning' })
      } else if (result.applied > 0) {
        showToast(t('ToastSnapChaptersApplied', { count: result.applied }), { type: 'success' })
      }
      return result.applied
    },
    [mediaDuration, runValidation, showToast, t]
  )

  /** Write titles heard by the snap speech check into the editor as unsaved changes (titles only). Returns the applied clientKeys. */
  const handleApplySnapTitles = useCallback(
    (picks: SnapTitlePick[]): string[] => {
      blurActiveChapterEditorField()
      const chapters = applyChapterTitleDrafts(newChaptersRef.current, titleDraftsRef.current)
      const result = applySnapTitles(chapters, picks)
      if (result.applied.length > 0) {
        const applied = new Set(result.applied)
        for (const chapter of result.chapters) {
          if (chapter.clientKey && applied.has(chapter.clientKey)) titleDraftsRef.current.delete(chapter.id)
        }
        runValidation(result.chapters)
      }
      if (result.skipped > 0) {
        showToast(t('ToastSnapTitlesAppliedSomeSkipped', { count: result.applied.length, skipped: result.skipped }), { type: 'warning' })
      } else if (result.applied.length > 0) {
        showToast(t('ToastSnapTitlesApplied', { count: result.applied.length }), { type: 'success' })
      }
      return result.applied
    },
    [runValidation, showToast, t]
  )

  const setBulkChapterCount = useCallback((count: number) => {
    setBulkChapterCountState(clampBulkChapterCount(count))
  }, [])

  const handleAddChapterFromInput = useCallback(() => {
    const input = addChapterInput.trim()
    if (!input) return

    const count = clampBulkChapterCount(bulkChapterCount)
    const pattern = detectBulkChapterPattern(input)
    const nextChapters = pattern
      ? buildBulkChapters(pattern, count, newChapters, mediaDuration)
      : buildIdenticalChapters(input, count, newChapters, mediaDuration)

    replaceChapterList(nextChapters)
    setAddChapterInput('')
    setBulkChapterCountState(1)
  }, [addChapterInput, bulkChapterCount, mediaDuration, newChapters, replaceChapterList])

  const handleChapterStartChange = useCallback(
    (chapterId: number, start: number) => {
      runValidation(updateChapterStart(newChapters, chapterId, start))
    },
    [newChapters, runValidation]
  )

  const handleChapterTitleDraft = useCallback(
    (chapterId: number, chapterTitle: string) => {
      titleDraftsRef.current.set(chapterId, chapterTitle)
      setHasChanges(computeHasChanges(applyChapterTitleDrafts(newChapters, titleDraftsRef.current), savedChapters, mediaDuration))
    },
    [mediaDuration, newChapters, savedChapters]
  )

  const handleChapterTitleCommit = useCallback(
    (chapterId: number, chapterTitle: string) => {
      titleDraftsRef.current.delete(chapterId)
      const trimmedTitle = chapterTitle.trim()
      const prev = newChaptersRef.current
      const existing = prev[chapterId]
      const nextChapters = !existing || existing.title === trimmedTitle ? prev : updateChapterTitle(prev, chapterId, trimmedTitle)
      if (nextChapters !== prev) {
        setNewChapters(nextChapters)
        newChaptersRef.current = nextChapters
        shiftBaseChaptersRef.current = nextChapters.map((chapter) => ({ ...chapter }))
        setShiftAmount(0)
      }
      setHasChanges(computeHasChanges(nextChapters, savedChapters, mediaDuration))
    },
    [mediaDuration, savedChapters]
  )

  const handleChapterRemove = useCallback(
    (chapterId: number) => {
      runValidation(removeChapterAt(newChapters, chapterId))
    },
    [newChapters, runValidation]
  )

  const handleChapterInsertBelow = useCallback(
    (chapter: EditableChapter) => {
      runValidation(insertChapterBelow(newChapters, chapter))
    },
    [newChapters, runValidation]
  )

  useEffect(() => {
    setSelectedKeys((prev) => {
      if (prev.size === 0) return prev
      const validKeys = new Set(newChapters.map((chapter) => chapter.clientKey).filter((key): key is string => !!key))
      let changed = false
      const next = new Set<string>()
      for (const key of prev) {
        if (validKeys.has(key)) next.add(key)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [newChapters])

  return {
    media,
    mediaDuration,
    mediaDurationRounded,
    tracks,
    newChapters,
    dirtyBaseline,
    hasChanges,
    lookupResult,
    lookupResultForPreview,
    lookupBaselineCount,
    canMapChapterTitles,
    shiftAmount,
    addChapterInput,
    bulkChapterCount,
    removeBranding,
    mapChapterTitles,
    selectedKeys,
    chapterMatchDebug,
    chapterMatchDebugActive,
    showChapterMatchDebug: SHOW_CHAPTER_MATCH_DEBUG,
    confirmState,
    titleResetKey,
    isPending,
    preview,
    proposalReview,
    handleRejectProposal,
    handleShiftAmountChange,
    handleApplyShift,
    handleLookupResult,
    setAddChapterInput,
    setBulkChapterCount,
    handleMapChapterTitlesChange,
    handleRemoveBrandingChange,
    handleChapterCheckedChange,
    handleToggleAllChaptersSelected,
    handleRemoveSelected,
    handleSetChaptersFromTracks,
    handleSnapToAudio,
    handleSnapRetry,
    handleSnapSpeechBatch,
    handleApplySnap,
    handleApplySnapTitles,
    setConfirmState,
    handleSave,
    handleAddChapterFromInput,
    handleChapterStartChange,
    handleChapterTitleDraft,
    handleChapterTitleCommit,
    handleChapterRemove,
    handleChapterInsertBelow,
    resetEditorChapters,
    discardFocusedChapterFields
  }
}
