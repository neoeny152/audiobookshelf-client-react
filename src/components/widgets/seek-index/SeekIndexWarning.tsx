'use client'

import SeekIndexPanel from '@/components/widgets/seek-index/SeekIndexPanel'
import { useUser } from '@/contexts/UserContext'
import { useSeekIndex } from '@/hooks/useSeekIndex'
import { useServerFeature } from '@/hooks/useServerFeatures'
import { mergeClasses } from '@/lib/merge-classes'

interface SeekIndexWarningProps {
  libraryItemId: string
  chapterCount: number
  className?: string
}

/**
 * MP3 seek index warning and repair for a book. Shown to admins on servers with the mp3SeekIndex feature, and only
 * when there is something to say (files without a seek index, a repair running, or its result).
 */
export default function SeekIndexWarning({ libraryItemId, chapterCount, className }: SeekIndexWarningProps) {
  const hasFeature = useServerFeature('mp3SeekIndex')
  const { userIsAdminOrUp } = useUser()
  const enabled = hasFeature && userIsAdminOrUp
  const seekIndex = useSeekIndex({ libraryItemId, enabled })

  if (!enabled) return null

  return (
    // empty:hidden drops the wrapper's spacing while the panel has nothing to show
    <div className={mergeClasses('empty:hidden', className)}>
      <SeekIndexPanel
        status={seekIndex.status}
        chapterCount={chapterCount}
        running={seekIndex.running}
        progress={seekIndex.progress}
        measuring={seekIndex.measuring}
        starting={seekIndex.starting}
        error={seekIndex.error}
        result={seekIndex.result}
        taskError={seekIndex.taskError}
        onMeasure={seekIndex.measure}
        onRepair={seekIndex.repair}
        onDismissResult={seekIndex.dismissResult}
      />
    </div>
  )
}
