'use client'

import { updatePodcastEpisodeAction } from '@/app/actions/mediaActions'
import EpisodeModal, { useEpisodeModal, type EpisodeModalItemSource } from '@/components/modals/EpisodeModal'
import type { UnsavedChangesLeaveHandle } from '@/components/modals/LibraryItemModal'
import ModalFooter from '@/components/modals/ModalFooter'
import LoadingIndicator from '@/components/ui/LoadingIndicator'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import EpisodeDetailsEdit, { type EpisodeDetailsEditRef, type EpisodeDetailsEditSubmitResult } from '@/components/widgets/EpisodeDetailsEdit'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { useUnsavedChangesLeave } from '@/hooks/useUnsavedChangesLeave'
import type { PodcastEpisode, PodcastLibraryItem } from '@/types/api'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type Ref, type TransitionStartFunction } from 'react'

export type EpisodeEditModalProps = {
  isOpen: boolean
  onClose: () => void
  onSaved?: (episode: PodcastEpisode, libraryItem: PodcastLibraryItem) => void
} & EpisodeModalItemSource

type EpisodeEditModalContentProps = {
  isOpen: boolean
  startSaveTransition: TransitionStartFunction
  isSavePending: boolean
  onClose: () => void
  onSaved?: (episode: PodcastEpisode, libraryItem: PodcastLibraryItem) => void
  stableBodyHeight: boolean
  /** Lets the parent intercept leave (close, prev/next) while the episode is dirty. */
  closeRequestRef?: Ref<UnsavedChangesLeaveHandle | null>
}

function createPlaceholderEpisode(episodeId: string, libraryItemId: string): PodcastEpisode {
  return {
    id: episodeId,
    libraryItemId,
    podcastId: libraryItemId,
    title: '',
    chapters: [],
    addedAt: 0,
    updatedAt: 0
  }
}

function EpisodeEditModalContent({
  isOpen,
  startSaveTransition,
  isSavePending,
  onClose,
  onSaved,
  stableBodyHeight,
  closeRequestRef
}: EpisodeEditModalContentProps) {
  const { resolvedEpisode, resolvedLibraryItem, fetchPending, pendingEpisodeId, syncResolvedEpisode } = useEpisodeModal()
  const t = useTypeSafeTranslations()
  const { showToast } = useGlobalToast()
  const [hasChanges, setHasChanges] = useState(false)
  const saveAndCloseRef = useRef(false)
  const detailsRef = useRef<EpisodeDetailsEditRef>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [footerShadow, setFooterShadow] = useState(false)
  const { showLeaveConfirm, cancelLeave, discardAndLeave, completePendingLeave } = useUnsavedChangesLeave({ isDirty: hasChanges, closeRequestRef })

  const resolvedEpisodeId = resolvedEpisode?.id

  useEffect(() => {
    if (!isOpen) {
      setHasChanges(false)
      saveAndCloseRef.current = false
    }
  }, [isOpen])

  useEffect(() => {
    if (!resolvedEpisodeId) return
    setHasChanges(false)
    saveAndCloseRef.current = false
  }, [resolvedEpisodeId])

  useEffect(() => {
    setHasChanges(false)
  }, [pendingEpisodeId])

  const updateFooterShadow = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    const isScrollable = container.scrollHeight > container.clientHeight
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 1
    setFooterShadow(isScrollable && !isAtBottom)
  }, [])

  useEffect(() => {
    if (!isOpen) return
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
  }, [isOpen, updateFooterShadow])

  useLayoutEffect(() => {
    if (!isOpen) return
    updateFooterShadow()
  }, [isOpen, resolvedEpisodeId, pendingEpisodeId, fetchPending, updateFooterShadow])

  const handleChange = useCallback((_details: { episodeId: string; hasChanges: boolean }) => {
    setHasChanges(_details.hasChanges)
  }, [])

  const handleSubmit = useCallback(
    (result: EpisodeDetailsEditSubmitResult) => {
      if (result.invalidPubDate) {
        showToast(t('ToastDateTimeInvalidOrIncomplete'), { type: 'error' })
        return
      }

      const libraryItemId = resolvedLibraryItem?.id
      const episodeId = resolvedEpisode?.id
      if (!libraryItemId || !episodeId) return

      if (!result.hasChanges) {
        if (completePendingLeave()) return
        if (saveAndCloseRef.current) {
          saveAndCloseRef.current = false
          onClose()
        } else {
          showToast(t('ToastNoUpdatesNecessary'), { type: 'info' })
        }
        return
      }

      const shouldCloseAfterSave = saveAndCloseRef.current

      startSaveTransition(async () => {
        try {
          const updateResult = await updatePodcastEpisodeAction(libraryItemId, episodeId, result.updatePayload)
          if (!updateResult.ok) {
            showToast(updateResult.error || t('ToastFailedToUpdate'), { type: 'error' })
            return
          }
          const updatedLibraryItem = updateResult.data
          const updatedEpisode = updatedLibraryItem.media.episodes?.find((ep) => ep.id === episodeId)
          if (!updatedEpisode) {
            throw new Error('Updated episode not found in response')
          }
          showToast(t('ToastItemUpdateSuccess'), { type: 'success' })
          syncResolvedEpisode(updatedEpisode, updatedLibraryItem)
          onSaved?.(updatedEpisode, updatedLibraryItem)
          setHasChanges(false)
          if (completePendingLeave()) return
          if (shouldCloseAfterSave) {
            saveAndCloseRef.current = false
            onClose()
          }
        } catch (error) {
          console.error('Failed to update episode', error)
          showToast(t('ToastFailedToUpdate'), { type: 'error' })
        }
      })
    },
    [completePendingLeave, onClose, onSaved, resolvedEpisode?.id, resolvedLibraryItem?.id, showToast, startSaveTransition, syncResolvedEpisode, t]
  )

  const handleSave = (close: boolean = false) => {
    saveAndCloseRef.current = close
    detailsRef.current?.submit()
  }

  const saveDisabled = !hasChanges || isSavePending || !resolvedEpisode || fetchPending

  const showPlaceholderShell = fetchPending && !resolvedEpisode && pendingEpisodeId !== null
  const placeholderEpisode =
    showPlaceholderShell && pendingEpisodeId && resolvedLibraryItem
      ? createPlaceholderEpisode(pendingEpisodeId, resolvedLibraryItem.id)
      : showPlaceholderShell && pendingEpisodeId
        ? createPlaceholderEpisode(pendingEpisodeId, '')
        : null

  const fetchLoadingOverlay = (
    <div className="bg-bg/50 absolute inset-0 z-10 flex items-center justify-center">
      <LoadingIndicator variant="inline" />
    </div>
  )

  const formInner = resolvedEpisode ? (
    <EpisodeDetailsEdit key={resolvedEpisode.id} ref={detailsRef} episode={resolvedEpisode} onChange={handleChange} onSubmit={handleSubmit} />
  ) : showPlaceholderShell && placeholderEpisode ? (
    <div className="relative">
      <EpisodeDetailsEdit
        key={`placeholder-episode-${pendingEpisodeId}`}
        ref={detailsRef}
        episode={placeholderEpisode}
        onChange={handleChange}
        onSubmit={handleSubmit}
      />
      {fetchLoadingOverlay}
    </div>
  ) : fetchPending ? (
    <div className="flex min-h-96 items-center justify-center">
      <LoadingIndicator variant="inline" />
    </div>
  ) : null

  return (
    <div
      className={
        stableBodyHeight
          ? 'bg-bg border-border flex max-h-[80vh] w-full flex-col overflow-hidden rounded-lg border'
          : 'bg-bg border-border flex max-h-[85vh] w-full flex-col rounded-lg border'
      }
    >
      <div ref={scrollContainerRef} className="min-h-0 overflow-x-hidden overflow-y-auto">
        {formInner}
      </div>

      <ModalFooter
        shadow={footerShadow}
        secondary={{
          label: t('ButtonSave'),
          onClick: () => handleSave(false),
          disabled: saveDisabled,
          className: 'hidden md:inline-flex'
        }}
        primary={{
          label: (
            <>
              <span className="hidden md:inline">{t('ButtonSaveAndClose')}</span>
              <span className="md:hidden">{t('ButtonSave')}</span>
            </>
          ),
          onClick: () => handleSave(true),
          disabled: saveDisabled
        }}
      />

      <ConfirmDialog
        isOpen={showLeaveConfirm}
        message={t('MessageConfirmCloseDetailsWithChanges')}
        altButtonText={t('ButtonDiscard')}
        yesButtonText={t('ButtonSave')}
        processing={isSavePending}
        onClose={cancelLeave}
        onAlt={discardAndLeave}
        onConfirm={() => handleSave(false)}
      />
    </div>
  )
}

/**
 * Modal for editing podcast episode metadata.
 * Pass `navCtx` to load episodes and enable prev/next, or `libraryItem` + `episode` for direct mode.
 */
export default function EpisodeEditModal(props: EpisodeEditModalProps) {
  const { isOpen, onClose, onSaved } = props
  const navCtxMode = 'navCtx' in props
  const [isSavePending, startSaveTransition] = useTransition()
  const closeRequestRef = useRef<UnsavedChangesLeaveHandle | null>(null)

  const requestLeaveOrProceed = useCallback((proceed: () => void) => {
    if (closeRequestRef.current) closeRequestRef.current.requestLeave(proceed)
    else proceed()
  }, [])

  const handleClose = useCallback(() => requestLeaveOrProceed(onClose), [onClose, requestLeaveOrProceed])

  return (
    <EpisodeModal
      isOpen={isOpen}
      onClose={handleClose}
      {...(navCtxMode ? { navCtx: props.navCtx } : { libraryItem: props.libraryItem, episode: props.episode })}
      additionalProcessing={isSavePending}
      className="sm:max-w-(--content-vw) md:max-w-[800px]"
      onBeforeNavigate={requestLeaveOrProceed}
    >
      <EpisodeEditModalContent
        isOpen={isOpen}
        startSaveTransition={startSaveTransition}
        isSavePending={isSavePending}
        // Unguarded: footer Save and Close must not re-enter requestLeave.
        onClose={onClose}
        onSaved={onSaved}
        stableBodyHeight={navCtxMode}
        closeRequestRef={closeRequestRef}
      />
    </EpisodeModal>
  )
}
