'use client'

import Btn from '@/components/ui/Btn'
import Checkbox from '@/components/ui/Checkbox'
import HelpTooltipIcon from '@/components/ui/HelpTooltipIcon'
import IconBtn from '@/components/ui/IconBtn'
import TextInput from '@/components/ui/TextInput'
import Tooltip from '@/components/ui/Tooltip'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import {
  buildSnapRows,
  clampSnapOption,
  formatSnapStart,
  getDefaultSnapChecked,
  getSnapRetryIndexes,
  SNAP_DEFAULT_OPTIONS,
  type SnapAdvancedOptions,
  type SnapRow,
  type SnapSession
} from '@/lib/chapters/chapterSnap'
import { mergeClasses } from '@/lib/merge-classes'
import type { TypeSafeTranslations } from '@/types/translations'
import type { SnapChapterConfidence, SnapChapterReason } from '@/types/api'
import { useCallback, useId, useMemo, useState } from 'react'

/** The editor's chapter preview player (`useChapterPreviewAudio`). */
export interface SnapPreviewControls {
  selectedChapterId: number | string | null
  isPlayingChapter: boolean
  isLoadingChapter: boolean
  playChapter: (chapterId: number | string, chapterStart: number) => void
  destroyAudioEl: () => void
}

const SNAP_PREVIEW_PREFIX = 'snap-'

export interface SnapToAudioPanelProps {
  chapterCount: number
  disabled?: boolean
  /** Snap the current editor chapters. Resolves null on failure (the caller shows the toast). */
  onSnap: (options: SnapAdvancedOptions) => Promise<SnapSession | null>
  /** Snap the chapters the server did not get to, following the server's retry contract. */
  onRetry: (session: SnapSession) => Promise<SnapSession | null>
  /** Write the given rows' new starts into the editor as unsaved changes. Returns how many were applied. */
  onApply: (rows: SnapRow[]) => number
  preview?: SnapPreviewControls
}

type OptionKey = keyof SnapAdvancedOptions

const OPTION_FIELDS: {
  key: OptionKey
  labelKey: 'LabelSnapWindowSec' | 'LabelSnapMinSilenceSec' | 'LabelSnapNoiseDb' | 'LabelSnapHeadingLookbackSec'
  step: number
}[] = [
  { key: 'windowSec', labelKey: 'LabelSnapWindowSec', step: 1 },
  { key: 'minSilenceSec', labelKey: 'LabelSnapMinSilenceSec', step: 0.1 },
  { key: 'noiseDb', labelKey: 'LabelSnapNoiseDb', step: 1 },
  { key: 'headingLookbackSec', labelKey: 'LabelSnapHeadingLookbackSec', step: 0.5 }
]

function defaultOptionDrafts(): Record<OptionKey, string> {
  return {
    windowSec: String(SNAP_DEFAULT_OPTIONS.windowSec),
    minSilenceSec: String(SNAP_DEFAULT_OPTIONS.minSilenceSec),
    noiseDb: String(SNAP_DEFAULT_OPTIONS.noiseDb),
    headingLookbackSec: String(SNAP_DEFAULT_OPTIONS.headingLookbackSec)
  }
}

function parseOptionDrafts(drafts: Record<OptionKey, string>): SnapAdvancedOptions {
  const parse = (key: OptionKey) => {
    const trimmed = drafts[key].trim()
    return clampSnapOption(key, trimmed === '' ? NaN : Number(trimmed))
  }
  return {
    windowSec: parse('windowSec'),
    minSilenceSec: parse('minSilenceSec'),
    noiseDb: parse('noiseDb'),
    headingLookbackSec: parse('headingLookbackSec')
  }
}

export function snapReasonLabel(reason: SnapChapterReason, t: TypeSafeTranslations): string {
  switch (reason) {
    case 'first-chapter':
      return t('LabelSnapReasonFirstChapter')
    case 'inside-pause':
      return t('LabelSnapReasonInsidePause')
    case 'file-start':
      return t('LabelSnapReasonFileStart')
    case 'nearest-longest-pause':
      return t('LabelSnapReasonNearestPause')
    case 'heading-lookback':
      return t('LabelSnapReasonHeadingLookback')
    case 'no-pause-in-window':
      return t('LabelSnapReasonNoPause')
    case 'order-conflict':
      return t('LabelSnapReasonOrderConflict')
    case 'not-requested':
      return t('LabelSnapReasonNotRequested')
    case 'not-analysed':
      return t('LabelSnapReasonNotAnalysed')
    case 'analysis-failed':
      return t('LabelSnapReasonAnalysisFailed')
  }
}

function confidenceLabel(confidence: SnapChapterConfidence, t: TypeSafeTranslations): string {
  switch (confidence) {
    case 'high':
      return t('LabelSnapConfidenceHigh')
    case 'medium':
      return t('LabelSnapConfidenceMedium')
    case 'low':
      return t('LabelSnapConfidenceLow')
    case 'none':
      return t('LabelSnapConfidenceNone')
  }
}

const CONFIDENCE_CLASS: Record<SnapChapterConfidence, string> = {
  high: 'text-success',
  medium: 'text-foreground',
  low: 'text-warning font-semibold',
  none: 'text-foreground-muted'
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  return String(delta)
}

export default function SnapToAudioPanel({ chapterCount, disabled = false, onSnap, onRetry, onApply, preview }: SnapToAudioPanelProps) {
  const t = useTypeSafeTranslations()
  const settingsId = useId()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [optionDrafts, setOptionDrafts] = useState(defaultOptionDrafts)
  const [isRunning, setIsRunning] = useState(false)
  const [session, setSession] = useState<SnapSession | null>(null)
  const [checked, setChecked] = useState<Set<number>>(() => new Set())
  const [showUnchanged, setShowUnchanged] = useState(false)

  const rows = useMemo(() => (session ? buildSnapRows(session) : []), [session])
  const changedRows = useMemo(() => rows.filter((row) => row.changed), [rows])
  const visibleRows = showUnchanged ? rows : changedRows
  const retryCount = useMemo(() => (session ? getSnapRetryIndexes(session.response).length : 0), [session])
  const failedCount = useMemo(() => rows.filter((row) => row.reason === 'analysis-failed').length, [rows])
  const checkedChangedCount = changedRows.filter((row) => checked.has(row.index)).length
  const controlsDisabled = disabled || isRunning

  /** Proposal rows are the only controls for a snap preview, so stop it whenever they go away. */
  const stopSnapPreview = useCallback(() => {
    if (!preview) return
    const id = preview.selectedChapterId
    if (typeof id === 'string' && id.startsWith(SNAP_PREVIEW_PREFIX)) preview.destroyAudioEl()
  }, [preview])

  const showSession = useCallback((next: SnapSession) => {
    setSession(next)
    setChecked(getDefaultSnapChecked(buildSnapRows(next)))
  }, [])

  const handleSnap = useCallback(async () => {
    if (controlsDisabled) return
    stopSnapPreview()
    setIsRunning(true)
    try {
      const next = await onSnap(parseOptionDrafts(optionDrafts))
      if (next) {
        setShowUnchanged(false)
        showSession(next)
      }
    } finally {
      setIsRunning(false)
    }
  }, [controlsDisabled, onSnap, optionDrafts, showSession, stopSnapPreview])

  const handleRetry = useCallback(async () => {
    if (!session || controlsDisabled) return
    stopSnapPreview()
    setIsRunning(true)
    try {
      const next = await onRetry(session)
      if (next) {
        // Keep the user's choices for rows that were already shown; pre-check the newly analysed ones
        const retried = new Set(getSnapRetryIndexes(session.response))
        const defaults = getDefaultSnapChecked(buildSnapRows(next))
        setSession(next)
        setChecked((prev) => {
          const merged = new Set([...prev].filter((index) => !retried.has(index)))
          for (const index of defaults) if (retried.has(index)) merged.add(index)
          return merged
        })
      }
    } finally {
      setIsRunning(false)
    }
  }, [controlsDisabled, onRetry, session, stopSnapPreview])

  const handleApply = useCallback(() => {
    const picked = changedRows.filter((row) => checked.has(row.index))
    if (!picked.length) return
    stopSnapPreview()
    onApply(picked)
    setSession(null)
    setChecked(new Set())
  }, [changedRows, checked, onApply, stopSnapPreview])

  const handleClose = useCallback(() => {
    stopSnapPreview()
    setSession(null)
    setChecked(new Set())
  }, [stopSnapPreview])

  const toggleRow = useCallback((index: number, value: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(index)
      else next.delete(index)
      return next
    })
  }, [])

  const toggleAllChanged = useCallback(
    (value: boolean) => {
      setChecked(value ? new Set(changedRows.map((row) => row.index)) : new Set())
    },
    [changedRows]
  )

  const allChangedChecked = changedRows.length > 0 && checkedChangedCount === changedRows.length

  return (
    <div className="w-full min-w-0" cy-id="snap-to-audio-panel" aria-busy={isRunning || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Btn size="small" color="bg-primary" loading={isRunning} disabled={controlsDisabled || chapterCount <= 1} onClick={() => void handleSnap()}>
          {t('ButtonSnapToAudio')}
        </Btn>
        <HelpTooltipIcon text={t('MessageSnapToAudioDescription')} />
        <Tooltip lazy text={t('LabelSnapAdvancedSettings')} position="bottom">
          <IconBtn
            borderless
            size="small"
            ariaLabel={t('LabelSnapAdvancedSettings')}
            aria-expanded={settingsOpen}
            aria-controls={settingsId}
            className={mergeClasses('text-foreground-muted hover:not-disabled:text-foreground', settingsOpen && 'text-foreground')}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            tune
          </IconBtn>
        </Tooltip>
        {isRunning && (
          <span role="status" className="text-foreground-muted text-sm">
            {t('MessageSnapRunning')}
          </span>
        )}
      </div>

      {settingsOpen && (
        <div id={settingsId} className="mt-2 flex flex-wrap items-end gap-2" cy-id="snap-settings">
          {OPTION_FIELDS.map(({ key, labelKey, step }) => (
            <TextInput
              key={key}
              type="number"
              size="small"
              step={step}
              min={SNAP_DEFAULT_OPTIONS[key] < 0 ? undefined : 0}
              label={t(labelKey)}
              value={optionDrafts[key]}
              disabled={controlsDisabled}
              wrapperClassName="w-36"
              onChange={(value) => setOptionDrafts((prev) => ({ ...prev, [key]: value }))}
              onBlur={() => setOptionDrafts((prev) => ({ ...prev, [key]: String(parseOptionDrafts(prev)[key]) }))}
            />
          ))}
          <Btn size="small" disabled={controlsDisabled} onClick={() => setOptionDrafts(defaultOptionDrafts())}>
            {t('ButtonResetToDefault')}
          </Btn>
          <HelpTooltipIcon text={t('MessageSnapSettingsDescription')} />
        </div>
      )}

      {session && (
        <div className="border-border mt-3 rounded-md border" cy-id="snap-proposal" inert={isRunning || undefined}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
            <p className="text-sm" role="status">
              {changedRows.length > 0 ? t('MessageSnapSummary', { count: changedRows.length }) : t('MessageSnapNoChanges')}
            </p>
            <Checkbox value={showUnchanged} size="small" label={t('LabelSnapShowUnchanged')} onChange={setShowUnchanged} />
          </div>

          {!session.response.complete && (
            <div className="border-border flex flex-wrap items-center gap-2 border-t px-3 py-2 text-sm" cy-id="snap-incomplete">
              {retryCount > 0 && <span className="text-warning">{t('MessageSnapIncomplete', { count: retryCount })}</span>}
              {failedCount > 0 && <span className="text-warning">{t('MessageSnapAnalysisFailed', { count: failedCount })}</span>}
              {retryCount > 0 && (
                <Btn size="small" loading={isRunning} disabled={controlsDisabled} onClick={() => void handleRetry()}>
                  {t('ButtonSnapRetryRemaining')}
                </Btn>
              )}
            </div>
          )}

          {visibleRows.length > 0 && (
            <div className="border-border max-h-64 overflow-auto border-t">
              <table className="w-full text-sm">
                <thead className="bg-bg sticky top-0 z-1">
                  <tr className="border-border text-foreground-muted border-b text-start text-xs">
                    <th className="w-10 px-3 py-1.5">
                      <Checkbox
                        value={allChangedChecked}
                        partial={checkedChangedCount > 0 && !allChangedChecked}
                        size="small"
                        ariaLabel={t('LabelSnapSelectAllChanges')}
                        disabled={changedRows.length === 0}
                        onChange={toggleAllChanged}
                      />
                    </th>
                    <th className="px-2 py-1.5 text-start font-normal">{t('LabelTitle')}</th>
                    <th className="px-2 py-1.5 text-start font-normal">{t('LabelStart')}</th>
                    <th className="px-2 py-1.5 text-end font-normal">{t('LabelSnapChange')}</th>
                    <th className="px-2 py-1.5 text-start font-normal">{t('LabelSnapReason')}</th>
                    <th className="px-2 py-1.5 text-start font-normal">{t('LabelSnapConfidence')}</th>
                    <th className="w-10 px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const previewId = `${SNAP_PREVIEW_PREFIX}${row.index}`
                    const isPreviewSelected = preview?.selectedChapterId === previewId
                    const isPlaying = isPreviewSelected && !!preview?.isPlayingChapter
                    const playLabel = isPlaying ? t('MessagePauseChapter') : t('MessagePlaySnapProposal')
                    return (
                      <tr
                        key={row.clientKey}
                        cy-id="snap-row"
                        data-index={row.index}
                        className={mergeClasses('border-border border-b last:border-b-0', !row.changed && 'text-foreground-muted')}
                      >
                        <td className="px-3 py-1">
                          <Checkbox
                            value={row.changed && checked.has(row.index)}
                            size="small"
                            ariaLabel={row.title || t('LabelTitle')}
                            disabled={!row.changed}
                            onChange={(value) => toggleRow(row.index, value)}
                          />
                        </td>
                        <td className="max-w-48 truncate px-2 py-1" title={row.title}>
                          {row.title}
                        </td>
                        <td className="px-2 py-1 font-mono whitespace-nowrap">
                          {row.changed ? (
                            <>
                              {formatSnapStart(row.originalStart)}
                              <span className="text-foreground-muted px-1" aria-hidden="true">
                                {'→'}
                              </span>
                              {formatSnapStart(row.newStart)}
                            </>
                          ) : (
                            formatSnapStart(row.originalStart)
                          )}
                        </td>
                        <td className="px-2 py-1 text-end font-mono whitespace-nowrap">
                          {row.changed ? t('LabelSnapDelta', { delta: formatDelta(row.delta) }) : ''}
                        </td>
                        <td className="px-2 py-1">{snapReasonLabel(row.reason, t)}</td>
                        <td className={mergeClasses('px-2 py-1', CONFIDENCE_CLASS[row.confidence])}>{confidenceLabel(row.confidence, t)}</td>
                        <td className="px-2 py-0.5">
                          {preview && (
                            <Tooltip lazy text={playLabel} position="left">
                              <IconBtn
                                borderless
                                size="small"
                                ariaLabel={playLabel}
                                loading={isPreviewSelected && preview.isLoadingChapter}
                                className="text-foreground-muted hover:not-disabled:text-foreground"
                                onClick={() => preview.playChapter(previewId, row.newStart)}
                              >
                                {isPlaying ? 'pause' : 'play_arrow'}
                              </IconBtn>
                            </Tooltip>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-border flex flex-wrap justify-end gap-2 border-t px-3 py-2">
            <Btn size="small" disabled={isRunning} onClick={handleClose}>
              {t('ButtonClose')}
            </Btn>
            <Btn size="small" color="bg-success text-success-foreground" disabled={controlsDisabled || checkedChangedCount === 0} onClick={handleApply}>
              {t('ButtonSnapApply', { count: checkedChangedCount })}
            </Btn>
          </div>
        </div>
      )}
    </div>
  )
}
