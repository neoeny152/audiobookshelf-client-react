'use server'

import * as api from '@/lib/api'
import { parseServerFeatures } from '@/lib/serverFeatures'

/**
 * Server Action: the optional features the server advertises in `GET /status`.
 * Never throws. A stock server without `serverFeatures` reports none (`[]`); a failed request reports `null`, so the
 * caller can keep the list it already had instead of hiding every feature until the next check.
 */
export async function getServerFeaturesAction(): Promise<string[] | null> {
  try {
    const status = await api.getServerStatus()
    return parseServerFeatures(status?.serverFeatures)
  } catch (error) {
    console.error('Failed to load server features', error)
    return null
  }
}
