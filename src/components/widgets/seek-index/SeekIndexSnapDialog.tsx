'use client'

import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import { SeekIndexShiftChaptersOption } from '@/components/widgets/seek-index/SeekIndexPanel'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { useEffect, useState } from 'react'

export type SeekIndexSnapChoice = { choice: 'repair'; shiftChapters: boolean } | { choice: 'snap' } | { choice: 'cancel' }

export interface SeekIndexSnapDialogProps {
  isOpen: boolean
  /** MP3 files that need a seek index repair */
  fileCount: number
  /** Largest drift among them, seconds */
  maxDrift: number
  /** Chapters in the editor; the shift option is offered when there are any */
  chapterCount: number
  /** Whether the shift option starts ticked (off for chapters just taken from Audible, which use the real times) */
  shiftDefault: boolean
  onChoose: (choice: SeekIndexSnapChoice) => void
}

/** Asked before a snap on a book whose MP3 files drift: repair first (then snap), snap anyway, or cancel. */
export default function SeekIndexSnapDialog({ isOpen, fileCount, maxDrift, chapterCount, shiftDefault, onChoose }: SeekIndexSnapDialogProps) {
  const t = useTypeSafeTranslations()
  const [shiftChapters, setShiftChapters] = useState(shiftDefault)

  useEffect(() => {
    if (isOpen) setShiftChapters(shiftDefault)
  }, [isOpen, shiftDefault])

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={t('HeaderSeekIndexRepairBeforeSnap')}
      message={
        <div className="flex flex-col gap-3" cy-id="seek-index-snap-dialog">
          <p className="text-base font-semibold">{t('HeaderSeekIndexRepairBeforeSnap')}</p>
          <p>{t('MessageSeekIndexRepairBeforeSnap', { 0: fileCount, 1: maxDrift.toFixed(1) })}</p>
          <p>{t('MessageSeekIndexRepairBeforeSnapDetail')}</p>
          {chapterCount > 0 && <SeekIndexShiftChaptersOption chapterCount={chapterCount} value={shiftChapters} onChange={setShiftChapters} />}
        </div>
      }
      yesButtonText={t('ButtonRepairAndSnap')}
      yesButtonClassName="bg-primary"
      altButtonText={t('ButtonSnapAnyway')}
      onClose={() => onChoose({ choice: 'cancel' })}
      onAlt={() => onChoose({ choice: 'snap' })}
      onConfirm={() => onChoose({ choice: 'repair', shiftChapters: chapterCount > 0 && shiftChapters })}
    />
  )
}
