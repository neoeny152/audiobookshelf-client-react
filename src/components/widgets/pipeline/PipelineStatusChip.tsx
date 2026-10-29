'use client'

import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { getPipelineMatchPercent, getPipelineTab, getPipelineWouldLines, isPipelineActive, PIPELINE_STATUS_LABEL, PIPELINE_TAB_CHIP_CLASS } from '@/lib/autoPipeline'
import { mergeClasses } from '@/lib/merge-classes'
import type { PipelineItemState } from '@/types/api'
import Link from 'next/link'

export interface PipelineStatusChipProps {
  state: PipelineItemState
  /** Link for the chip (the library's Processing page). */
  href?: string
  /** Show the reason (and dry-run lines) next to the chip. */
  showReason?: boolean
  className?: string
}

const TAB_ICON = { queue: 'hourglass_top', review: 'rate_review', done: 'task_alt', failed: 'error' } as const

/** The auto pipeline's status for one book: a coloured chip ("Needs review"), the reason and the match %. */
export default function PipelineStatusChip({ state, href, showReason = true, className }: PipelineStatusChipProps) {
  const t = useTypeSafeTranslations()
  const tab = getPipelineTab(state.status)
  const percent = getPipelineMatchPercent(state)
  const would = getPipelineWouldLines(state)
  const label = t(PIPELINE_STATUS_LABEL[state.status])

  const chip = (
    <span
      className={mergeClasses('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold', PIPELINE_TAB_CHIP_CLASS[tab])}
      cy-id="pipeline-status-chip"
    >
      <span className={mergeClasses('material-symbols text-sm', isPipelineActive(state.status) && 'animate-pulse')} aria-hidden>
        {TAB_ICON[tab]}
      </span>
      {label}
      {state.dryRun && <span className="font-normal">({t('LabelAutoPipelineDryRunTag')})</span>}
    </span>
  )

  return (
    <div className={mergeClasses('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm', className)} cy-id="pipeline-status" data-status={state.status}>
      {href ? (
        <Link href={href} className="inline-flex" aria-label={t('LabelAutoPipelineStatusLink', { status: label })}>
          {chip}
        </Link>
      ) : (
        chip
      )}
      {percent != null && (
        <span className="text-foreground-muted text-xs" cy-id="pipeline-status-match">
          {t('LabelAutoPipelineMatchPercent', { percent })}
        </span>
      )}
      {showReason && state.reason && (
        <span className="text-foreground-muted min-w-0 truncate" cy-id="pipeline-status-reason" title={state.reason}>
          {state.reason}
        </span>
      )}
      {showReason &&
        would.map((line) => (
          <span key={line} className="text-foreground-muted min-w-0 truncate italic" cy-id="pipeline-status-would" title={line}>
            {line}
          </span>
        ))}
    </div>
  )
}
