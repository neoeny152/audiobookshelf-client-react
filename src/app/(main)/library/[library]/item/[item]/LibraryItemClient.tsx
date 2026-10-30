'use client'

import { startEpubJobAction } from '@/app/actions/epubActions'
import { clearPodcastDownloadQueueAction } from '@/app/actions/mediaActions'
import { getItemHealthAction, runItemPipelineAction, updateLibraryAutoPipelineAction } from '@/app/actions/pipelineActions'
import LibraryItemMetadataEditModal, { type MetadataEditSection } from '@/components/modals/LibraryItemMetadataEditModal'
import IconBtn from '@/components/ui/IconBtn'
import AudioTracksTable from '@/components/widgets/AudioTracksTable'
import ChaptersTable from '@/components/widgets/ChaptersTable'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import EbookFilesTable from '@/components/widgets/EbookFilesTable'
import EpisodeTable from '@/components/widgets/EpisodeTable'
import AuthorLinks from '@/components/widgets/AuthorLinks'
import ExpandableHtml from '@/components/widgets/ExpandableHtml'
import LibraryFilesTable from '@/components/widgets/LibraryFilesTable'
import LoadingSpinner from '@/components/widgets/LoadingSpinner'
import GuidedFixHint, { type GuidedFixActions } from '@/components/widgets/guided-fix/GuidedFixHint'
import PipelineStatusChip from '@/components/widgets/pipeline/PipelineStatusChip'
import { useSeekIndexEnabled } from '@/components/widgets/seek-index/SeekIndexWarning'
import TranscriptSection from '@/components/widgets/transcripts/TranscriptSection'
import { GuidedFixContext } from '@/contexts/GuidedFixContext'
import { useLibrary } from '@/contexts/LibraryContext'
import { PipelineProposalContext } from '@/contexts/PipelineProposalContext'
import { useTasks } from '@/contexts/TasksContext'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useUser } from '@/contexts/UserContext'
import { useCoverAccentColor } from '@/hooks/useCoverAccentColor'
import { useGuidancePreference } from '@/hooks/useGuidancePreference'
import { useItemHealth } from '@/hooks/useItemHealth'
import { useItemPageSocket } from '@/hooks/useItemPageSocket'
import { useItemPipelineState } from '@/hooks/useItemPipelineState'
import { useSeekIndex } from '@/hooks/useSeekIndex'
import { useServerFeature } from '@/hooks/useServerFeatures'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { getPipelineReviewHref, getProcessingHref, getPipelineTab, isPipelineActive } from '@/lib/autoPipeline'
import { getLibraryItemCoverUrl } from '@/lib/coverUtils'
import { secondsToTimestamp } from '@/lib/datefns'
import { canMakeEpubFromAudio, findEpubFromAudioFile } from '@/lib/epubFromAudio'
import { getGuidancePreference, getGuideSteps, isGuidedFixDismissed, rememberGuidedFixDismissed, type EpubOffer, type GuideStepId } from '@/lib/itemHealth'
import { mergeLibraryItemUpdate } from '@/lib/libraryItemUpdatedUtils'
import { computeProgress } from '@/lib/mediaProgress'
import { BookLibraryItem, BookMetadata, ItemHealthIssue, PodcastEpisode, PodcastLibraryItem, PodcastMetadata } from '@/types/api'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import LibraryItemActionButtons from './LibraryItemActionButtons'
import LibraryItemCover from './LibraryItemCover'
import LibraryItemDetails from './LibraryItemDetails'
import LibraryItemProgressPanel from './LibraryItemProgressPanel'
import { useLibraryItemPagePlay } from './useLibraryItemPagePlay'

const EDIT_SECTIONS: readonly MetadataEditSection[] = ['details', 'cover', 'chapters', 'match']

interface LibraryItemClientProps {
  libraryItem: BookLibraryItem | PodcastLibraryItem
}

export default function LibraryItemClient({ libraryItem: initialLibraryItem }: LibraryItemClientProps) {
  const { library } = useLibrary()
  const { serverSettings, getMediaItemProgress, userCanUpdate, userIsAdminOrUp } = useUser()
  const { showToast } = useGlobalToast()
  const t = useTypeSafeTranslations()

  const [libraryItem, setLibraryItem] = useState(initialLibraryItem)
  const [metadataEditSection, setMetadataEditSection] = useState<MetadataEditSection | null>(null)
  /** Set while the chapter editor reviews the auto pipeline's proposal for this item. */
  const [proposalItemId, setProposalItemId] = useState<string | null>(null)
  const handleProposalResolved = useCallback(() => setProposalItemId(null), [])
  const proposalTarget = useMemo(
    () => (proposalItemId ? { itemId: proposalItemId, onResolved: handleProposalResolved } : null),
    [handleProposalResolved, proposalItemId]
  )
  const [isClearQueueDialogOpen, setIsClearQueueDialogOpen] = useState(false)
  const [podcastEpisodesInOrder, setPodcastEpisodesInOrder] = useState<PodcastEpisode[]>([])
  const handlePodcastEpisodesInOrderChange = useCallback((episodes: PodcastEpisode[]) => {
    setPodcastEpisodesInOrder(episodes)
  }, [])

  const { handlePlay, showPlayButton, isItemPlaying, handleGoToTimestamp, pendingStartTime, handleCloseStartTime, handleConfirmStartTime } =
    useLibraryItemPagePlay({
      libraryItem,
      podcastEpisodesInOrder
    })

  useEffect(() => {
    setLibraryItem(initialLibraryItem)
  }, [initialLibraryItem])

  // Auto pipeline status (fork only): for users who can act on it from the Processing page
  const autoPipelineAvailable = useServerFeature('autoPipeline')
  const pipelineState = useItemPipelineState(libraryItem.id, autoPipelineAvailable && userCanUpdate && libraryItem.mediaType === 'book')

  const isPodcast = libraryItem.mediaType === 'podcast'
  const isBookWithAudio = libraryItem.mediaType === 'book' && ((libraryItem as BookLibraryItem).media.tracks?.length ?? 0) > 0

  // Guided fix (fork only): for admins, a hint that sends them to Edit, which starts Guide me, unless they turned guidance
  // off. The first look measures MP3s without a seek header.
  const seekIndexEnabled = useSeekIndexEnabled()
  const guidanceOff = useGuidancePreference() === 'off'
  const { health, reload: reloadHealth } = useItemHealth(libraryItem.id, { enabled: seekIndexEnabled && isBookWithAudio && !guidanceOff, measure: true })
  const [guide, setGuide] = useState<{ steps: GuideStepId[]; index: number } | null>(null)
  /** A guide just ended and no guidance preference is set: the hint asks what to do next time */
  const [askNextTime, setAskNextTime] = useState(false)
  /** The issue set dismissed here (also kept in storage, which may be unavailable) */
  const [dismissedIssues, setDismissedIssues] = useState<string | null>(null)
  const hintDismissed = !!health && (dismissedIssues === health.issues.join(',') || isGuidedFixDismissed(libraryItem.id, health.issues))
  const dismissHint = useCallback(
    (issues: ItemHealthIssue[]) => {
      rememberGuidedFixDismissed(libraryItem.id, issues)
      setDismissedIssues(issues.join(','))
    },
    [libraryItem.id]
  )
  // Edit starts the guide while the hint shows (not while the pipeline works on the book)
  const needsGuide =
    !!health &&
    !guide &&
    !hintDismissed &&
    !(pipelineState && isPipelineActive(pipelineState.status)) &&
    health.issues.some((issue) => issue !== 'chapters-unverified')
  // The guide's optional last step: a read-along EPUB from the audio for a book without an EPUB (see EpubOffer)
  const epubFromAudioAvailable = useServerFeature('chapterbotEpub')
  const epubOffer: EpubOffer | null =
    epubFromAudioAvailable && canMakeEpubFromAudio(libraryItem) && !findEpubFromAudioFile(libraryItem) && !(libraryItem as BookLibraryItem).media.ebookFile
      ? 'create'
      : null
  const guideStep = guide ? guide.steps[guide.index] : null
  const seekIndex = useSeekIndex({ libraryItemId: libraryItem.id, enabled: guideStep === 'repair' })
  const { getTaskProgress } = useTasks()
  const guidedFixActions = useMemo<GuidedFixActions>(
    () => ({
      getHealth: getItemHealthAction,
      run: runItemPipelineAction,
      enableAutoRepair: () => updateLibraryAutoPipelineAction(libraryItem.libraryId, { autoRepairSeekIndex: true }),
      // A box left unticked keeps the library's setting
      enableAutomation: ({ autoRepairSeekIndex, autoEpub }) =>
        updateLibraryAutoPipelineAction(libraryItem.libraryId, {
          mode: 'on',
          autoMatch: true,
          autoChapters: true,
          ...(autoRepairSeekIndex && { autoRepairSeekIndex }),
          ...(autoEpub && { autoEpub })
        }),
      startEpub: startEpubJobAction
    }),
    [libraryItem.libraryId]
  )
  const metadata = libraryItem.media.metadata as BookMetadata | PodcastMetadata
  const podcastAuthor = 'author' in metadata ? metadata.author : undefined
  const subtitle = 'subtitle' in metadata ? metadata.subtitle : undefined
  const bookAuthors = 'authors' in metadata ? metadata.authors || [] : []
  const bookSeries = 'series' in metadata && Array.isArray(metadata.series) ? metadata.series : []
  const description = 'description' in metadata ? metadata.description : undefined

  const userProgress = libraryItem.media?.id ? getMediaItemProgress(libraryItem.media.id) : undefined
  const showProgressPanel = useMemo(() => {
    if (isPodcast || !userProgress) return false
    return computeProgress({ progress: userProgress, useSeriesProgress: false }).percent > 0
  }, [isPodcast, userProgress])

  const handleOpenMetadataEdit = (section: MetadataEditSection) => {
    setMetadataEditSection(section)
  }

  /** The match and the chapter steps happen in the edit modal; the repair and the EPUB in the hint line */
  const openGuideStep = useCallback((step: GuideStepId) => {
    if (step === 'match') setMetadataEditSection('match')
    else if (step === 'epub') setMetadataEditSection(null)
    else if (step !== 'repair') setMetadataEditSection('chapters')
  }, [])

  const handleStartGuide = (from?: GuideStepId) => {
    if (!health) return
    const steps = getGuideSteps(health, { epub: !!epubOffer })
    // a step asked for by name (Pick the match) is kept even when the health read since no longer lists it
    if (from && !steps.includes(from)) steps.splice(steps.indexOf('lookup'), 0, from)
    const index = from ? steps.indexOf(from) : 0
    setGuide({ steps, index })
    openGuideStep(steps[index])
  }

  const guidedFix = useMemo(() => {
    if (!guide || !guideStep) return null
    return {
      stepId: guideStep,
      stepIndex: guide.index,
      total: guide.steps.length,
      paused: guideStep !== 'repair' && guideStep !== 'epub' && metadataEditSection === null,
      advance: () => {
        const index = guide.index + 1
        if (index < guide.steps.length) {
          setGuide({ ...guide, index })
          openGuideStep(guide.steps[index])
          return
        }
        // Done: the hint stays away until the book's issues change again
        void reloadHealth().then((next) => {
          if (next) dismissHint(next.issues)
          setMetadataEditSection(null)
          setGuide(null)
          setAskNextTime(getGuidancePreference() === null)
        })
      },
      resume: () => openGuideStep(guideStep),
      // Stopped on purpose: Edit opens the editor again until the book's issues change
      stop: () => {
        if (health) dismissHint(health.issues)
        setGuide(null)
      }
    }
  }, [dismissHint, guide, guideStep, health, metadataEditSection, openGuideStep, reloadHealth])

  const handleGuideRepairFiles = async () => {
    const result = await seekIndex.repairAndWait({ chapters: 'keep' })
    return !!result && result.files.every((file) => file.status !== 'failed')
  }

  const handleCloseMetadataEdit = () => {
    setMetadataEditSection(null)
    setProposalItemId(null)
  }

  // Deep links from the Processing page: `?edit=chapters&proposal=pipeline` (review) and `?edit=match`
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const editParam = searchParams.get('edit')
  const proposalParam = searchParams.get('proposal')
  useEffect(() => {
    if (!editParam) return
    const section = EDIT_SECTIONS.find((s) => s === editParam)
    if (section && userCanUpdate) {
      setMetadataEditSection(section)
      setProposalItemId(section === 'chapters' && proposalParam === 'pipeline' ? initialLibraryItem.id : null)
    }
    // Drop the query so a reload or Back does not open the editor again
    router.replace(pathname, { scroll: false })
  }, [editParam, initialLibraryItem.id, pathname, proposalParam, router, userCanUpdate])

  const handleItemUpdated = (updatedItem: BookLibraryItem | PodcastLibraryItem) => {
    setLibraryItem((prev) => mergeLibraryItemUpdate(prev, updatedItem) as BookLibraryItem | PodcastLibraryItem)
  }

  const { rssFeed, episodesDownloading, episodeDownloadsQueued } = useItemPageSocket({
    libraryItemId: libraryItem.id,
    mediaId: libraryItem.media?.id,
    isPodcast,
    onItemUpdated: handleItemUpdated,
    initialRssFeed: initialLibraryItem.rssFeed ?? null,
    initialEpisodeDownloadsQueued: initialLibraryItem.episodeDownloadsQueued ?? [],
    initialEpisodesDownloading: initialLibraryItem.episodesDownloading ?? []
  })

  const handleClearDownloadQueue = useCallback(async () => {
    try {
      const result = await clearPodcastDownloadQueueAction(libraryItem.id)
      if (!result.ok) {
        showToast(result.error || t('ToastEpisodeDownloadQueueClearFailed'), { type: 'error' })
        return
      }
      showToast(t('ToastEpisodeDownloadQueueClearSuccess'), { type: 'success' })
      setIsClearQueueDialogOpen(false)
    } catch (error) {
      console.error('Failed to clear queue', error)
      showToast(t('ToastEpisodeDownloadQueueClearFailed'), { type: 'error' })
    }
  }, [libraryItem.id, showToast, t])

  const coverPath = libraryItem.media?.coverPath
  const accentSourceUrl = useMemo(
    () => (coverPath ? getLibraryItemCoverUrl(libraryItem.id, libraryItem.updatedAt, true) : null),
    [coverPath, libraryItem.id, libraryItem.updatedAt]
  )
  const accentRgb = useCoverAccentColor(accentSourceUrl)

  useEffect(() => {
    const root = document.documentElement
    if (accentRgb === null) {
      root.style.removeProperty('--tc-library-item-accent-rgb')
      return
    }
    root.style.setProperty('--tc-library-item-accent-rgb', `${accentRgb.r} ${accentRgb.g} ${accentRgb.b}`)
    return () => {
      root.style.removeProperty('--tc-library-item-accent-rgb')
    }
  }, [accentRgb])

  return (
    <div className="relative isolate h-full min-h-[calc(100vh-var(--header-height))]">
      {accentRgb !== null ? (
        <div
          aria-hidden
          className="library-item-cover-accent-backdrop bleed-inset-x pointer-events-none absolute inset-y-0 z-0 h-[calc(100vh-var(--header-height))]"
        />
      ) : null}
      <div className="relative z-1 p-6 sm:p-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex flex-col gap-6 md:flex-row md:gap-8">
            <div className="mx-auto flex w-full max-w-72 shrink-0 items-start justify-center md:w-52 md:max-w-52 md:justify-start">
              <LibraryItemCover
                libraryItem={libraryItem}
                canUpdate={userCanUpdate}
                mediaProgress={userProgress}
                onEdit={() => handleOpenMetadataEdit('cover')}
                showPlayButton={showPlayButton}
                isItemPlaying={isItemPlaying}
                onPlay={handlePlay}
              />
            </div>
            <div className="flex-1">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold md:text-3xl">{libraryItem.media.metadata.title}</h1>
                {subtitle && <h2 className="text-foreground-muted text-xl font-medium md:text-2xl">{subtitle}</h2>}
                {podcastAuthor && <h2 className="text-foreground text-lg font-medium md:text-xl">{t('LabelByAuthor', { 0: podcastAuthor })}</h2>}
                {bookSeries.length > 0 && (
                  <div>
                    {bookSeries.map((series, index) => {
                      return (
                        <Fragment key={series.id}>
                          <Link href={`/library/${library.id}/series/${series.id}`} className="text-foreground-muted link-underline text-lg">
                            {series.name}
                            {series.sequence && <span className="text-foreground-muted text-lg"> #{series.sequence}</span>}
                          </Link>
                          {index < bookSeries.length - 1 && <span className="text-foreground-muted text-lg">, </span>}
                        </Fragment>
                      )
                    })}
                  </div>
                )}

                {bookAuthors.length > 0 && (
                  <div>
                    <span className="text-foreground text-lg">{t('LabelByAuthor', { 0: '' })}</span>
                    <span className="text-foreground text-lg md:text-xl">
                      <AuthorLinks libraryId={library.id} authors={bookAuthors} />
                    </span>
                  </div>
                )}

                {pipelineState && (
                  <PipelineStatusChip state={pipelineState} href={getProcessingHref(library.id, getPipelineTab(pipelineState.status))} className="mt-1" />
                )}
              </div>

              <LibraryItemDetails libraryItem={libraryItem} />

              {/* Podcast episode downloads queue */}
              {episodeDownloadsQueued.length > 0 && (
                <div className="bg-info/40 relative mx-auto mt-4 max-w-max rounded-md px-4 py-2 text-sm font-semibold text-gray-100 md:mx-0">
                  <div className="flex items-center">
                    <p className="py-1 text-sm">{t('MessageEpisodesQueuedForDownload', { count: episodeDownloadsQueued.length })}</p>
                    {userIsAdminOrUp && (
                      <IconBtn
                        borderless
                        size="custom"
                        variant="danger"
                        ariaLabel={t('ButtonClear')}
                        className="ml-3 cursor-pointer text-xl text-inherit"
                        onClick={() => setIsClearQueueDialogOpen(true)}
                      >
                        close
                      </IconBtn>
                    )}
                  </div>
                </div>
              )}

              {/* Podcast episodes currently downloading */}
              {episodesDownloading.length > 0 && (
                <div className="bg-success/20 relative mx-auto mt-4 max-w-max rounded-md px-4 py-2 text-sm font-semibold text-gray-100 md:mx-0">
                  {episodesDownloading.map((episode) => (
                    <div key={episode.id} className="flex items-center">
                      <LoadingSpinner />
                      <p className="py-1 pl-4 text-sm">{t('MessageTaskDownloadingEpisodeDescription', { 0: episode.episodeDisplayTitle ?? '' })}</p>
                    </div>
                  ))}
                </div>
              )}

              {showProgressPanel && userProgress && (
                <LibraryItemProgressPanel
                  libraryItem={libraryItem as BookLibraryItem}
                  mediaProgress={userProgress}
                  dateFormat={serverSettings?.dateFormat ?? 'MM/dd/yyyy'}
                />
              )}

              <LibraryItemActionButtons
                libraryItem={libraryItem}
                editHighlighted={needsGuide}
                onEdit={() => (needsGuide ? handleStartGuide() : handleOpenMetadataEdit('details'))}
                onOpenMatch={() => handleOpenMetadataEdit('match')}
                rssFeed={rssFeed ?? null}
                showPlayButton={showPlayButton}
                isItemPlaying={isItemPlaying}
                onPlay={handlePlay}
              />

              {health && (
                <GuidedFixContext.Provider value={guidedFix}>
                  <GuidedFixHint
                    libraryItemId={libraryItem.id}
                    health={health}
                    pipelineState={pipelineState}
                    repairProgress={getTaskProgress(libraryItem.id) ?? null}
                    reviewHref={getPipelineReviewHref(library.id, libraryItem.id)}
                    actions={guidedFixActions}
                    dismissed={hintDismissed}
                    onDismiss={() => dismissHint(health.issues)}
                    onStartGuide={handleStartGuide}
                    onRepairFiles={handleGuideRepairFiles}
                    askNextTime={askNextTime}
                    onNextTimeAnswered={() => setAskNextTime(false)}
                    canAutomate={autoPipelineAvailable}
                    epubOffer={epubOffer}
                    canAutomateEpub={epubFromAudioAvailable}
                  />
                </GuidedFixContext.Provider>
              )}

              {description && <ExpandableHtml html={description} lineClamp={4} className="mt-6" />}

              <div className="mt-6 flex flex-col gap-4">
                {isBookWithAudio && (
                  <ChaptersTable
                    libraryItem={libraryItem as BookLibraryItem}
                    onEditChapters={() => handleOpenMetadataEdit('chapters')}
                    onGoToTimestamp={handleGoToTimestamp}
                  />
                )}

                {/* transcripts (fork feature) */}
                {isBookWithAudio && <TranscriptSection libraryItem={libraryItem} title={libraryItem.media.metadata.title ?? ''} />}

                {/* audio tracks table */}
                {libraryItem.mediaType === 'book' && (libraryItem.media.tracks?.length ?? 0) > 0 && (
                  <AudioTracksTable libraryItem={libraryItem as BookLibraryItem} />
                )}

                {/* podcast episodes table */}
                {isPodcast && (
                  <EpisodeTable
                    libraryItem={libraryItem as PodcastLibraryItem}
                    dateFormat={serverSettings?.dateFormat}
                    episodesDownloading={episodesDownloading}
                    episodeDownloadsQueued={episodeDownloadsQueued}
                    onEpisodesInOrderChange={handlePodcastEpisodesInOrderChange}
                  />
                )}

                {/* ebook files table */}
                {libraryItem.mediaType === 'book' && <EbookFilesTable libraryItem={libraryItem as BookLibraryItem} />}

                {/* library files table */}
                {!isPodcast && (libraryItem.libraryFiles?.length ?? 0) > 0 && <LibraryFilesTable libraryItem={libraryItem} />}
              </div>
            </div>
          </div>
        </div>

        <PipelineProposalContext.Provider value={proposalTarget}>
          <GuidedFixContext.Provider value={guidedFix}>
            <LibraryItemMetadataEditModal
              isOpen={metadataEditSection !== null}
              initialSection={metadataEditSection ?? 'details'}
              libraryItem={libraryItem}
              onClose={handleCloseMetadataEdit}
            />
          </GuidedFixContext.Provider>
        </PipelineProposalContext.Provider>
        <ConfirmDialog
          isOpen={isClearQueueDialogOpen}
          message={t('MessageConfirmClearEpisodeFetchQueue')}
          onClose={() => setIsClearQueueDialogOpen(false)}
          onConfirm={handleClearDownloadQueue}
        />
        <ConfirmDialog
          isOpen={pendingStartTime !== null}
          message={t('MessageStartPlaybackAtTime', {
            0: metadata.title ?? '',
            1: secondsToTimestamp(pendingStartTime ?? 0)
          })}
          onClose={handleCloseStartTime}
          onConfirm={handleConfirmStartTime}
        />
      </div>
    </div>
  )
}
