'use client'

import { checkLibraryDuplicatesAction, getLibraryDuplicatesAction, updateDuplicateGroupAction } from '@/app/actions/libraryActions'
import DuplicateGroupsPanel from '@/components/widgets/duplicates/DuplicateGroupsPanel'
import { useLibrary } from '@/contexts/LibraryContext'
import { useSocketEvent } from '@/contexts/SocketContext'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useUser } from '@/contexts/UserContext'
import { useServerFeature } from '@/hooks/useServerFeatures'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import type { DuplicateGroup, DuplicateItemsUpdatedPayload, LibraryDuplicatesResponse } from '@/types/api'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Possible duplicates above the Issues bookshelf (fork server feature duplicateItems, admins only).
 * Hidden on a stock server and while a library has no groups, so the Issues page looks as before.
 */
export default function DuplicateItemsSection({ libraryId }: { libraryId: string }) {
  const t = useTypeSafeTranslations()
  const available = useServerFeature('duplicateItems')
  const { userIsAdminOrUp, serverSettings } = useUser()
  const { setNumDuplicateGroups } = useLibrary()
  const { showToast } = useGlobalToast()

  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [busyGroupIds, setBusyGroupIds] = useState<ReadonlySet<string>>(() => new Set())

  const enabled = available && userIsAdminOrUp

  const applyResponse = useCallback(
    (data: LibraryDuplicatesResponse) => {
      setGroups(data.groups)
      setLastCheckedAt(data.lastCheckedAt)
      setNumDuplicateGroups(data.numGroups)
      setError(null)
    },
    [setNumDuplicateGroups]
  )

  // Dismissed groups are always loaded so they can be restored; the toggle only filters what is shown
  const load = useCallback(async () => {
    const result = await getLibraryDuplicatesAction(libraryId, true)
    setLoading(false)
    if (!result.ok) {
      setError(result.error || t('ToastDuplicatesLoadFailed'))
      return
    }
    applyResponse(result.data)
  }, [applyResponse, libraryId, t])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load])

  // A background check finished (after a scan or an edit): reload what is shown
  const handleDuplicatesUpdated = useCallback(
    (data: DuplicateItemsUpdatedPayload) => {
      if (!enabled || data?.libraryId !== libraryId) return
      void load()
    },
    [enabled, libraryId, load]
  )
  useSocketEvent<DuplicateItemsUpdatedPayload>('duplicate_items_updated', handleDuplicatesUpdated, [handleDuplicatesUpdated])

  const handleCheck = useCallback(async () => {
    setChecking(true)
    const result = await checkLibraryDuplicatesAction(libraryId, true)
    setChecking(false)
    if (!result.ok) {
      showToast(result.error || t('ToastDuplicatesLoadFailed'), { type: 'error' })
      return
    }
    applyResponse(result.data)
  }, [applyResponse, libraryId, showToast, t])

  const handleSetDismissed = useCallback(
    async (groupId: string, dismissed: boolean) => {
      setBusyGroupIds((prev) => new Set(prev).add(groupId))
      const result = await updateDuplicateGroupAction(libraryId, groupId, dismissed)
      setBusyGroupIds((prev) => {
        const next = new Set(prev)
        next.delete(groupId)
        return next
      })
      if (!result.ok) {
        showToast(result.error || t('ToastDuplicateGroupUpdateFailed'), { type: 'error' })
        return
      }
      const updatedGroup = result.data.group
      setGroups((prev) => (updatedGroup ? prev.map((group) => (group.id === groupId ? updatedGroup : group)) : prev.filter((group) => group.id !== groupId)))
      setNumDuplicateGroups(result.data.numGroups)
    },
    [libraryId, setNumDuplicateGroups, showToast, t]
  )

  const shownGroups = useMemo(() => (showDismissed ? groups : groups.filter((group) => !group.dismissed)), [groups, showDismissed])

  // Keep the Issues page as it was when there is nothing to show
  if (!enabled || (!loading && !error && groups.length === 0)) return null

  return (
    <DuplicateGroupsPanel
      libraryId={libraryId}
      groups={shownGroups}
      loading={loading}
      checking={checking}
      showDismissed={showDismissed}
      busyGroupIds={busyGroupIds}
      dateFormat={serverSettings?.dateFormat || 'MM/dd/yyyy'}
      lastCheckedAt={lastCheckedAt}
      error={error}
      onCheck={() => void handleCheck()}
      onShowDismissedChange={setShowDismissed}
      onSetDismissed={(groupId, dismissed) => void handleSetDismissed(groupId, dismissed)}
    />
  )
}
