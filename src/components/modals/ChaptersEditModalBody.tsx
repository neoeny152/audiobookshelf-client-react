'use client'

import { useLibraryItemModal, type UnsavedChangesLeaveHandle } from '@/components/modals/LibraryItemModal'
import Btn from '@/components/ui/Btn'
import Checkbox from '@/components/ui/Checkbox'
import HelpTooltipIcon from '@/components/ui/HelpTooltipIcon'
import LoadingIndicator from '@/components/ui/LoadingIndicator'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import ChaptersModalTable from '@/components/widgets/chapters-edit/ChaptersModalTable'
import FindChaptersPanel from '@/components/widgets/chapters-edit/FindChaptersPanel'
import { ShiftTimesFields } from '@/components/widgets/chapters-edit/ShiftTimesPanel'
import SnapToAudioPanel from '@/components/widgets/chapters-edit/SnapToAudioPanel'
import GuideTarget from '@/components/widgets/guided-fix/GuideTarget'
import SeekIndexSnapDialog, { type SeekIndexSnapChoice } from '@/components/widgets/seek-index/SeekIndexSnapDialog'
import { SeekIndexPanelForState, useSeekIndexEnabled } from '@/components/widgets/seek-index/SeekIndexWarning'
import { useSeekIndex } from '@/hooks/useSeekIndex'
import { useGuidedFix } from '@/contexts/GuidedFixContext'
import { usePipelineProposalTarget } from '@/contexts/PipelineProposalContext'
import { useChapterEditor, type PipelineProposalReview } from '@/hooks/useChapterEditor'
import { getPipelineWhyLabel } from '@/lib/autoPipeline'
import { useServerFeature } from '@/hooks/useServerFeatures'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { useUnsavedChangesLeave } from '@/hooks/useUnsavedChangesLeave'
import { blurActiveChapterEditorField } from '@/lib/chapterEditorFocus'
import type { SnapRow } from '@/lib/chapters/chapterSnap'
import { secondsToTimestamp } from '@/lib/datefns'
import { formatDuration } from '@/lib/formatDuration'
import { mergeClasses } from '@/lib/merge-classes'
import { isBookMediaWithTracks, type AudibleChapterSearchResult, type BookLibraryItem, type SeekIndexRepairResult, type SeekIndexStatus } from '@/types/api'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'

interface ChaptersEditModalBodyProps {
  /** Lets the parent intercept leave (section change, hub back, close) while chapters are dirty. */
  closeRequestRef?: Ref<UnsavedChangesLeaveHandle | null>
  /** True while a chapter save is in flight, so the parent can show processing on the shell. */
  onPendingChange?: (pending: boolean) => void
}

interface ChaptersEditContentProps {
  libraryItem: BookLibraryItem
  closeRequestRef?: Ref<UnsavedChangesLeaveHandle | null>
  onPendingChange?: (pending: boolean) => void
  onItemUpdated?: (item: BookLibraryItem) => void
}

function lookupDurationMessageKey(durationShorter: boolean, durationLonger: boolean) {
  if (durationShorter) return 'MessageLookupComparisonDurationShorter'
  if (durationLonger) return 'MessageLookupComparisonDurationLonger'
  return 'MessageLookupComparisonDurationMatch'
}

function LookupComparison({
  lookupResult,
  baselineCount,
  mediaDurationRounded
}: {
  lookupResult: AudibleChapterSearchResult
  baselineCount: number
  mediaDurationRounded: number
}) {
  const t = useTypeSafeTranslations()
  const foundChapterCount = lookupResult.chapters.length
  const foundDurationSec = lookupResult.runtimeLengthSec
  const countsDiffer = baselineCount !== foundChapterCount
  const durationShorter = foundDurationSec < mediaDurationRounded
  const durationLonger = foundDurationSec > mediaDurationRounded
  const durationMatches = !durationShorter && !durationLonger
  const durationDiffSec = Math.abs(foundDurationSec - mediaDurationRounded)
  const durationDiffDescription = formatDuration(durationDiffSec, t, { style: 'long', showSeconds: true })

  return (
    <p className="text-sm" role="status">
      {t.rich(lookupDurationMessageKey(durationShorter, durationLonger), {
        foundDuration: secondsToTimestamp(foundDurationSec),
        durationDifference: durationDiffDescription,
        durationDiff: (chunks) => (durationMatches ? chunks : <span className="text-warning font-semibold">{chunks}</span>)
      })}{' '}
      {t.rich(countsDiffer ? 'MessageLookupComparisonChaptersDiffer' : 'MessageLookupComparisonChaptersMatch', {
        foundCount: foundChapterCount,
        previousCount: baselineCount,
        chapterWas: (chunks) => (countsDiffer ? <span className="text-warning font-semibold">{chunks}</span> : chunks)
      })}
    </p>
  )
}

/** What the auto pipeline proposes and why it did not apply it on its own. */
function PipelineProposalBanner({ review, disabled, onReject }: { review: PipelineProposalReview; disabled: boolean; onReject: () => void }) {
  const t = useTypeSafeTranslations()
  if (review.status === 'resolved') return null
  if (review.status === 'loading') {
    return (
      <p className="text-foreground-muted text-sm" role="status" cy-id="pipeline-proposal-banner">
        {t('MessageAutoPipelineProposalLoading')}
      </p>
    )
  }
  if (review.status === 'error') return null
  const shown = review.failing.slice(0, 6)
  const describe = (codes: string[]) =>
    codes
      .map((code) => {
        const label = getPipelineWhyLabel(code)
        return label ? (label.values ? t(label.key, label.values) : t(label.key)) : code
      })
      .join(', ')
  return (
    <div className="border-warning/60 bg-warning/10 rounded-md border px-3 py-2 text-sm" cy-id="pipeline-proposal-banner">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{t('MessageAutoPipelineProposal')}</p>
        <Btn size="small" disabled={disabled} onClick={onReject}>
          {t('ButtonAutoPipelineKeepChapters')}
        </Btn>
      </div>
      {shown.length > 0 && (
        <ul className="text-foreground-muted mt-1 list-disc ps-5">
          {shown.map((entry) => (
            <li key={entry.index}>{t('MessageAutoPipelineFailingChapter', { number: entry.index + 1, why: describe(entry.why) })}</li>
          ))}
          {review.failing.length > shown.length && <li>{t('MessageAutoPipelineFailingMore', { count: review.failing.length - shown.length })}</li>}
        </ul>
      )}
      {review.blockers.length > 0 && (
        <p className="text-foreground-muted mt-1" cy-id="pipeline-proposal-blockers">
          {t('MessageAutoPipelineProposalBlockers', { reasons: describe(review.blockers) })}
        </p>
      )}
      <p className="text-foreground-muted mt-1">{t('MessageAutoPipelineProposalSave')}</p>
    </div>
  )
}

function ChaptersEditContent({ libraryItem, closeRequestRef, onPendingChange, onItemUpdated }: ChaptersEditContentProps) {
  const t = useTypeSafeTranslations()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [footerShadow, setFooterShadow] = useState(false)
  const proposalTarget = usePipelineProposalTarget()
  const guide = useGuidedFix()

  const editor = useChapterEditor({
    initialLibraryItem: libraryItem,
    onItemUpdated,
    pipelineProposal: proposalTarget?.itemId === libraryItem.id,
    onProposalResolved: proposalTarget?.onResolved
  })
  const speechCheckAvailable = useServerFeature('chapterbotVerify')

  const {
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
    showChapterMatchDebug,
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
    discardFocusedChapterFields,
    reloadAfterSeekIndexChange
  } = editor

  // MP3 seek index: the banner, and the check before a snap (snapping a drifting timeline cannot line up)
  const seekIndexEnabled = useSeekIndexEnabled()
  const seekIndex = useSeekIndex({ libraryItemId: libraryItem.id, enabled: seekIndexEnabled })
  const [snapGuard, setSnapGuard] = useState<{ status: SeekIndexStatus; resolve: (choice: SeekIndexSnapChoice) => void } | null>(null)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  /** One reload per finished repair/restore, whichever of the banner and the snap guard sees it first */
  const seekReloadsRef = useRef<Map<number, Promise<void>>>(new Map())
  const reloadForSeekResult = useCallback(
    (result: SeekIndexRepairResult) => {
      const pending = seekReloadsRef.current.get(result.finishedAt)
      if (pending) return pending
      const oldDurations = tracksRef.current.map((track) => track.duration)
      const promise = reloadAfterSeekIndexChange(oldDurations, result.type === 'repair' && result.chapters.mode === 'shift')
      seekReloadsRef.current.set(result.finishedAt, promise)
      return promise
    },
    [reloadAfterSeekIndexChange]
  )
  // A result already there when the editor opened is from before it: the item loaded with it applied
  const initialSeekResultRef = useRef<number | null | undefined>(undefined)
  if (initialSeekResultRef.current === undefined && seekIndex.status) initialSeekResultRef.current = seekIndex.status.lastResult?.finishedAt ?? null
  const seekResult = seekIndex.result
  useEffect(() => {
    if (!seekResult || initialSeekResultRef.current === undefined || seekResult.finishedAt === initialSeekResultRef.current) return
    if (seekResult.files.some((f) => f.status !== 'failed')) void reloadForSeekResult(seekResult)
  }, [reloadForSeekResult, seekResult])

  const guardedSnap = useCallback(
    async (options: Parameters<typeof handleSnapToAudio>[0]) => {
      if (seekIndexEnabled) {
        const status = await seekIndex.ensureStatus()
        if (status?.needsRepairCount) {
          const choice = await new Promise<SeekIndexSnapChoice>((resolve) => setSnapGuard({ status, resolve }))
          setSnapGuard(null)
          if (choice.choice === 'cancel') return null
          if (choice.choice === 'repair') {
            const result = await seekIndex.repairAndWait({ chapters: choice.shiftChapters ? 'shift' : 'keep' })
            // Failed or not started: the banner says why; nothing is snapped on the old timeline
            if (!result || !result.files.some((f) => f.status === 'repaired')) return null
            await reloadForSeekResult(result)
          }
        }
      }
      return handleSnapToAudio(options)
    },
    [handleSnapToAudio, reloadForSeekResult, seekIndex, seekIndexEnabled]
  )

  // Guide me: the lookup, applying the snap and the save each finish their step
  const handleGuidedLookupResult = useCallback(
    (data: AudibleChapterSearchResult) => {
      handleLookupResult(data)
      if (guide?.stepId === 'lookup') guide.advance()
    },
    [guide, handleLookupResult]
  )
  const handleGuidedApplySnap = useCallback(
    (rows: SnapRow[]) => {
      const applied = handleApplySnap(rows)
      if (applied > 0 && guide?.stepId === 'snap') guide.advance()
      return applied
    },
    [guide, handleApplySnap]
  )

  /** The Audible lookup the "Snap these to the audio" hint was dismissed for (a new lookup brings it back). */
  const [snapHintDismissedFor, setSnapHintDismissedFor] = useState<typeof lookupResult>(null)
  const showSnapLookupHint = !!lookupResult && snapHintDismissedFor !== lookupResult
  const dismissSnapLookupHint = useCallback(() => setSnapHintDismissedFor(lookupResult), [lookupResult])

  const updateFooterShadow = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const isScrollable = container.scrollHeight > container.clientHeight
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 1
    setFooterShadow(isScrollable && !isAtBottom)
  }, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    updateFooterShadow()
    container.addEventListener('scroll', updateFooterShadow)
    const resizeObserver = new ResizeObserver(updateFooterShadow)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('scroll', updateFooterShadow)
      resizeObserver.disconnect()
    }
  }, [updateFooterShadow])

  useLayoutEffect(() => {
    updateFooterShadow()
  }, [updateFooterShadow, lookupResult, newChapters.length])

  useEffect(() => {
    onPendingChange?.(isPending)
    return () => onPendingChange?.(false)
  }, [isPending, onPendingChange])

  const { destroyAudioEl } = preview
  useEffect(() => {
    return () => {
      destroyAudioEl()
    }
  }, [destroyAudioEl])

  const { showLeaveConfirm, cancelLeave, discardAndLeave, captureLeave } = useUnsavedChangesLeave({
    isDirty: hasChanges,
    closeRequestRef,
    onBeforeLeave: destroyAudioEl
  })

  const handleSaveAndLeave = useCallback(() => {
    handleSave(captureLeave())
  }, [captureLeave, handleSave])

  // Until the proposal is in, edits would be overwritten by it
  const proposalLoading = proposalReview?.status === 'loading'
  const footerDisabled = !hasChanges || isPending || proposalLoading

  const requestConfirmIfDirty = useCallback(
    (proceed: () => void) => {
      if (!hasChanges) {
        proceed()
        return
      }
      setConfirmState({
        message: t.rich('MessageConfirmContinueWithUnsavedChapters', { br: () => <br /> }),
        onConfirm: () => {
          discardFocusedChapterFields()
          setConfirmState(null)
          proceed()
        }
      })
    },
    [discardFocusedChapterFields, hasChanges, setConfirmState, t]
  )

  const handleSetChaptersFromTracksClick = useCallback(() => {
    requestConfirmIfDirty(handleSetChaptersFromTracks)
  }, [handleSetChaptersFromTracks, requestConfirmIfDirty])

  return (
    <>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg" aria-busy={isPending || undefined}>
        {/* The tools and the table scroll together; from md up the table keeps room for a few rows and scrolls its own rows. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" inert={isPending || proposalLoading || undefined}>
          <div className="bg-bg border-border shrink-0 border-b px-4 py-3">
            {seekIndexEnabled && <SeekIndexPanelForState seekIndex={seekIndex} chapterCount={media.chapters?.length ?? 0} className="mb-3" />}
            {proposalReview && (
              <div className="mb-3">
                <PipelineProposalBanner review={proposalReview} disabled={isPending} onReject={handleRejectProposal} />
              </div>
            )}
            <div className="flex w-full flex-wrap items-end justify-between gap-x-2 gap-y-3">
              <div className="w-full min-w-0 md:w-auto">
                <GuideTarget step="lookup">
                  <FindChaptersPanel metadata={media.metadata} onResult={handleGuidedLookupResult} requestProceed={requestConfirmIfDirty} />
                </GuideTarget>
              </div>
              <div className="flex w-full shrink-0 items-end justify-between gap-2 md:contents">
                <ShiftTimesFields
                  shiftAmount={shiftAmount}
                  applyDisabled={!shiftAmount || newChapters.length <= 1}
                  onShiftAmountChange={handleShiftAmountChange}
                  onApplyShift={handleApplyShift}
                />
                <div className="flex shrink-0 items-center gap-1">
                  <Btn size="small" onClick={handleSetChaptersFromTracksClick}>
                    {t('ButtonSetChaptersFromTracks')}
                  </Btn>
                  <HelpTooltipIcon text={t('MessageSetChaptersFromTracksDescription')} />
                </div>
              </div>
            </div>
            <div className="border-border mt-3 border-t pt-3">
              <GuideTarget step="snap">
                <SnapToAudioPanel
                  chapterCount={newChapters.length}
                  disabled={isPending}
                  onSnap={guardedSnap}
                  onRetry={handleSnapRetry}
                  onCheckSpeech={handleSnapSpeechBatch}
                  onApply={handleGuidedApplySnap}
                  onApplyTitles={handleApplySnapTitles}
                  preview={preview}
                  speechCheckAvailable={speechCheckAvailable}
                  showLookupHint={showSnapLookupHint}
                  onLookupHintDismiss={dismissSnapLookupHint}
                  initialSession={proposalReview?.session ?? null}
                />
              </GuideTarget>
            </div>
          </div>

          <div className="relative flex flex-1 flex-col px-4 py-4 md:min-h-[18rem]">
            <ChaptersModalTable
              scrollContainerRef={scrollContainerRef}
              chapters={newChapters}
              dirtyBaseline={dirtyBaseline}
              mediaDuration={mediaDuration}
              addChapterInput={addChapterInput}
              bulkChapterCount={bulkChapterCount}
              selectedKeys={selectedKeys}
              preview={preview}
              tracks={tracks}
              showMatchDebug={showChapterMatchDebug && chapterMatchDebugActive}
              chapterMatchDebug={chapterMatchDebug}
              titleResetKey={titleResetKey}
              onAddChapterInputChange={setAddChapterInput}
              onBulkChapterCountChange={setBulkChapterCount}
              onAddChapter={handleAddChapterFromInput}
              onToggleAllSelected={handleToggleAllChaptersSelected}
              onChapterCheckedChange={handleChapterCheckedChange}
              onChapterStartChange={handleChapterStartChange}
              onChapterTitleDraft={handleChapterTitleDraft}
              onChapterTitleCommit={handleChapterTitleCommit}
              onChapterRemove={handleChapterRemove}
              onChapterInsertBelow={handleChapterInsertBelow}
              onRemoveSelected={handleRemoveSelected}
            />

            {(isPending || proposalLoading) && (
              <div className="bg-bg/50 absolute inset-0 z-10 flex items-center justify-center">
                <LoadingIndicator variant="inline" />
              </div>
            )}
          </div>
        </div>

        <div
          className={mergeClasses(
            'bg-bg border-border flex shrink-0 flex-wrap items-end gap-x-4 gap-y-3 border-t px-4 py-3 transition-shadow duration-200',
            footerShadow && 'box-shadow-md-up'
          )}
        >
          {lookupResult && lookupResultForPreview && (
            <div className="grid w-full min-w-0 basis-full grid-cols-2 items-start gap-3 md:flex md:w-auto md:min-w-0 md:flex-1 md:basis-auto md:flex-col md:gap-0">
              <div className="min-w-0 md:w-full">
                <LookupComparison lookupResult={lookupResultForPreview} baselineCount={lookupBaselineCount} mediaDurationRounded={mediaDurationRounded} />
              </div>
              <div className="flex min-w-0 flex-col gap-y-1 md:mt-2 md:w-full md:flex-row md:flex-wrap md:items-center md:gap-x-4">
                {canMapChapterTitles && (
                  <div className="flex items-center gap-2">
                    <Checkbox value={mapChapterTitles} label={t('ButtonMapChapterTitles')} size="small" onChange={handleMapChapterTitlesChange} />
                    <HelpTooltipIcon text={t('MessageMapChapterTitles')} />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Checkbox value={removeBranding} label={t('LabelRemoveAudibleBrandingShort')} size="small" onChange={handleRemoveBrandingChange} />
                  <HelpTooltipIcon text={t('LabelRemoveAudibleBranding')} />
                </div>
              </div>
            </div>
          )}
          <div className="ms-auto flex w-full shrink-0 justify-end gap-3 md:w-auto">
            <Btn
              size="small"
              disabled={footerDisabled}
              onClick={() => {
                blurActiveChapterEditorField()
                destroyAudioEl()
                setConfirmState({
                  message: t('MessageDiscardChaptersConfirm'),
                  onConfirm: () => {
                    setConfirmState(null)
                    resetEditorChapters()
                  }
                })
              }}
            >
              {t('ButtonDiscardChanges')}
            </Btn>
            <GuideTarget step="save">
              <Btn
                color="bg-success text-success-foreground"
                size="small"
                loading={isPending}
                disabled={footerDisabled}
                onClick={() => handleSave(guide?.stepId === 'save' ? guide.advance : undefined)}
              >
                {t('ButtonSave')}
              </Btn>
            </GuideTarget>
          </div>
        </div>
      </div>

      <SeekIndexSnapDialog
        isOpen={!!snapGuard}
        fileCount={snapGuard?.status.needsRepairCount ?? 0}
        maxDrift={snapGuard?.status.maxDrift ?? 0}
        chapterCount={newChapters.length}
        onChoose={(choice) => snapGuard?.resolve(choice)}
      />

      {confirmState && <ConfirmDialog isOpen message={confirmState.message} onClose={() => setConfirmState(null)} onConfirm={() => confirmState.onConfirm()} />}

      <ConfirmDialog
        isOpen={showLeaveConfirm}
        message={t('MessageConfirmCloseChaptersWithChanges')}
        altButtonText={t('ButtonDiscard')}
        yesButtonText={t('ButtonSave')}
        processing={isPending}
        onClose={cancelLeave}
        onAlt={discardAndLeave}
        onConfirm={handleSaveAndLeave}
      />
    </>
  )
}

export function ChaptersEditModalBody({ closeRequestRef, onPendingChange }: ChaptersEditModalBodyProps) {
  const { resolvedItem, fetchPending, syncResolvedItem } = useLibraryItemModal()
  const showLoading = fetchPending && !resolvedItem
  const bookItem = resolvedItem?.mediaType === 'book' && isBookMediaWithTracks(resolvedItem.media) ? (resolvedItem as BookLibraryItem) : null

  if (showLoading) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg">
        <div className="flex flex-1 items-center justify-center">
          <LoadingIndicator variant="inline" />
        </div>
      </div>
    )
  }

  if (!bookItem) return null

  return (
    <ChaptersEditContent
      key={bookItem.id}
      libraryItem={bookItem}
      closeRequestRef={closeRequestRef}
      onPendingChange={onPendingChange}
      onItemUpdated={syncResolvedItem}
    />
  )
}
