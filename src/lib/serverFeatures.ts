/**
 * Optional server endpoints advertised in `GET /status` `serverFeatures` (see the server's utils/serverFeatures.js).
 *
 * - batchEpisodes / libraryDownloadPost: always listed by servers that have them
 * - chapterbotVerify: chapter snap accepts `options.verify = true` (speech check)
 * - chapterbotEpub: `POST /api/items/:id/epub` and `GET`/`DELETE /api/items/:id/epub/:jobId` (EPUB from audio)
 * - readAlong: `GET /api/items/:id/ebook/:fileid/readalong` (sentence timings for an EPUB from audio; 404 when an
 *   EPUB has none). Always listed by servers that have it: serving stored data does not need the sidecar.
 * - chapterbotEpubCurrent: `GET /api/items/:id/epub` returns the item's current or latest job (404 when none), for any
 *   user who can see the item, and the server broadcasts `chapterbot_epub_updated`. Listed together with chapterbotEpub.
 * - mp3SeekIndex: `GET /api/tools/item/:id/seek-index` (MP3s without a Xing/Info/VBRI header) and
 *   `POST /api/tools/item/:id/repair-seek-index` (task action `repair-seek-index`), `audioFile.mp3SeekIndex`.
 * - transcripts: `GET /api/items/:id/transcripts[?episodeId=]` (creator, local and generated transcripts; empty list
 *   when none), `GET /api/items/:id/transcripts/:transcriptId?format=json|vtt|original`, admin `refresh-feed` and
 *   `DELETE .../generated`, socket `transcript_updated`, podcast library settings `downloadPodcastTranscripts` and
 *   `autoTranscribePodcastEpisodes`. Always listed by servers that have it.
 * - transcriptsGenerate: admin `POST /api/items/:id/transcripts/generate` and `DELETE /api/items/:id/transcripts/job`
 *   (socket `transcript_job_updated`). Listed together with chapterbotEpub.
 * - autoPipeline: hands-off processing of new books (`library.settings.autoPipeline`, `/api/libraries/:id/pipeline`,
 *   `/api/items/:id/pipeline[...]`, socket `pipeline_item_updated`). Only listed when the server's env gate is on.
 *
 * The chapterbot features are only listed while the sidecar is reachable, so they can come and go. A stock server
 * sends no `serverFeatures` at all, which means none of them.
 */
export type ServerFeature = 'batchEpisodes' | 'libraryDownloadPost' | 'chapterbotVerify' | 'chapterbotEpub' | 'readAlong' | 'chapterbotEpubCurrent' | 'autoPipeline' | 'mp3SeekIndex' | 'transcripts' | 'transcriptsGenerate'

/** Features that come and go with the server's sidecar health (see serverFeatureStore). */
export const OPTIONAL_SERVER_FEATURES: readonly ServerFeature[] = Object.freeze(['chapterbotVerify', 'chapterbotEpub', 'chapterbotEpubCurrent', 'transcriptsGenerate'])

/** The feature names from a `/status` payload. Anything that is not an array of strings counts as no features. */
export function parseServerFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((feature): feature is string => typeof feature === 'string')
}

export function hasServerFeature(features: readonly string[] | null | undefined, feature: ServerFeature): boolean {
  return !!features && features.includes(feature)
}
