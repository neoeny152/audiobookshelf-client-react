'use client'

import Btn from '@/components/ui/Btn'
import Checkbox from '@/components/ui/Checkbox'
import Alert from '@/components/widgets/Alert'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { secondsToTimestamp } from '@/lib/datefns'
import type { SeekIndexRepairOptions, SeekIndexRepairResult, SeekIndexStatus } from '@/types/api'
import { useState } from 'react'

export interface SeekIndexPanelProps {
  status: SeekIndexStatus | null
  /** Saved chapters on the item; the shift option is offered when there are any */
  chapterCount: number
  running: boolean
  progress: string
  measuring: boolean
  starting: boolean
  error: string | null
  result: SeekIndexRepairResult | null
  taskError: string | null
  onMeasure: () => void
  onRepair: (options: SeekIndexRepairOptions) => void
  onDismissResult: () => void
}

/** Drift below this is shown as "no drift" (ffprobe's estimate is exact for true CBR files). */
const NO_DRIFT_SEC = 0.5

function signed(sec: number) {
  return `${sec >= 0 ? '+' : '−'}${Math.abs(sec).toFixed(1)}`
}

/**
 * Warning for MP3 files without a Xing/Info/VBRI header, with an on-demand drift measurement and the repair action
 * (confirm dialog, progress, result with old vs new durations).
 */
export default function SeekIndexPanel({
  status,
  chapterCount,
  running,
  progress,
  measuring,
  starting,
  error,
  result,
  taskError,
  onMeasure,
  onRepair,
  onDismissResult
}: SeekIndexPanelProps) {
  const t = useTypeSafeTranslations()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [shiftChapters, setShiftChapters] = useState(false)

  const flagged = status?.files.filter((f) => f.needsRepair) ?? []
  const showWarning = !running && flagged.length > 0

  if (!running && !result && !showWarning && !error) return null

  return (
    <div className="flex flex-col gap-2" cy-id="seek-index-panel">
      {running && (
        <Alert type="info" autoFocus={false}>
          <p className="text-sm" cy-id="seek-index-progress">
            {t('MessageSeekIndexRepairing', { 0: progress })}
          </p>
        </Alert>
      )}

      {result && !running && (
        <Alert type={taskError || result.files.some((f) => f.status === 'failed') ? 'error' : 'success'} autoFocus={false}>
          <div className="flex items-start gap-3 text-sm" cy-id="seek-index-result">
            <div className="min-w-0 flex-1">
              {result.files.some((f) => f.status === 'repaired') && (
                <p>
                  {t('MessageSeekIndexRepairDone', {
                    0: result.files.filter((f) => f.status === 'repaired').length,
                    1: secondsToTimestamp(result.oldTotalDuration),
                    2: secondsToTimestamp(result.newTotalDuration),
                    3: signed(result.newTotalDuration - result.oldTotalDuration)
                  })}
                </p>
              )}
              {taskError && <p>{t('MessageSeekIndexRepairFailed', { 0: taskError })}</p>}
              <ul className="text-foreground-muted mt-1 list-none text-xs">
                {result.files.map((f) => (
                  <li key={f.ino} cy-id="seek-index-result-file">
                    {f.status === 'repaired' && f.newDuration != null
                      ? t('MessageSeekIndexFileDuration', {
                          0: f.filename,
                          1: secondsToTimestamp(f.oldDuration),
                          2: secondsToTimestamp(f.newDuration),
                          3: signed(f.newDuration - f.oldDuration)
                        })
                      : t('MessageSeekIndexFileFailed', { 0: f.filename, 1: f.error ?? '' })}
                  </li>
                ))}
              </ul>
              {result.chapters.count > 0 && result.files.some((f) => f.status === 'repaired') && (
                <p className="mt-1" cy-id="seek-index-result-chapters">
                  {result.chapters.shifted
                    ? t('MessageSeekIndexChaptersShifted', { 0: result.chapters.maxShift.toFixed(1) })
                    : result.chapters.endExtended
                      ? t('MessageSeekIndexChaptersKeptEndExtended')
                      : t('MessageSeekIndexChaptersKept')}
                </p>
              )}
            </div>
            <button
              type="button"
              className="material-symbols text-foreground-muted hover:text-foreground text-lg"
              aria-label={t('ButtonClose')}
              onClick={onDismissResult}
            >
              close
            </button>
          </div>
        </Alert>
      )}

      {showWarning && (
        <Alert type="warning" autoFocus={false}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" cy-id="seek-index-warning">
            <div className="min-w-0 flex-1 basis-64">
              <p>{t('MessageSeekIndexMissing', { 0: flagged.length })}</p>
              {flagged.some((f) => f.measuredDuration != null) && (
                <ul className="text-foreground-muted mt-1 list-none text-xs">
                  {flagged.map((f) =>
                    f.measuredDuration == null ? null : (
                      <li key={f.ino} cy-id="seek-index-measured">
                        {Math.abs(f.durationError ?? 0) < NO_DRIFT_SEC
                          ? t('MessageSeekIndexNoDrift', { 0: f.filename })
                          : t('MessageSeekIndexFileDuration', {
                              0: f.filename,
                              1: secondsToTimestamp(f.duration),
                              2: secondsToTimestamp(f.measuredDuration),
                              3: signed(f.durationError ?? 0)
                            })}
                      </li>
                    )
                  )}
                </ul>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Btn size="small" loading={measuring} disabled={starting} onClick={onMeasure}>
                {t('ButtonMeasureSeekDrift')}
              </Btn>
              <Btn size="small" loading={starting} disabled={measuring} onClick={() => setConfirmOpen(true)}>
                {t('ButtonRepairSeekIndex')}
              </Btn>
            </div>
          </div>
        </Alert>
      )}

      {error && !running && (
        <Alert type="error" autoFocus={false}>
          <p className="text-sm" cy-id="seek-index-error">
            {t('MessageSeekIndexRepairFailed', { 0: error })}
          </p>
        </Alert>
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        message={
          <div className="flex flex-col gap-3" cy-id="seek-index-confirm">
            <p>{t('MessageConfirmRepairSeekIndex', { 0: flagged.length })}</p>
            {chapterCount > 0 && (
              <div>
                <Checkbox value={shiftChapters} size="small" label={t('LabelSeekIndexShiftChapters', { 0: chapterCount })} onChange={setShiftChapters} />
                <p className="text-foreground-muted mt-1 ps-7 text-xs">{t('LabelSeekIndexShiftChaptersHelp')}</p>
              </div>
            )}
          </div>
        }
        yesButtonText={t('ButtonRepairSeekIndex')}
        yesButtonClassName="bg-primary"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          onRepair({ chapters: chapterCount > 0 && shiftChapters ? 'shift' : 'keep' })
        }}
      />
    </div>
  )
}
