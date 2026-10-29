'use client'

import { cancelEpubJobAction, getCurrentEpubJobAction, getEpubJobAction, startEpubJobAction } from '@/app/actions/epubActions'
import AddToCollectionModal from '@/components/modals/AddToCollectionModal'
import AddToPlaylistModal from '@/components/modals/AddToPlaylistModal'
import PodcastCheckNewEpisodesModal from '@/components/modals/PodcastCheckNewEpisodesModal'
import PodcastDownloadScheduleModal from '@/components/modals/PodcastDownloadScheduleModal'
import RssFeedOpenCloseModal from '@/components/modals/RssFeedOpenCloseModal'
import ShareModal from '@/components/modals/ShareModal'
import Btn from '@/components/ui/Btn'
import ContextMenuDropdown, { type ContextMenuDropdownItem } from '@/components/ui/ContextMenuDropdown'
import IconBtn from '@/components/ui/IconBtn'
import ReadIconBtn from '@/components/ui/ReadIconBtn'
import Tooltip from '@/components/ui/Tooltip'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import EpubFromAudio, { type EpubFromAudioActions } from '@/components/widgets/EpubFromAudio'
import type { MediaCardMoreMenuSubitem } from '@/components/widgets/media-card/MediaCardMoreMenu'
import { useMediaCardActions } from '@/components/widgets/media-card/useMediaCardActions'
import { useEreader } from '@/contexts/EreaderContext'
import { useLibrary } from '@/contexts/LibraryContext'
import { useMediaContext } from '@/contexts/MediaContext'
import { useSocketEvent } from '@/contexts/SocketContext'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useUser } from '@/contexts/UserContext'
import { useServerFeature } from '@/hooks/useServerFeatures'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { withBasePath } from '@/lib/basePath'
import { canMakeEpubFromAudio, findEpubFromAudioFile, toEpubJob } from '@/lib/epubFromAudio'
import { getEbookFormat } from '@/lib/ereader/ereaderEbook'
import { PlayerState, type BookLibraryItem, type EpubJob, type PodcastLibraryItem, type RssFeed } from '@/types/api'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'

const EPUB_FROM_AUDIO_ACTION = 'makeEpubFromAudio'

const epubFromAudioActions: EpubFromAudioActions = {
  start: startEpubJobAction,
  get: getEpubJobAction,
  cancel: cancelEpubJobAction,
  getCurrent: getCurrentEpubJobAction
}

interface LibraryItemActionButtonsProps {
  libraryItem: BookLibraryItem | PodcastLibraryItem
  onEdit: () => void
  onOpenMatch?: () => void
  /** Current RSS feed state (from useItemPageSocket + initial server data). */
  rssFeed?: RssFeed | null
  showPlayButton: boolean
  isItemPlaying: boolean
  onPlay: () => void
}

export default function LibraryItemActionButtons({
  libraryItem,
  onEdit,
  onOpenMatch,
  rssFeed = null,
  showPlayButton,
  isItemPlaying,
  onPlay
}: LibraryItemActionButtonsProps) {
  const { userCanUpdate, getMediaItemProgress, ereaderDevices } = useUser()
  const {
    libraryItemIdStreaming,
    streamLibraryItem,
    isStreaming: isStreamingFn,
    isStreamingFromDifferentLibrary,
    getIsMediaQueued,
    addItemToQueue,
    removeItemFromQueue,
    playerControls,
    playerLoadState
  } = useMediaContext()
  const t = useTypeSafeTranslations()
  const router = useRouter()
  const { showToast } = useGlobalToast()

  // EPUB from audio: only when the server advertises it (never on a stock server). Starting needs canUpdate; the
  // progress shows for every viewer when the server can name the item's job (`chapterbotEpubCurrent`).
  const epubFromAudioAvailable = useServerFeature('chapterbotEpub')
  const epubCurrentAvailable = useServerFeature('chapterbotEpubCurrent')
  const canMakeEpub = canMakeEpubFromAudio(libraryItem)
  const showEpubFromAudio = epubFromAudioAvailable && userCanUpdate && canMakeEpub
  const epubFromAudioFile = useMemo(() => (libraryItem.mediaType === 'book' ? findEpubFromAudioFile(libraryItem) : null), [libraryItem])
  const showEpubWidget = showEpubFromAudio || (canMakeEpub && epubCurrentAvailable) || !!epubFromAudioFile
  const { openEreader } = useEreader()
  const { library } = useLibrary()
  const [epubConfirmOpen, setEpubConfirmOpen] = useState(false)
  const [epubJobEvent, setEpubJobEvent] = useState<EpubJob | null>(null)
  const extraToolSubitems = useMemo<MediaCardMoreMenuSubitem[] | undefined>(
    () => (showEpubFromAudio ? [{ text: t('ButtonMakeEpubFromAudio'), func: EPUB_FROM_AUDIO_ACTION }] : undefined),
    [showEpubFromAudio, t]
  )
  const handleEpubJobEvent = useCallback((data: unknown) => {
    const job = toEpubJob(data)
    if (job) setEpubJobEvent(job)
  }, [])
  useSocketEvent<unknown>('chapterbot_epub_done', handleEpubJobEvent)
  useSocketEvent<unknown>('chapterbot_epub_failed', handleEpubJobEvent)
  useSocketEvent<unknown>('chapterbot_epub_updated', handleEpubJobEvent)
  const notifyEpub = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info') => showToast(message, { type }), [showToast])
  // The server rescans the item (item_updated); refresh as well so the new ebook shows even if that event is missed
  const handleEpubFinished = useCallback(() => router.refresh(), [router])
  const epubReady = useMemo(() => (epubFromAudioFile ? { fileName: epubFromAudioFile.metadata.filename } : null), [epubFromAudioFile])
  const handleReadEpubFromAudio = useCallback(() => {
    if (!epubFromAudioFile) return
    openEreader({
      libraryItemId: libraryItem.id,
      title: libraryItem.media.metadata.title ?? epubFromAudioFile.metadata.filename,
      ebookFormat: 'epub',
      epubsAllowScriptedContent: !!library.settings?.epubsAllowScriptedContent,
      fileId: epubFromAudioFile.ino,
      // Progress belongs to the primary ebook; a supplementary EPUB is read without it (as in the ebook files table)
      keepProgress: libraryItem.mediaType === 'book' && libraryItem.media.ebookFile?.ino === epubFromAudioFile.ino
    })
  }, [epubFromAudioFile, library.settings?.epubsAllowScriptedContent, libraryItem, openEreader])

  const mediaProgress = libraryItem.media?.id ? getMediaItemProgress(libraryItem.media.id) : undefined
  const isRead = mediaProgress?.isFinished ?? false

  const isPodcast = libraryItem.mediaType === 'podcast'
  const isBook = libraryItem.mediaType === 'book'
  const bookMedia = !isPodcast ? libraryItem.media : null
  const podcastMedia = isPodcast ? libraryItem.media : null
  const podcastEpisodes = useMemo(() => (isPodcast ? (podcastMedia?.episodes ?? []) : []), [isPodcast, podcastMedia?.episodes])
  const ebookFormat = bookMedia ? getEbookFormat(bookMedia) : undefined

  const showQueueBtn = isBook && !!streamLibraryItem && !isStreamingFromDifferentLibrary(libraryItem.libraryId)
  const isQueued = getIsMediaQueued(libraryItem.id, null)
  const showReadButton = !!ebookFormat
  const isStreamingFromDifferentLib = isStreamingFromDifferentLibrary(libraryItem.libraryId)

  const {
    processing,
    confirmState,
    rssFeedModalOpen,
    scheduleModalOpen,
    checkNewEpisodesModalOpen,
    shareModalOpen,
    collectionsModalOpen,
    playlistsModalOpen,
    mediaItemShare,
    closeConfirm,
    closeRssFeedModal,
    closeScheduleModal,
    closeCheckNewEpisodesModal,
    closeShareModal,
    closeCollectionsModal,
    closePlaylistsModal,
    handleShareChange,
    handleReadEBook,
    handleMoreAction,
    moreMenuItems
  } = useMediaCardActions({
    libraryItem,
    media: libraryItem.media,
    title: libraryItem.media.metadata.title ?? '',
    author: 'authors' in libraryItem.media.metadata ? (libraryItem.media.metadata.authors ?? []).map((a) => a.name).join(', ') : null,
    episode: null,
    mediaProgress,
    itemIsFinished: isRead,
    userProgressPercent: mediaProgress?.progress ?? 0,
    isPodcast,
    ereaderDevices,
    continueListeningShelf: false,
    libraryItemIdStreaming,
    isStreaming: isStreamingFn,
    isStreamingFromDifferentLib,
    isQueued,
    initialShare: libraryItem.mediaItemShare ?? null,
    onDeleteSuccess: () => {
      window.location.href = withBasePath(`/library/${libraryItem.libraryId}`)
    },
    onOpenMatch,
    playerControls,
    extraToolSubitems
  })

  const handleQueueClick = useCallback(() => {
    if (isQueued) {
      removeItemFromQueue({ libraryItemId: libraryItem.id, episodeId: null })
      return
    }

    const title = libraryItem.media.metadata.title ?? ''
    const subtitle = 'authors' in libraryItem.media.metadata ? (libraryItem.media.metadata.authors ?? []).map((a) => a.name).join(', ') : ''
    addItemToQueue({
      libraryItemId: libraryItem.id,
      libraryId: libraryItem.libraryId,
      episodeId: null,
      title,
      subtitle,
      caption: '',
      duration: isBook ? (libraryItem.media.duration ?? null) : null,
      coverPath: libraryItem.media.coverPath ?? null
    })
  }, [addItemToQueue, isBook, isQueued, libraryItem, removeItemFromQueue])

  const handleToggleFinished = useCallback(() => {
    handleMoreAction('toggleFinished')
  }, [handleMoreAction])

  const contextMenuItems = useMemo<ContextMenuDropdownItem<string>[]>(() => {
    return moreMenuItems
      .filter((item) => item.func !== 'toggleFinished' && item.func !== 'addToQueue' && item.func !== 'removeFromQueue')
      .map((item) => ({
        text: item.text,
        action: item.func ?? '',
        subitems: item.subitems?.map((subitem) => ({
          text: subitem.text,
          action: subitem.func,
          data: subitem.data
        }))
      }))
  }, [moreMenuItems])

  const handleContextMenuAction = useCallback(
    ({ action, data }: { action: string; data?: Record<string, string> }) => {
      if (action === EPUB_FROM_AUDIO_ACTION) {
        setEpubConfirmOpen(true)
        return
      }
      handleMoreAction(action, data)
    },
    [handleMoreAction]
  )

  const hasContextMenu = contextMenuItems.length > 0

  return (
    <>
      <div className="flex flex-wrap items-center justify-start gap-1 pt-4">
        {showPlayButton && (
          <Btn
            onClick={onPlay}
            loading={playerLoadState === PlayerState.LOADING}
            color="bg-success text-success-foreground"
            size="small"
            className="mr-2 flex h-9 items-center px-4"
          >
            <span className="material-symbols fill -ml-2 pr-1 text-2xl">{isItemPlaying ? 'pause' : 'play_arrow'}</span>
            {isItemPlaying ? t('ButtonPause') : t('ButtonPlay')}
          </Btn>
        )}

        {!showPlayButton && (libraryItem.isMissing || libraryItem.isInvalid) && (
          <Btn color="bg-error text-error-foreground" size="small" className="mr-2 flex h-9 cursor-default items-center px-4" aria-disabled>
            <span className="material-symbols -ml-2 pr-1 text-2xl">error</span>
            {libraryItem.isMissing ? t('LabelMissing') : t('LabelIncomplete')}
          </Btn>
        )}

        {showReadButton && (
          <Btn onClick={handleReadEBook} color="bg-info" size="small" className="mr-2 flex h-9 items-center px-4 text-white">
            <span className="material-symbols -ml-2 pr-2 text-2xl" aria-hidden>
              auto_stories
            </span>
            {t('ButtonRead')}
          </Btn>
        )}

        {showQueueBtn && (
          <Tooltip text={isQueued ? t('ButtonQueueRemoveItem') : t('ButtonQueueAddItem')} position="top">
            <span className="inline-flex">
              <IconBtn
                ariaLabel={isQueued ? t('ButtonQueueRemoveItem') : t('ButtonQueueAddItem')}
                onClick={handleQueueClick}
                outlined={!isQueued}
                className={isQueued ? 'bg-primary text-success mx-0.5' : 'bg-success/60 mx-0.5'}
                size="small"
              >
                {isQueued ? 'playlist_add_check' : 'playlist_play'}
              </IconBtn>
            </span>
          </Tooltip>
        )}

        {userCanUpdate && (
          <Tooltip text={t('LabelEdit')} position="top">
            <span className="inline-flex">
              <IconBtn ariaLabel={t('LabelEdit')} onClick={onEdit} outlined className="mx-0.5" size="small">
                edit
              </IconBtn>
            </span>
          </Tooltip>
        )}

        {!isPodcast && (
          <Tooltip text={isRead ? t('MessageMarkAsNotFinished') : t('MessageMarkAsFinished')} position="top">
            <span className="inline-flex">
              <ReadIconBtn isRead={isRead} disabled={processing} onClick={handleToggleFinished} className="mx-0.5" size="small" />
            </span>
          </Tooltip>
        )}

        {hasContextMenu && (
          <ContextMenuDropdown
            items={contextMenuItems}
            menuWidth={148}
            onAction={handleContextMenuAction}
            size="small"
            className="bg-primary mx-0.5 h-9 w-9 border border-gray-600"
          />
        )}
      </div>

      {showEpubWidget && (
        <EpubFromAudio
          libraryItemId={libraryItem.id}
          bookTitle={libraryItem.media.metadata.title ?? ''}
          confirmOpen={epubConfirmOpen && showEpubFromAudio}
          onConfirmClose={() => setEpubConfirmOpen(false)}
          actions={epubFromAudioActions}
          notify={notifyEpub}
          jobEvent={epubJobEvent}
          onFinished={handleEpubFinished}
          currentJobAvailable={epubCurrentAvailable}
          canUpdate={showEpubFromAudio}
          readyEbook={epubReady}
          onReadEbook={handleReadEpubFromAudio}
        />
      )}

      {confirmState && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          message={confirmState.message}
          checkboxLabel={confirmState.checkboxLabel}
          yesButtonText={confirmState.yesButtonText}
          yesButtonClassName={confirmState.yesButtonClassName}
          onClose={closeConfirm}
          onConfirm={(value) => {
            confirmState.onConfirm(value)
          }}
        />
      )}
      <RssFeedOpenCloseModal
        isOpen={rssFeedModalOpen}
        onClose={closeRssFeedModal}
        entity={{
          id: libraryItem.id,
          name: libraryItem.media.metadata.title ?? '',
          type: 'item',
          feed: rssFeed ?? null,
          hasEpisodesWithoutPubDate: isPodcast && podcastEpisodes.some((ep) => !ep.pubDate)
        }}
      />
      {isPodcast && <PodcastDownloadScheduleModal isOpen={scheduleModalOpen} onClose={closeScheduleModal} libraryItem={libraryItem as PodcastLibraryItem} />}
      {isPodcast && (
        <PodcastCheckNewEpisodesModal isOpen={checkNewEpisodesModalOpen} onClose={closeCheckNewEpisodesModal} libraryItem={libraryItem as PodcastLibraryItem} />
      )}
      <ShareModal
        isOpen={shareModalOpen}
        onClose={closeShareModal}
        mediaItemId={libraryItem.media.id ?? ''}
        mediaItemShare={mediaItemShare}
        onShareChange={handleShareChange}
      />
      {collectionsModalOpen && (
        <AddToCollectionModal
          isOpen={collectionsModalOpen}
          onClose={closeCollectionsModal}
          libraryId={libraryItem.libraryId}
          libraryItemIds={[libraryItem.id]}
          itemTitle={libraryItem.media.metadata.title ?? ''}
        />
      )}
      {playlistsModalOpen && (
        <AddToPlaylistModal
          isOpen={playlistsModalOpen}
          onClose={closePlaylistsModal}
          libraryId={libraryItem.libraryId}
          items={[{ libraryItemId: libraryItem.id, episodeId: null }]}
          headerTitle={libraryItem.media.metadata.title ?? ''}
        />
      )}
    </>
  )
}
