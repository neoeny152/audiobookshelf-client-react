'use client'

import { getServerFeaturesAction } from '@/app/actions/serverFeatureActions'
import { hasServerFeature, type ServerFeature } from '@/lib/serverFeatures'
import { useEffect, useState } from 'react'

/** Optional features can appear or go away while the app is open (chapterbot health), so re-check after this long. */
const FEATURES_TTL_MS = 60_000
const NO_FEATURES: readonly string[] = Object.freeze([])

let cached: { features: readonly string[]; fetchedAt: number } | null = null
let inflight: Promise<readonly string[]> | null = null

function loadServerFeatures(): Promise<readonly string[]> {
  if (cached && Date.now() - cached.fetchedAt < FEATURES_TTL_MS) return Promise.resolve(cached.features)
  if (!inflight) {
    inflight = getServerFeaturesAction()
      .catch(() => NO_FEATURES)
      .then((features) => {
        cached = { features: Object.freeze([...features]), fetchedAt: Date.now() }
        return cached.features
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/**
 * Whether the server advertises an optional feature. False until `/status` has been read (and whenever it cannot be),
 * so UI behind a feature stays hidden on a stock server. One request is shared by every caller for a minute.
 */
export function useServerFeature(feature: ServerFeature): boolean {
  const [features, setFeatures] = useState<readonly string[]>(NO_FEATURES)

  useEffect(() => {
    let active = true
    void loadServerFeatures().then((next) => {
      if (active) setFeatures(next)
    })
    return () => {
      active = false
    }
  }, [])

  return hasServerFeature(features, feature)
}
