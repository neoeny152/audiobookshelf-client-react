'use client'

import NeedsWorkNote from '@/components/widgets/guided-fix/NeedsWorkNote'
import { useNeedsWork } from '@/contexts/NeedsWorkContext'
import { mergeClasses } from '@/lib/merge-classes'
import { type BookMedia, isPersonalizedSeriesRef } from '@/types/api'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import MediaCard, { type MediaCardProps } from './MediaCard'

export type BookMediaCardProps = MediaCardProps

/**
 * Book-specific media card with book-specific badges and overlays.
 */
export default function BookMediaCard(props: BookMediaCardProps) {
  const { libraryItem } = props
  const media = libraryItem.media as BookMedia
  // Fork only: the book needs work (see NeedsWorkContext); Edit opens its page, which starts Guide me
  const needsWork = useNeedsWork().byId.get(libraryItem.id)
  const router = useRouter()
  const handleGuidedEdit = useCallback(
    () => router.push(`/library/${libraryItem.libraryId}/item/${libraryItem.id}?guide=1`),
    [libraryItem.id, libraryItem.libraryId, router]
  )

  // Sequence badge only when the server injects a shelf `PersonalizedSeriesRef`
  // (continue-series, series-filtered rows). Minified home shelves use `seriesName` only;
  // expanded `Series[]` from socket updates must not drive this badge.
  const seriesSequence = useMemo(() => {
    const { series } = media.metadata
    if (!series || !isPersonalizedSeriesRef(series)) return null
    return series.sequence ?? null
  }, [media.metadata])

  const ebookFormat = useMemo(() => media.ebookFormat, [media])

  const renderBadges = useMemo(() => {
    const BookBadges = ({ isHovering, isSelectionMode, processing }: { isHovering: boolean; isSelectionMode: boolean; processing: boolean }) => {
      // Series sequence badge (regular, when not hovering/selecting)
      if (seriesSequence && !isHovering && !isSelectionMode && !processing) {
        return (
          <div
            cy-id="seriesSequence"
            className={mergeClasses(
              'shadow-modal-content absolute top-[0.375em] z-10 rounded-lg bg-black/90 text-white',
              // Beside the always-shown Edit of a book that needs work
              needsWork ? 'inset-e-[1.875em]' : 'inset-e-[0.375em]'
            )}
            style={{ padding: '0.1em 0.25em' }}
          >
            <p style={{ fontSize: '0.8em' }}>#{seriesSequence}</p>
          </div>
        )
      }

      return null
    }
    BookBadges.displayName = 'BookBadges'
    return BookBadges
  }, [needsWork, seriesSequence])

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

  return (
    <MediaCard
      {...props}
      renderBadges={renderBadges}
      renderOverlayBadges={renderOverlayBadges}
      footerNote={needsWork && <NeedsWorkNote item={needsWork} />}
      onHighlightedEdit={needsWork ? handleGuidedEdit : undefined}
    />
  )
}
