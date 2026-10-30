'use client'

import Dropdown, { type DropdownItem } from '@/components/ui/Dropdown'
import TextInput from '@/components/ui/TextInput'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import {
  clampMinConfidence,
  clampSettleMinutes,
  isAudibleProvider,
  LOW_CONFIDENCE_WARNING,
  MIN_CONFIDENCE_BOUNDS,
  SETTLE_MINUTES_BOUNDS,
  withAutoPipelineDefaults
} from '@/lib/autoPipeline'
import type { AutoPipelineMode, AutoPipelineSettings } from '@/types/api'
import { useEffect, useId, useState } from 'react'
import SettingsToggleSwitch from '../SettingsToggleSwitch'

/** Server features this section depends on (read by the host with useServerFeature). */
export interface AutoPipelineFeatures {
  /** `autoPipeline`: without it the section is not shown at all. */
  autoPipeline: boolean
  /** `chapterbotEpub`: without it the EPUB step cannot run. */
  chapterbotEpub: boolean
  /** `chapterbotVerify`: without it every chapter result needs review (no speech check). */
  chapterbotVerify: boolean
}

export interface AutoPipelineSettingsSectionProps {
  /** `library.settings.autoPipeline` as stored (may be missing on older libraries). */
  value: AutoPipelineSettings | undefined
  /** The library's metadata provider (the default for matching). */
  libraryProvider: string
  /** Audible providers to offer as a match provider override. */
  audibleProviders?: DropdownItem[]
  features: AutoPipelineFeatures
  onChange: (next: AutoPipelineSettings) => void
}

/**
 * A number field that commits on blur or Enter (not while typing). Above the maximum it is clamped; empty, non-numeric
 * or below the minimum it goes back to the saved value.
 */
function NumberSetting({
  label,
  value,
  bounds,
  clamp,
  onCommit,
  suffix,
  cyId
}: {
  label: string
  value: number
  bounds: readonly [number, number]
  clamp: (value: number) => number
  onCommit: (value: number) => void
  suffix?: string
  cyId: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    // An empty, non-numeric or too small value keeps the saved one. Number('') is 0, and raising that (or a "9" typed on
    // the way to "97") to the minimum would quietly pick the loosest match threshold the server accepts.
    const typed = draft.trim() === '' ? NaN : Number(draft)
    if (!Number.isFinite(typed) || Math.round(typed) < bounds[0]) {
      setDraft(String(value))
      return
    }
    const next = clamp(typed)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }
  return (
    <div className="flex min-w-0 items-end gap-2" cy-id={cyId}>
      <div className="relative w-28 shrink-0">
        <TextInput
          label={label}
          type="number"
          value={draft}
          min={bounds[0]}
          max={bounds[1]}
          step={1}
          onChange={setDraft}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          customInputClass="no-spinner"
        />
      </div>
      {suffix && <span className="text-foreground-muted pb-2 text-sm">{suffix}</span>}
    </div>
  )
}

/**
 * "Automatic processing" (fork only): when a new book shows up, match it to Audible when the match is certain enough,
 * take and check its chapters, and optionally make an EPUB. Hidden unless the server advertises `autoPipeline`.
 */
export default function AutoPipelineSettingsSection({ value, libraryProvider, audibleProviders = [], features, onChange }: AutoPipelineSettingsSectionProps) {
  const t = useTypeSafeTranslations()
  const headingId = useId()
  const [confirmAutoRepair, setConfirmAutoRepair] = useState(false)
  if (!features.autoPipeline) return null

  const settings = withAutoPipelineDefaults(value)
  const update = (patch: Partial<AutoPipelineSettings>) => onChange({ ...settings, ...patch })
  const off = settings.mode === 'off'
  const effectiveProvider = settings.autoMatchProvider || libraryProvider
  const audible = isAudibleProvider(effectiveProvider)

  const modeItems: DropdownItem[] = [
    { text: t('LabelAutoPipelineModeOff'), value: 'off' },
    { text: t('LabelAutoPipelineModeDryRun'), value: 'dryRun' },
    { text: t('LabelAutoPipelineModeOn'), value: 'on' }
  ]
  const providerItems: DropdownItem[] = [
    { text: t('LabelAutoPipelineProviderLibrary'), value: '' },
    ...audibleProviders.filter((item) => isAudibleProvider(String(item.value)))
  ]

  return (
    <section className="border-border flex min-w-0 flex-col gap-3 border-t pt-4" aria-labelledby={headingId} cy-id="auto-pipeline-settings">
      <div>
        <h3 id={headingId} className="text-base font-semibold">
          {t('HeaderAutoPipeline')}
        </h3>
        <p className="text-foreground-muted text-sm">{t('MessageAutoPipelineDescription')}</p>
      </div>

      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <Dropdown
          label={t('LabelAutoPipelineMode')}
          items={modeItems}
          value={settings.mode}
          onChange={(mode) => update({ mode: mode as AutoPipelineMode })}
          className="w-56 max-w-full min-w-0"
        />
        {settings.mode === 'dryRun' && (
          <p className="text-foreground-muted pb-2 text-sm" cy-id="auto-pipeline-dry-run-note">
            {t('MessageAutoPipelineDryRun')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <SettingsToggleSwitch
            label={t('LabelAutoPipelineMatch')}
            value={settings.autoMatch}
            disabled={off}
            onChange={(autoMatch) => update({ autoMatch })}
            tooltip={t('LabelAutoPipelineMatchHelp')}
          />
          <SettingsToggleSwitch
            label={t('LabelAutoPipelineChapters')}
            value={settings.autoChapters}
            disabled={off}
            onChange={(autoChapters) => update({ autoChapters })}
            tooltip={t('LabelAutoPipelineChaptersHelp')}
          />
          {!features.chapterbotVerify && (
            <p className="text-foreground-muted text-xs" cy-id="auto-pipeline-no-verify">
              {t('MessageAutoPipelineNoSpeechCheck')}
            </p>
          )}
          <SettingsToggleSwitch
            label={t('LabelAutoPipelineEpub')}
            value={settings.autoEpub && features.chapterbotEpub}
            disabled={off || !features.chapterbotEpub}
            onChange={(autoEpub) => update({ autoEpub })}
            tooltip={features.chapterbotEpub ? t('LabelAutoPipelineEpubHelp') : t('MessageAutoPipelineNoEpub')}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <NumberSetting
            label={t('LabelAutoPipelineMinConfidence')}
            value={settings.autoMatchMinConfidence}
            bounds={MIN_CONFIDENCE_BOUNDS}
            clamp={clampMinConfidence}
            onCommit={(autoMatchMinConfidence) => update({ autoMatchMinConfidence })}
            suffix="%"
            cyId="auto-pipeline-min-confidence"
          />
          {settings.autoMatchMinConfidence < LOW_CONFIDENCE_WARNING && (
            <p className="bg-warning/15 border-warning/60 rounded-md border px-3 py-2 text-xs" role="note" cy-id="auto-pipeline-low-confidence">
              {t('MessageAutoPipelineLowConfidence', { confidence: String(settings.autoMatchMinConfidence) })}
            </p>
          )}
          <NumberSetting
            label={t('LabelAutoPipelineSettleMinutes')}
            value={settings.settleMinutes}
            bounds={SETTLE_MINUTES_BOUNDS}
            clamp={clampSettleMinutes}
            onCommit={(settleMinutes) => update({ settleMinutes })}
            cyId="auto-pipeline-settle"
          />
          {audibleProviders.length > 0 && (
            <Dropdown
              label={t('LabelAutoPipelineProvider')}
              items={providerItems}
              value={settings.autoMatchProvider ?? ''}
              onChange={(provider) => update({ autoMatchProvider: provider ? String(provider) : null })}
              className="w-72 max-w-full min-w-0"
            />
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2" cy-id="auto-pipeline-repair-sweep">
        {/* Not tied to the mode: Fix automatically on the item page uses it too, and it can always be turned off */}
        <SettingsToggleSwitch
          label={t('LabelAutoPipelineAutoRepair')}
          value={settings.autoRepairSeekIndex}
          onChange={(on) => (on ? setConfirmAutoRepair(true) : update({ autoRepairSeekIndex: false }))}
          tooltip={t('LabelAutoPipelineAutoRepairHelp')}
        />
        <SettingsToggleSwitch
          label={t('LabelAutoPipelineNightlySweep')}
          value={settings.nightlySweep}
          disabled={off}
          onChange={(nightlySweep) => update({ nightlySweep })}
          tooltip={t('LabelAutoPipelineNightlySweepHelp')}
        />
        {settings.nightlySweep && (
          <div className="flex flex-wrap items-end gap-2" cy-id="auto-pipeline-sweep-window">
            <TextInput
              type="time"
              label={t('LabelAutoPipelineSweepFrom')}
              value={settings.sweepStart}
              disabled={off}
              className="w-32"
              // the server refuses equal start and end
              onChange={(sweepStart) => sweepStart && sweepStart !== settings.sweepEnd && update({ sweepStart })}
            />
            <TextInput
              type="time"
              label={t('LabelAutoPipelineSweepTo')}
              value={settings.sweepEnd}
              disabled={off}
              className="w-32"
              onChange={(sweepEnd) => sweepEnd && sweepEnd !== settings.sweepStart && update({ sweepEnd })}
            />
          </div>
        )}
      </div>

      {!audible && (
        <p className="bg-warning/15 border-warning/60 rounded-md border px-3 py-2 text-sm" role="note" cy-id="auto-pipeline-provider-warning">
          {t('MessageAutoPipelineNotAudible')}
        </p>
      )}

      <ConfirmDialog
        isOpen={confirmAutoRepair}
        message={t('MessageConfirmAutoRepairSeekIndex')}
        yesButtonClassName="bg-primary"
        onClose={() => setConfirmAutoRepair(false)}
        onConfirm={() => {
          setConfirmAutoRepair(false)
          update({ autoRepairSeekIndex: true })
        }}
      />
    </section>
  )
}
