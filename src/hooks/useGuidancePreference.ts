'use client'

import { getGuidancePreference, subscribeGuidancePreference, type GuidancePreference } from '@/lib/itemHealth'
import { useSyncExternalStore } from 'react'

/** The guidance preference (see lib/itemHealth), null while unset and during server rendering */
export function useGuidancePreference(): GuidancePreference | null {
  return useSyncExternalStore(subscribeGuidancePreference, getGuidancePreference, () => null)
}
