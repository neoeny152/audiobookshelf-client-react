'use client'

import {
  dismissItemPipelineAction,
  getLibraryPipelineAction,
  runItemPipelineAction,
  runLibraryPipelineAction,
  undoPipelineChaptersAction
} from '@/app/actions/pipelineActions'
import PipelineProcessingView, { type PipelineRunScope } from '@/components/widgets/pipeline/PipelineProcessingView'
import { useSocketEvent } from '@/contexts/SocketContext'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useServerFeature } from '@/hooks/useServerFeatures'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { callStatusAction, type StatusActionResult } from '@/lib/actionResult'
import {
  getDismissedPipelineItemId,
  getPipelineWorkerItemId,
  PIPELINE_TABS,
  toPipelineItemState,
  toPipelineItemStates,
  upsertPipelineItem,
  type PipelineTab
} from '@/lib/autoPipeline'
import type { AutoPipelineMode, PipelineItemState } from '@/types/api'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'

interface ProcessingClientProps {
  libraryId: string
  canRunLibrary: boolean
}

/** A slow safety net: the page stays current through `pipeline_item_updated`, this catches missed events. */
const REFRESH_INTERVAL_MS = 60_000

export default function ProcessingClient({ libraryId, canRunLibrary }: ProcessingClientProps) {
  const t = useTypeSafeTranslations()
  const { showToast } = useGlobalToast()
  const available = useServerFeature('autoPipeline')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: PipelineTab = PIPELINE_TABS.find((id) => id === tabParam) ?? 'queue'

  const [items, setItems] = useState<PipelineItemState[]>([])
  const [mode, setMode] = useState<AutoPipelineMode | null>(null)
  const [gate, setGate] = useState(true)
  const [workerCurrent, setWorkerCurrent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyItemIds, setBusyItemIds] = useState<ReadonlySet<string>>(() => new Set())
  const [runningScope, setRunningScope] = useState<PipelineRunScope | null>(null)

  const load = useCallback(async () => {
    const result = await callStatusAction(() => getLibraryPipelineAction(libraryId))
    setLoading(false)
    if (!result.ok) {
      showToast(result.error ? t('ToastAutoPipelineLoadFailedWithError', { error: result.error }) : t('ToastAutoPipelineLoadFailed'), { type: 'error' })
      return
    }
    setItems(toPipelineItemStates(result.data.items))
    setMode(result.data.mode ?? null)
    setGate(result.data.gate !== false)
    setWorkerCurrent(getPipelineWorkerItemId(result.data.worker?.current))
  }, [libraryId, showToast, t])

  useEffect(() => {
    if (!available) return
    void load()
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [available, load])

  const handleItemUpdated = useCallback(
    (data: unknown) => {
      const dismissed = getDismissedPipelineItemId(data)
      if (dismissed) {
        setItems((prev) => prev.filter((item) => item.libraryItemId !== dismissed))
        return
      }
      const next = toPipelineItemState(data)
      if (!next) return
      setItems((prev) => upsertPipelineItem(prev, next, libraryId))
      // The worker moves on: the book it reports as running is the current one
      if (next.libraryId === libraryId && ['waiting', 'matching', 'chapters'].includes(next.status)) setWorkerCurrent(next.libraryItemId)
    },
    [libraryId]
  )
  useSocketEvent<unknown>('pipeline_item_updated', handleItemUpdated)

  const handleTabChange = useCallback(
    (next: PipelineTab) => {
      router.replace(next === 'queue' ? pathname : `${pathname}?tab=${next}`, { scroll: false })
    },
    [pathname, router]
  )

  /** Run a row action with the row disabled meanwhile; a failure toasts the server's message. */
  const runItemAction = useCallback(
    async <T,>(item: PipelineItemState, request: () => Promise<StatusActionResult<T>>, success: string, onOk?: (data: T) => void) => {
      setBusyItemIds((prev) => new Set(prev).add(item.libraryItemId))
      try {
        const result = await callStatusAction(request)
        if (!result.ok) {
          showToast(result.error ? t('ToastAutoPipelineActionFailedWithError', { error: result.error }) : t('ToastAutoPipelineActionFailed'), {
            type: 'error'
          })
          return
        }
        onOk?.(result.data)
        showToast(success, { type: 'success' })
      } finally {
        setBusyItemIds((prev) => {
          const next = new Set(prev)
          next.delete(item.libraryItemId)
          return next
        })
      }
    },
    [showToast, t]
  )

  const handleRetry = useCallback(
    (item: PipelineItemState) =>
      void runItemAction(item, () => runItemPipelineAction(item.libraryItemId), t('ToastAutoPipelineQueued'), (data) => {
        const next = toPipelineItemState(data)
        if (next) setItems((prev) => upsertPipelineItem(prev, next, libraryId))
      }),
    [libraryId, runItemAction, t]
  )

  const handleDismiss = useCallback(
    (item: PipelineItemState) =>
      void runItemAction(item, () => dismissItemPipelineAction(item.libraryItemId), t('ToastAutoPipelineDismissed'), () => {
        setItems((prev) => prev.filter((entry) => entry.libraryItemId !== item.libraryItemId))
      }),
    [runItemAction, t]
  )

  const handleUndoChapters = useCallback(
    (item: PipelineItemState) =>
      void runItemAction(
        item,
        () => undoPipelineChaptersAction(item.libraryItemId, item.chapters?.backup),
        t('ToastAutoPipelineChaptersRestored'),
        () => {
          // The server says so too (pipeline_item_updated); until then Undo must not be offered again
          setItems((prev) =>
            prev.map((entry) =>
              entry.libraryItemId === item.libraryItemId && entry.chapters
                ? { ...entry, chapters: { ...entry.chapters, result: 'restored', applied: false } }
                : entry
            )
          )
        }
      ),
    [runItemAction, t]
  )

  const handleRunLibrary = useCallback(
    async (scope: PipelineRunScope) => {
      setRunningScope(scope)
      try {
        const result = await callStatusAction(() => runLibraryPipelineAction(libraryId, scope))
        if (!result.ok) {
          showToast(result.error ? t('ToastAutoPipelineActionFailedWithError', { error: result.error }) : t('ToastAutoPipelineActionFailed'), {
            type: 'error'
          })
          return
        }
        showToast(t('ToastAutoPipelineLibraryQueued', { count: result.data.queued ?? 0 }), { type: 'success' })
        await load()
      } finally {
        setRunningScope(null)
      }
    },
    [libraryId, load, showToast, t]
  )

  if (!available) {
    return (
      <p className="text-foreground-muted text-sm" cy-id="pipeline-unavailable">
        {t('MessageAutoPipelineUnavailable')}
      </p>
    )
  }

  return (
    <PipelineProcessingView
      libraryId={libraryId}
      items={items}
      mode={mode}
      gate={gate}
      workerCurrent={workerCurrent}
      loading={loading}
      tab={tab}
      onTabChange={handleTabChange}
      canRunLibrary={canRunLibrary}
      busyItemIds={busyItemIds}
      runningScope={runningScope}
      onRetry={handleRetry}
      onDismiss={handleDismiss}
      onUndoChapters={handleUndoChapters}
      onRunLibrary={(scope) => void handleRunLibrary(scope)}
    />
  )
}
