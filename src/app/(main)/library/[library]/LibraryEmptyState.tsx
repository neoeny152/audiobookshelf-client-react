import Btn from '@/components/ui/Btn'
import PageMessage from '@/components/ui/PageMessage'
import { useTasks } from '@/contexts/TasksContext'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { Library } from '@/types/api'
import { useMemo, useTransition } from 'react'
import { requestScanLibrary } from '../../settings/libraries/actions'

export type LibraryEmptyStateVariant = 'library-empty' | 'no-home-shelves'

interface LibraryEmptyStateProps {
  library: Library
  showScanButton: boolean
  variant?: LibraryEmptyStateVariant
}

export default function LibraryEmptyState({ library, showScanButton, variant = 'library-empty' }: LibraryEmptyStateProps) {
  const t = useTypeSafeTranslations()
  const [isPending, startTransition] = useTransition()
  const { getTasksByLibraryId } = useTasks()
  const { showToast } = useGlobalToast()

  const isLibraryTaskRunning = useMemo(() => {
    return getTasksByLibraryId(library.id).some((task) => task.action === 'library-scan' && !task.isFinished)
  }, [getTasksByLibraryId, library.id])

  const handleScanLibrary = () => {
    startTransition(async () => {
      try {
        const result = await requestScanLibrary(library.id)
        if (!result.ok) {
          showToast(result.error || t('ToastLibraryScanFailedToStart'), { type: 'error' })
        }
      } catch (error) {
        console.error('Failed to scan library', error)
        showToast(t('ToastLibraryScanFailedToStart'), { type: 'error' })
      }
    })
  }

  if (variant === 'no-home-shelves') {
    const browseLabel = library.mediaType === 'podcast' ? t('LabelPodcasts') : t('LabelBooks')

    return (
      <PageMessage message={t('MessageNoHomeShelves')}>
        <Btn size="small" color="bg-success text-success-foreground" to={`/library/${library.id}/items`}>
          {browseLabel}
        </Btn>
      </PageMessage>
    )
  }

  return (
    <PageMessage message={t('MessageXLibraryIsEmpty', { 0: library.name })}>
      {showScanButton ? (
        <Btn size="small" color="bg-success text-success-foreground" onClick={handleScanLibrary} loading={isPending || isLibraryTaskRunning}>
          {t('ButtonScanLibrary')}
        </Btn>
      ) : null}
    </PageMessage>
  )
}
