'use client'

import Btn from '@/components/ui/Btn'
import LoadingIndicator from '@/components/ui/LoadingIndicator'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import PipelineStatusChip from '@/components/widgets/pipeline/PipelineStatusChip'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import {
  canUndoPipelineChapters,
  countPipelineTabs,
  getPipelineMatchHref,
  getPipelineReviewHref,
  getPipelineTab,
  hasPipelineChapterReview,
  hasPipelineMatchReview,
  isPipelineActive,
  PIPELINE_TABS,
  sortPipelineItems,
  type PipelineTab
} from '@/lib/autoPipeline'
import { getLibraryItemCoverUrl } from '@/lib/coverUtils'
import { mergeClasses } from '@/lib/merge-classes'
import type { AutoPipelineMode, PipelineItemState } from '@/types/api'
import type { TranslationKey } from '@/types/translations'
import Link from 'next/link'
import { useMemo, useState } from 'react'

/** `needs-work`: the books whose health has an issue (lib/itemHealth), processed again if need be */
export type PipelineRunScope = 'unprocessed' | 'all' | 'needs-work'

export interface PipelineProcessingViewProps {
  libraryId: string
  items: PipelineItemState[]
  /** The library's mode; null while unknown. */
  mode: AutoPipelineMode | null
  /** The server's env gate. Off: nothing runs, whatever the settings say. */
  gate: boolean
  /** The book the worker is on, if any. */
  workerCurrent?: string | null
  loading?: boolean
  tab: PipelineTab
  onTabChange: (tab: PipelineTab) => void
  /** Admins can queue the whole library. */
  canRunLibrary: boolean
  /** Rows with a request in flight (their buttons are disabled). */
  busyItemIds?: ReadonlySet<string>
  runningScope?: PipelineRunScope | null
  onRetry: (item: PipelineItemState) => void
  onDismiss: (item: PipelineItemState) => void
  onUndoChapters: (item: PipelineItemState) => void
  onRunLibrary: (scope: PipelineRunScope) => void
  /** Cover image URL (tests pass a stub). */
  coverUrl?: (item: PipelineItemState) => string
}

const TAB_LABEL: Record<PipelineTab, TranslationKey> = {
  queue: 'LabelAutoPipelineTabQueue',
  review: 'LabelAutoPipelineTabReview',
  done: 'LabelAutoPipelineTabDone',
  failed: 'LabelAutoPipelineTabFailed'
}

const MODE_LABEL: Record<AutoPipelineMode, TranslationKey> = {
  off: 'LabelAutoPipelineModeOff',
  dryRun: 'LabelAutoPipelineModeDryRun',
  on: 'LabelAutoPipelineModeOn'
}

const RUN_CONFIRM: Readonly<Record<PipelineRunScope, TranslationKey>> = Object.freeze({
  unprocessed: 'MessageConfirmAutoPipelineRunUnprocessed',
  all: 'MessageConfirmAutoPipelineRunAll',
  'needs-work': 'MessageConfirmAutoPipelineRunNeedsWork'
})

type PendingConfirm = { kind: 'run'; scope: PipelineRunScope } | { kind: 'undo'; item: PipelineItemState }

function defaultCoverUrl(item: PipelineItemState): string {
  return getLibraryItemCoverUrl(item.libraryItemId, item.updatedAt)
}

/**
 * The library's auto pipeline: Queue / Needs review / Done / Failed tabs with counts, one row per book (cover, title,
 * status, reason, match %) and the actions that fit its state. Data and actions come from the host.
 */
export default function PipelineProcessingView({
  libraryId,
  items,
  mode,
  gate,
  workerCurrent = null,
  loading = false,
  tab,
  onTabChange,
  canRunLibrary,
  busyItemIds,
  runningScope = null,
  onRetry,
  onDismiss,
  onUndoChapters,
  onRunLibrary,
  coverUrl = defaultCoverUrl
}: PipelineProcessingViewProps) {
  const t = useTypeSafeTranslations()
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const counts = useMemo(() => countPipelineTabs(items), [items])
  const rows = useMemo(() => sortPipelineItems(items.filter((item) => getPipelineTab(item.status) === tab), tab), [items, tab])

  const confirm = () => {
    if (!pending) return
    if (pending.kind === 'run') onRunLibrary(pending.scope)
    else onUndoChapters(pending.item)
    setPending(null)
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4" cy-id="pipeline-processing">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t('HeaderAutoPipelineProcessing')}</h1>
          {mode && (
            <p className="text-foreground-muted text-sm" cy-id="pipeline-mode">
              {t('LabelAutoPipelineModeIs', { mode: t(MODE_LABEL[mode]) })}
            </p>
          )}
        </div>
        {canRunLibrary && (
          <div className="flex flex-wrap gap-2">
            <Btn size="small" disabled={!gate || !!runningScope} loading={runningScope === 'unprocessed'} onClick={() => setPending({ kind: 'run', scope: 'unprocessed' })}>
              {t('ButtonAutoPipelineRunUnprocessed')}
            </Btn>
            <Btn size="small" disabled={!gate || !!runningScope} loading={runningScope === 'all'} onClick={() => setPending({ kind: 'run', scope: 'all' })}>
              {t('ButtonAutoPipelineRunAll')}
            </Btn>
            <Btn
              size="small"
              disabled={!gate || !!runningScope}
              loading={runningScope === 'needs-work'}
              onClick={() => setPending({ kind: 'run', scope: 'needs-work' })}
            >
              {t('ButtonAutoPipelineRunNeedsWork')}
            </Btn>
          </div>
        )}
      </div>

      {!gate && (
        <p className="bg-warning/15 border-warning/60 rounded-md border px-3 py-2 text-sm" role="note" cy-id="pipeline-gate-off">
          {t('MessageAutoPipelineGateOff')}
        </p>
      )}

      <div role="tablist" aria-label={t('HeaderAutoPipelineProcessing')} className="border-border flex flex-wrap gap-1 border-b">
        {PIPELINE_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            cy-id={`pipeline-tab-${id}`}
            onClick={() => onTabChange(id)}
            className={mergeClasses(
              'hover:bg-nav-item-hover -mb-px rounded-t-md border-b-2 px-3 py-2 text-sm',
              tab === id ? 'border-yellow-400 font-semibold' : 'text-foreground-muted border-transparent'
            )}
          >
            {t(TAB_LABEL[id])}
            <span className="bg-foreground/15 ms-2 rounded-full px-1.5 font-mono text-xs" cy-id={`pipeline-tab-count-${id}`}>
              {counts[id]}
            </span>
          </button>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-8">
          <LoadingIndicator variant="inline" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-foreground-muted py-6 text-center text-sm" cy-id="pipeline-empty">
          {t('MessageAutoPipelineEmpty')}
        </p>
      ) : (
        <ul className="divide-border flex flex-col divide-y" role="tabpanel">
          {rows.map((item) => {
            const busy = !!busyItemIds?.has(item.libraryItemId)
            const itemHref = `/library/${libraryId}/item/${item.libraryItemId}`
            const active = isPipelineActive(item.status)
            // The step that is running would still change the book; the server refuses (409) until it ends
            const processing = workerCurrent === item.libraryItemId && active
            return (
              <li key={item.libraryItemId} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center" cy-id="pipeline-row" data-item-id={item.libraryItemId}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API cover, same as the bookshelf */}
                  <img src={coverUrl(item)} alt="" className="bg-primary h-14 w-14 shrink-0 rounded object-cover" loading="lazy" />
                  <div className="min-w-0 flex-1">
                    <Link href={itemHref} className="link-underline block truncate font-semibold" cy-id="pipeline-row-title">
                      {item.title || t('LabelAutoPipelineUntitled')}
                    </Link>
                    <PipelineStatusChip state={item} />
                    {processing && (
                      <span className="text-foreground-muted text-xs" cy-id="pipeline-row-current">
                        {t('LabelAutoPipelineWorking')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5" cy-id="pipeline-row-actions">
                  <Btn size="small" to={itemHref}>
                    {t('ButtonOpen')}
                  </Btn>
                  {hasPipelineChapterReview(item) && (
                    <Btn size="small" color="bg-warning/70" to={getPipelineReviewHref(libraryId, item.libraryItemId)}>
                      {t('ButtonAutoPipelineReviewChapters')}
                    </Btn>
                  )}
                  {hasPipelineMatchReview(item) && (
                    <Btn size="small" to={getPipelineMatchHref(libraryId, item.libraryItemId)}>
                      {t('ButtonAutoPipelineMatch')}
                    </Btn>
                  )}
                  {!active && (
                    <Btn size="small" disabled={busy || !gate} onClick={() => onRetry(item)}>
                      {t('ButtonAutoPipelineRetry')}
                    </Btn>
                  )}
                  {canUndoPipelineChapters(item) && (
                    <Btn size="small" disabled={busy} onClick={() => setPending({ kind: 'undo', item })}>
                      {t('ButtonAutoPipelineUndoChapters')}
                    </Btn>
                  )}
                  <Btn size="small" disabled={busy || processing} onClick={() => onDismiss(item)}>
                    {t('ButtonAutoPipelineDismiss')}
                  </Btn>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        isOpen={!!pending}
        message={
          pending?.kind === 'run'
            ? t(RUN_CONFIRM[pending.scope], { mode: t(MODE_LABEL[mode ?? 'off']) })
            : t('MessageConfirmAutoPipelineUndoChapters', { title: pending?.kind === 'undo' ? (pending.item.title ?? '') : '' })
        }
        onClose={() => setPending(null)}
        onConfirm={confirm}
      />
    </div>
  )
}
