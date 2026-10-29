'use client'

import { getServerFeaturesAction } from '@/app/actions/serverFeatureActions'
import { createServerFeatureStore, useServerFeatureFrom } from '@/lib/serverFeatureStore'
import { type ServerFeature } from '@/lib/serverFeatures'

/** One store for the whole app: every caller shares the same `/status` read (see serverFeatureStore). */
const serverFeatureStore = createServerFeatureStore({ fetchFeatures: () => getServerFeaturesAction() })

/**
 * Whether the server advertises a feature. False until `/status` has been read, so UI behind a feature stays hidden
 * on a stock server. A failed read keeps the last good list; the optional (chapterbot) features are re-checked while
 * shown, sooner while missing, so a feature that appears later shows up without reopening the page or modal.
 */
export function useServerFeature(feature: ServerFeature): boolean {
  return useServerFeatureFrom(serverFeatureStore, feature)
}
