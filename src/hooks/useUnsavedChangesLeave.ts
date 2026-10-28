'use client'

import type { UnsavedChangesLeaveHandle } from '@/components/modals/LibraryItemModal'
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

interface UseUnsavedChangesLeaveOptions {
  /** When false, leave requests run right away. */
  isDirty: boolean
  /** Lets the parent intercept leave (section change, hub back, close, prev/next). */
  closeRequestRef?: Ref<UnsavedChangesLeaveHandle | null>
  /** Runs right before every leave that goes through (clean, discarded, or saved). */
  onBeforeLeave?: () => void
  /** Runs when the user discards their changes, before `onBeforeLeave`. */
  onDiscard?: () => void
}

/**
 * Confirm-before-leave state for an editor with unsaved changes.
 * `requestLeave` holds the leave while dirty and shows the confirm; the confirm's buttons call
 * `cancelLeave`, `discardAndLeave`, or save and then complete the held leave.
 */
export function useUnsavedChangesLeave({ isDirty, closeRequestRef, onBeforeLeave, onDiscard }: UseUnsavedChangesLeaveOptions) {
  const pendingLeaveRef = useRef<(() => void) | null>(null)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)

  const leave = useCallback(
    (onAllow: (() => void) | null) => {
      pendingLeaveRef.current = null
      setShowLeaveConfirm(false)
      onBeforeLeave?.()
      onAllow?.()
    },
    [onBeforeLeave]
  )

  const requestLeave = useCallback(
    (onAllow: () => void) => {
      if (isDirty) {
        pendingLeaveRef.current = onAllow
        setShowLeaveConfirm(true)
        return
      }
      onBeforeLeave?.()
      onAllow()
    },
    [isDirty, onBeforeLeave]
  )

  const cancelLeave = useCallback(() => {
    pendingLeaveRef.current = null
    setShowLeaveConfirm(false)
  }, [])

  const discardAndLeave = useCallback(() => {
    const onAllow = pendingLeaveRef.current
    pendingLeaveRef.current = null
    setShowLeaveConfirm(false)
    onDiscard?.()
    onBeforeLeave?.()
    onAllow?.()
  }, [onBeforeLeave, onDiscard])

  /** After a save: run the held leave, if any. Returns false when no leave was held. */
  const completePendingLeave = useCallback(() => {
    const onAllow = pendingLeaveRef.current
    if (!onAllow) return false
    leave(onAllow)
    return true
  }, [leave])

  /** Snapshot the held leave now and return a callback that completes it (e.g. after an async save). */
  const captureLeave = useCallback(() => {
    const onAllow = pendingLeaveRef.current
    return () => leave(onAllow)
  }, [leave])

  useImperativeHandle(closeRequestRef, () => ({ requestLeave }), [requestLeave])

  // Reload, tab close, or a full page load while dirty. A plain listener on purpose:
  // useUnsavedNavigationGuard's history trap would clash with useModalHistory.
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  return {
    showLeaveConfirm,
    requestLeave,
    cancelLeave,
    discardAndLeave,
    completePendingLeave,
    captureLeave
  }
}
