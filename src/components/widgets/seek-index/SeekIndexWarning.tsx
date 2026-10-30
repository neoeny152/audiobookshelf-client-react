'use client'

import SeekIndexPanel from '@/components/widgets/seek-index/SeekIndexPanel'
import { useUser } from '@/contexts/UserContext'
import { useSeekIndex, type SeekIndexState } from '@/hooks/useSeekIndex'
import { useServerFeature } from '@/hooks/useServerFeatures'
import { mergeClasses } from '@/lib/merge-classes'

/** Server has the mp3SeekIndex feature and the user may use it (the endpoints are admin only). */
export function useSeekIndexEnabled() {
  const hasFeature = useServerFeature('mp3SeekIndex')
  const { userIsAdminOrUp } = useUser()
  return hasFeature && userIsAdminOrUp
}

interface SeekIndexPanelForStateProps {
  seekIndex: SeekIndexState
  chapterCount: number
  className?: string
}

/** The panel driven by a useSeekIndex() state owned by the caller (the chapter editor shares it with its snap guard). */
export function SeekIndexPanelForState({ seekIndex, chapterCount, className }: SeekIndexPanelForStateProps) {
  return (
    // empty:hidden drops the wrapper's spacing while the panel has nothing to show
    <div className={mergeClasses('empty:hidden', className)}>
      <SeekIndexPanel
        status={seekIndex.status}
        chapterCount={chapterCount}
        running={seekIndex.running}
        progress={seekIndex.progress}
        starting={seekIndex.starting}
        error={seekIndex.error}
        result={seekIndex.result}
        taskError={seekIndex.taskError}
        onRepair={(options) => void seekIndex.repair(options)}
        onRestore={(backupId) => void seekIndex.restore(backupId)}
        onDeleteBackup={(backupId) => void seekIndex.deleteBackup(backupId)}
        onDismissResult={seekIndex.dismissResult}
      />
    </div>
  )
}

interface SeekIndexWarningProps {
  libraryItemId: string
  chapterCount: number
  className?: string
}

/**
 * MP3 seek index warning, repair and backups for a book. Shown to admins on servers with the mp3SeekIndex feature,
 * and only when there is something to say.
 */
export default function SeekIndexWarning({ libraryItemId, chapterCount, className }: SeekIndexWarningProps) {
  const enabled = useSeekIndexEnabled()
  const seekIndex = useSeekIndex({ libraryItemId, enabled })
  if (!enabled) return null
  return <SeekIndexPanelForState seekIndex={seekIndex} chapterCount={chapterCount} className={className} />
}
