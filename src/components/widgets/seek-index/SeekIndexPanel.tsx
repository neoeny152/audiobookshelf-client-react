'use client'

import Btn from '@/components/ui/Btn'
import Checkbox from '@/components/ui/Checkbox'
import Alert from '@/components/widgets/Alert'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { formatJsDatetime, secondsToTimestamp } from '@/lib/datefns'
import { bytesPretty } from '@/lib/string'
import type { SeekIndexBackup, SeekIndexRepairOptions, SeekIndexRepairResult, SeekIndexStatus } from '@/types/api'
import { useEffect, useState, type ReactNode } from 'react'

export interface SeekIndexPanelProps {
  status: SeekIndexStatus | null
  /** Saved chapters on the item; the shift option is offered when there are any */
  chapterCount: number
  running: boolean
  progress: string
  starting: boolean
  error: string | null
  result: SeekIndexRepairResult | null
  taskError: string | null
  onRepair: (options: SeekIndexRepairOptions) => void
  onRestore: (backupId: string) => void
  onDeleteBackup: (backupId: string) => void
  onDismissResult: () => void
}

type Confirm = { kind: 'repair' } | { kind: 'restore'; backup: SeekIndexBackup } | { kind: 'delete'; backup: SeekIndexBackup }

/** A successful result folds to its summary line after this long, unless the pointer or focus is on it */
const RESULT_COLLAPSE_MS = 5000

function signed(sec: number) {
  return `${sec >= 0 ? '+' : '−'}${Math.abs(sec).toFixed(1)}`
}

/** Checkbox for moving saved chapters with the files, with what it is for. Shared by the repair confirms. */
export function SeekIndexShiftChaptersOption({ chapterCount, value, onChange }: { chapterCount: number; value: boolean; onChange: (value: boolean) => void }) {
  const t = useTypeSafeTranslations()
  return (
    <div>
      <Checkbox value={value} size="small" label={t('LabelSeekIndexShiftChapters', { 0: chapterCount })} onChange={onChange} />
      <p className="text-foreground-muted mt-1 ps-7 text-xs">{t('LabelSeekIndexShiftChaptersHelp')}</p>
    </div>
  )
}

/**
 * MP3 files whose duration was estimated and is off (no Xing/Info/VBRI header, measured drift over 1 s): the warning
 * with the repair action (confirm, progress, result with old vs new durations), and the repair backups with
 * restore and delete.
 */
export default function SeekIndexPanel({
  status,
  chapterCount,
  running,
  progress,
  starting,
  error,
  result,
  taskError,
  onRepair,
  onRestore,
  onDeleteBackup,
  onDismissResult
}: SeekIndexPanelProps) {
  const t = useTypeSafeTranslations()
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [shiftChapters, setShiftChapters] = useState(false)
  /** Whether the result shown at `finishedAt` is folded; unset until the timer or the Details button decides */
  const [folded, setFolded] = useState<{ finishedAt: number; collapsed: boolean } | null>(null)
  const [resultHeld, setResultHeld] = useState(false)

  const flagged = status?.files.filter((f) => f.needsRepair) ?? []
  const backups = status?.backups ?? []
  const interrupted = running ? null : (status?.interrupted ?? null)
  const showWarning = !running && (flagged.length > 0 || !!interrupted)

  const resultFailed = !!taskError || !!result?.files.some((f) => f.status === 'failed')
  const resultFinishedAt = result && !running && !resultFailed ? result.finishedAt : null
  const foldDecided = folded?.finishedAt === resultFinishedAt
  useEffect(() => {
    if (resultFinishedAt === null || foldDecided || resultHeld) return
    const timer = setTimeout(() => setFolded({ finishedAt: resultFinishedAt, collapsed: true }), RESULT_COLLAPSE_MS)
    return () => clearTimeout(timer)
  }, [foldDecided, resultFinishedAt, resultHeld])

  if (!running && !result && !showWarning && !error && !backups.length) return null

  const backupDate = (backup: SeekIndexBackup) => formatJsDatetime(new Date(backup.createdAt))
  const doneCount = result?.files.filter((f) => f.status !== 'failed').length ?? 0
  const collapsed = foldDecided && !!folded?.collapsed
  const resultBackup = result?.backupId ? backups.find((b) => b.id === result.backupId) : undefined
  // Only once the status has caught up with this result does a missing backup mean it was deleted
  const backupDeleted = !resultBackup && status?.lastResult?.finishedAt === result?.finishedAt

  let confirmMessage: ReactNode = null
  if (confirm?.kind === 'repair') {
    confirmMessage = (
      <div className="flex flex-col gap-3" cy-id="seek-index-confirm">
        <p>{t('MessageConfirmRepairSeekIndex', { 0: flagged.length })}</p>
        {chapterCount > 0 && <SeekIndexShiftChaptersOption chapterCount={chapterCount} value={shiftChapters} onChange={setShiftChapters} />}
      </div>
    )
  } else if (confirm?.kind === 'restore') {
    confirmMessage = (
      <p cy-id="seek-index-confirm">{t('MessageConfirmRestoreSeekIndexBackup', { 0: confirm.backup.files.length, 1: backupDate(confirm.backup) })}</p>
    )
  } else if (confirm?.kind === 'delete') {
    confirmMessage = (
      <p cy-id="seek-index-confirm">
        {t('MessageConfirmDeleteSeekIndexBackup', { 0: confirm.backup.files.length, 1: backupDate(confirm.backup), 2: bytesPretty(confirm.backup.size) })}
      </p>
    )
  }

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
        <Alert type={resultFailed ? 'error' : 'success'} autoFocus={false}>
          <div
            className="flex items-start gap-3 text-sm"
            cy-id="seek-index-result"
            onMouseEnter={() => setResultHeld(true)}
            onMouseLeave={() => setResultHeld(false)}
            onFocus={() => setResultHeld(true)}
            onBlur={() => setResultHeld(false)}
          >
            <div className="min-w-0 flex-1">
              {doneCount > 0 && (
                <p>
                  {t(result.type === 'restore' ? 'MessageSeekIndexRestoreDone' : 'MessageSeekIndexRepairDone', {
                    0: doneCount,
                    1: secondsToTimestamp(result.oldTotalDuration),
                    2: secondsToTimestamp(result.newTotalDuration),
                    3: signed(result.newTotalDuration - result.oldTotalDuration)
                  })}{' '}
                  {!resultFailed && (
                    <button
                      type="button"
                      className="link-underline text-xs"
                      aria-expanded={!collapsed}
                      cy-id="seek-index-result-details"
                      onClick={() => setFolded({ finishedAt: result.finishedAt, collapsed: !collapsed })}
                    >
                      {t('ButtonDetails')}
                    </button>
                  )}
                </p>
              )}
              {taskError && <p>{t(result.type === 'restore' ? 'MessageSeekIndexRestoreFailed' : 'MessageSeekIndexRepairFailed', { 0: taskError })}</p>}
              {!collapsed && (
                <>
                  <ul className="text-foreground-muted mt-1 list-none text-xs">
                    {result.files.map((f) => (
                      <li key={`${f.ino}-${f.filename}`} cy-id="seek-index-result-file">
                        {f.status !== 'failed' && f.newDuration != null
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
                  {result.chapters.count > 0 && doneCount > 0 && (
                    <p className="mt-1" cy-id="seek-index-result-chapters">
                      {result.type === 'restore'
                        ? result.chapters.restored
                          ? t('MessageSeekIndexChaptersRestored')
                          : t('MessageSeekIndexChaptersLeft')
                        : result.chapters.shifted
                          ? t('MessageSeekIndexChaptersShifted', { 0: result.chapters.maxShift.toFixed(1) })
                          : result.chapters.endExtended
                            ? t('MessageSeekIndexChaptersKeptEndExtended')
                            : t('MessageSeekIndexChaptersKept')}
                    </p>
                  )}
                  {result.type === 'repair' && (resultBackup || backupDeleted) && (
                    <p className="mt-1" cy-id="seek-index-result-backup">
                      {resultBackup ? t('MessageSeekIndexBackupKept', { 0: bytesPretty(resultBackup.size) }) : t('MessageSeekIndexBackupDeleted')}
                    </p>
                  )}
                </>
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
              {interrupted && (
                <p className="font-semibold" cy-id="seek-index-interrupted">
                  {t('MessageSeekIndexRepairInterrupted', { 0: interrupted.pendingCount })}
                </p>
              )}
              {flagged.length > 0 && <p>{t('MessageSeekIndexMissing', { 0: flagged.length, 1: (status?.maxDrift ?? 0).toFixed(1) })}</p>}
              <ul className="text-foreground-muted mt-1 list-none text-xs">
                {flagged.map((f) => (
                  <li key={f.ino} cy-id="seek-index-measured">
                    {t('MessageSeekIndexFileDuration', {
                      0: f.filename,
                      1: secondsToTimestamp(f.duration),
                      2: secondsToTimestamp(f.measuredDuration ?? f.duration),
                      3: signed(f.durationError ?? 0)
                    })}
                  </li>
                ))}
              </ul>
            </div>
            {interrupted ? (
              // Continues a repair that was already confirmed, with the chapter choice made then
              <Btn size="small" loading={starting} onClick={() => onRepair({ chapters: interrupted.mode })}>
                {t('ButtonResumeSeekIndexRepair')}
              </Btn>
            ) : (
              <Btn size="small" loading={starting} onClick={() => setConfirm({ kind: 'repair' })}>
                {t('ButtonRepairSeekIndex')}
              </Btn>
            )}
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

      {backups.length > 0 && !running && (
        <div className="border-border rounded-md border px-3 py-2 text-sm" cy-id="seek-index-backups">
          {backups.map((backup) => (
            <div key={backup.id} className="flex flex-wrap items-center gap-2 py-1" cy-id="seek-index-backup">
              <p className="min-w-0 flex-1 basis-48">
                {t('LabelSeekIndexBackup', { 0: backupDate(backup), 1: backup.files.length, 2: bytesPretty(backup.size) })}
              </p>
              <Btn size="small" disabled={starting} onClick={() => setConfirm({ kind: 'restore', backup })}>
                {t('ButtonRestoreSeekIndexBackup')}
              </Btn>
              <Btn size="small" color="bg-error text-error-foreground" disabled={starting} onClick={() => setConfirm({ kind: 'delete', backup })}>
                {t('ButtonDeleteSeekIndexBackup')}
              </Btn>
            </div>
          ))}
          <p className="text-foreground-muted text-xs" cy-id="seek-index-backups-total">
            {t('MessageSeekIndexBackupsTotal', { 0: bytesPretty(status?.backupsTotalSize ?? 0) })}
          </p>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        message={confirmMessage}
        yesButtonText={
          confirm?.kind === 'restore'
            ? t('ButtonRestoreSeekIndexBackup')
            : confirm?.kind === 'delete'
              ? t('ButtonDeleteSeekIndexBackup')
              : t('ButtonRepairSeekIndex')
        }
        yesButtonClassName={confirm?.kind === 'delete' ? 'bg-error text-error-foreground' : 'bg-primary'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const current = confirm
          setConfirm(null)
          if (current?.kind === 'repair') onRepair({ chapters: chapterCount > 0 && shiftChapters ? 'shift' : 'keep' })
          else if (current?.kind === 'restore') onRestore(current.backup.id)
          else if (current?.kind === 'delete') onDeleteBackup(current.backup.id)
        }}
      />
    </div>
  )
}
