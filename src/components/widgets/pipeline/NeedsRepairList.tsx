'use client'

import Btn from '@/components/ui/Btn'
import RepairConsentDialog from '@/components/widgets/guided-fix/RepairConsentDialog'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { formatDrift } from '@/lib/itemHealth'
import type { PipelineItemState } from '@/types/api'
import Link from 'next/link'
import { useState } from 'react'

export interface NeedsRepairListProps {
  libraryId: string
  /** The library's pipeline states; only the books waiting for an OK to rewrite their MP3s are listed */
  items: PipelineItemState[]
  busyItemIds: ReadonlySet<string>
  /** `always`: also turn on the library's Repair MP3 seek index automatically */
  onRepair: (item: PipelineItemState, always: boolean) => void
  onNotNow: (item: PipelineItemState) => void
}

/**
 * "Needs your OK" on the library home (fork only): books the pipeline stopped for because their MP3s report the wrong
 * length and the library does not repair them without asking. Renders nothing when there are none.
 */
export default function NeedsRepairList({ libraryId, items, busyItemIds, onRepair, onNotNow }: NeedsRepairListProps) {
  const t = useTypeSafeTranslations()
  const [confirmItem, setConfirmItem] = useState<PipelineItemState | null>(null)
  const waiting = items.filter((item) => item.status === 'needs-review' && !item.dryRun && item.chapters?.reason === 'needs-seek-index-repair')
  if (!waiting.length) return null

  const drift = (item: PipelineItemState) => item.repair ?? item.chapters?.seekIndex

  return (
    <section className="px-4 pt-4" cy-id="needs-repair-list">
      <h2 className="text-base font-semibold">{t('HeaderNeedsYourOk')}</h2>
      <ul className="divide-border flex flex-col divide-y text-sm">
        {waiting.map((item) => (
          <li key={item.libraryItemId} className="flex flex-wrap items-center gap-2 py-2" cy-id="needs-repair-row">
            <div className="min-w-0 flex-1 basis-64">
              <Link href={`/library/${libraryId}/item/${item.libraryItemId}`} className="link-underline block truncate font-semibold">
                {item.title || t('LabelAutoPipelineUntitled')}
              </Link>
              <p className="text-foreground-muted text-xs">
                {t('MessageNeedsRepairRow', { files: drift(item)?.files ?? 0, drift: formatDrift(drift(item)?.maxDrift ?? 0, t) })}
              </p>
            </div>
            <Btn size="small" disabled={busyItemIds.has(item.libraryItemId)} onClick={() => setConfirmItem(item)}>
              {t('ButtonRepairSeekIndex')}
            </Btn>
            <Btn size="small" disabled={busyItemIds.has(item.libraryItemId)} onClick={() => onNotNow(item)}>
              {t('ButtonNotNow')}
            </Btn>
          </li>
        ))}
      </ul>
      <RepairConsentDialog
        isOpen={!!confirmItem}
        fileCount={(confirmItem && drift(confirmItem)?.files) ?? 0}
        yesButtonText={t('ButtonRepairSeekIndex')}
        onClose={() => setConfirmItem(null)}
        onConfirm={(always) => {
          if (confirmItem) onRepair(confirmItem, always)
          setConfirmItem(null)
        }}
      />
    </section>
  )
}
