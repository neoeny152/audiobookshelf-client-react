/**
 * Optional server endpoints advertised in `GET /status` `serverFeatures` (see the server's utils/serverFeatures.js).
 *
 * - batchEpisodes / libraryDownloadPost: always listed by servers that have them
 * - chapterbotVerify: chapter snap accepts `options.verify = true` (speech check)
 * - chapterbotEpub: `POST /api/items/:id/epub` and `GET`/`DELETE /api/items/:id/epub/:jobId` (EPUB from audio)
 *
 * The chapterbot features are only listed while the sidecar is reachable, so they can come and go. A stock server
 * sends no `serverFeatures` at all, which means none of them.
 */
export type ServerFeature = 'batchEpisodes' | 'libraryDownloadPost' | 'chapterbotVerify' | 'chapterbotEpub'

/** Features that come and go with the server's sidecar health (see serverFeatureStore). */
export const OPTIONAL_SERVER_FEATURES: readonly ServerFeature[] = Object.freeze(['chapterbotVerify', 'chapterbotEpub'])

/** The feature names from a `/status` payload. Anything that is not an array of strings counts as no features. */
export function parseServerFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((feature): feature is string => typeof feature === 'string')
}

export function hasServerFeature(features: readonly string[] | null | undefined, feature: ServerFeature): boolean {
  return !!features && features.includes(feature)
}
