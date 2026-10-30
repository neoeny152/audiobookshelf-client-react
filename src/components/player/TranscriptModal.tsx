'use client'

import Modal from '@/components/modals/Modal'
import ModalOuterContent from '@/components/modals/ModalOuterContent'
import Dropdown from '@/components/ui/Dropdown'
import TranscriptView from '@/components/widgets/transcripts/TranscriptView'
import { useTranscriptContent } from '@/hooks/useTranscripts'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { usePlayerProgress } from '@/lib/player/playerProgressStore'
import { pickDefaultTranscript, transcriptSourceKey, type TranscriptInfo, type TranscriptList } from '@/lib/transcripts'
import type { TypeSafeTranslations } from '@/types/translations'
import { useMemo, useState } from 'react'

export interface TranscriptModalProps {
  isOpen: boolean
  libraryItemId: string
  episodeId: string | null
  list: TranscriptList | null
  zIndexClass?: string
  onSeek: (time: number) => void
  onClose: () => void
}

export function transcriptOptionLabel(info: TranscriptInfo, t: TypeSafeTranslations): string {
  const parts = [t(transcriptSourceKey(info.source)), info.format.toUpperCase()]
  if (info.language) parts.push(info.language)
  return parts.join(' · ')
}

/** Follows the playback position; only mounted while the modal is open, so the player does not re-render for it. */
function TranscriptModalBody({ libraryItemId, episodeId, list, onSeek }: Pick<TranscriptModalProps, 'libraryItemId' | 'episodeId' | 'list' | 'onSeek'>) {
  const t = useTypeSafeTranslations()
  const { currentTime } = usePlayerProgress()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const transcripts = useMemo(() => list?.transcripts ?? [], [list])
  const selected = transcripts.find((tr) => tr.id === selectedId) ?? pickDefaultTranscript(list)
  const { content, status } = useTranscriptContent(libraryItemId, episodeId, selected?.id, selected?.updatedAt)

  const items = useMemo(() => transcripts.map((tr) => ({ text: transcriptOptionLabel(tr, t), value: tr.id })), [transcripts, t])

  return (
    <div className="flex h-[75vh] max-h-[75vh] flex-col">
      {items.length > 1 && (
        <div className="border-border border-b px-3 py-2">
          <Dropdown
            ariaLabel={t('LabelTranscriptSelect')}
            items={items}
            value={selected?.id ?? ''}
            onChange={(value) => setSelectedId(String(value))}
            className="max-w-80"
          />
        </div>
      )}
      <TranscriptView className="min-h-0 flex-1" content={content} status={selected ? status : 'error'} currentTime={currentTime} onSeek={onSeek} />
    </div>
  )
}

/** The player's transcript panel (fork feature `transcripts`): highlights the cue being spoken, click a cue to seek. */
export default function TranscriptModal({ isOpen, libraryItemId, episodeId, list, zIndexClass, onSeek, onClose }: TranscriptModalProps) {
  const t = useTypeSafeTranslations()
  const outerContent = <ModalOuterContent>{t('HeaderTranscript')}</ModalOuterContent>

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      zIndexClass={zIndexClass}
      outerContent={outerContent}
      className="overflow-hidden sm:max-w-xl md:max-w-2xl lg:max-w-2xl"
    >
      {isOpen && <TranscriptModalBody libraryItemId={libraryItemId} episodeId={episodeId} list={list} onSeek={onSeek} />}
    </Modal>
  )
}
