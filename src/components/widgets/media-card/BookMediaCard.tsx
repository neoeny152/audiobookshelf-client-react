'use client'

import Tooltip from '@/components/ui/Tooltip'
import { useNeedsWork } from '@/contexts/NeedsWorkContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { getIssueReason } from '@/lib/itemHealth'
import { type BookMedia, isPersonalizedSeriesRef } from '@/types/api'
import { useMemo } from 'react'
import MediaCard, { type MediaCardProps } from './MediaCard'

export type BookMediaCardProps = MediaCardProps

/**
 * Book-specific media card with book-specific badges and overlays.
 */
export default function BookMediaCard(props: BookMediaCardProps) {
  const { libraryItem } = props
  const media = libraryItem.media as BookMedia
  const t = useTypeSafeTranslations()
  const needsWork = useNeedsWork().byId.get(libraryItem.id)

  // Sequence badge only when the server injects a shelf `PersonalizedSeriesRef`
  // (continue-series, series-filtered rows). Minified home shelves use `seriesName` only;
  // expanded `Series[]` from socket updates must not drive this badge.
  const seriesSequence = useMemo(() => {
    const { series } = media.metadata
    if (!series || !isPersonalizedSeriesRef(series)) return null
    return series.sequence ?? null
  }, [media.metadata])

  const ebookFormat = useMemo(() => media.ebookFormat, [media])

  // Fork only: the book needs work (see NeedsWorkContext)
  const needsWorkReasons = useMemo(() => needsWork?.issues.map((issue) => getIssueReason(issue, needsWork, t)) ?? [], [needsWork, t])

  const renderBadges = useMemo(() => {
    const BookBadges = ({ isHovering, isSelectionMode, processing }: { isHovering: boolean; isSelectionMode: boolean; processing: boolean }) => (
      <>
        {/* Series sequence badge (regular, when not hovering/selecting) */}
        {seriesSequence && !isHovering && !isSelectionMode && !processing && (
          <div
            cy-id="seriesSequence"
            className="shadow-modal-content absolute inset-e-[0.375em] top-[0.375em] z-10 rounded-lg bg-black/90 text-white"
            style={{ padding: '0.1em 0.25em' }}
          >
            <p style={{ fontSize: '0.8em' }}>#{seriesSequence}</p>
          </div>
        )}
        {/* Needs work badge (also while hovering, so its tooltip can be read) */}
        {needsWorkReasons.length > 0 && !isSelectionMode && !processing && (
          <div cy-id="needsWorkBadge" className="absolute inset-e-[0.375em] top-[2.125em] z-10">
            <Tooltip
              lazy
              position="left"
              text={
                <ul>
                  {needsWorkReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              }
            >
              <div className="flex size-[1.5em] items-center justify-center rounded-full bg-black/60 shadow-sm" role="img" aria-label={t('LabelNeedsWork')}>
                <span className="material-symbols text-warning" aria-hidden="true" style={{ fontSize: '1em' }}>
                  build
                </span>
              </div>
            </Tooltip>
          </div>
        )}
      </>
    )
    BookBadges.displayName = 'BookBadges'
    return BookBadges
  }, [needsWorkReasons, seriesSequence, t])

  const renderOverlayBadges = useMemo(() => {
    const BookOverlayBadges = () => {
      // Ebook format badge at bottom-left of overlay
      if (ebookFormat) {
        return (
          <div cy-id="ebookFormat" className="absolute inset-s-[0.375em] bottom-[0.375em]">
            <span className="text-white/80" style={{ fontSize: '0.8em' }}>
              {ebookFormat}
            </span>
          </div>
        )
      }
      return null
    }
    BookOverlayBadges.displayName = 'BookOverlayBadges'
    return BookOverlayBadges
  }, [ebookFormat])

  return <MediaCard {...props} renderBadges={renderBadges} renderOverlayBadges={renderOverlayBadges} />
}
