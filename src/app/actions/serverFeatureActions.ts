'use server'

import * as api from '@/lib/api'
import { parseServerFeatures } from '@/lib/serverFeatures'

/**
 * Server Action: the optional features the server advertises in `GET /status`.
 * Never throws: an unreachable server, or a stock server without `serverFeatures`, reports none.
 */
export async function getServerFeaturesAction(): Promise<string[]> {
  try {
    const status = await api.getServerStatus()
    return parseServerFeatures(status?.serverFeatures)
  } catch (error) {
    console.error('Failed to load server features', error)
    return []
  }
}
