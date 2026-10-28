import type { ActionResult, StatusActionResult } from '@/lib/actionResult'
import { episodeSelectionKey } from '@/lib/selectedMediaItem'

export interface EpisodeRef {
  libraryItemId: string
  episodeId: string
}

/** Called after each finished step with how many entries are done so far. */
export type BatchProgressCallback = (done: number, total: number) => void

export interface EpisodeBatchOutcome<T = unknown> {
  total: number
  succeeded: number
  failed: number
  /** The first server message of a failure, '' when there was none. */
  firstError: string
  /** The entries that failed, in batch order (so a caller can keep them selected for a retry). */
  failedEntries: T[]
}

/** What one podcast's run reports back. */
export interface EpisodeGroupOutcome<T = unknown> {
  succeeded: number
  failed: number
  firstError: string
  failedEntries: T[]
}

/** HTTP status the fork server's batch endpoints answer when one of the entries no longer exists. */
const BATCH_ENTRY_NOT_FOUND_STATUS = 404

/** Entries grouped by podcast, podcasts in first-seen order, entries in their original order. */
export function groupEpisodesByPodcast<T extends Pick<EpisodeRef, 'libraryItemId'>>(entries: readonly T[]): T[][] {
  const groups = new Map<string, T[]>()
  for (const entry of entries) {
    const group = groups.get(entry.libraryItemId)
    if (group) group.push(entry)
    else groups.set(entry.libraryItemId, [entry])
  }
  return [...groups.values()]
}

/**
 * Runs a podcast's entries one request at a time and keeps going after a failure. Requests for the
 * same podcast must not overlap: each one loads and saves the whole podcast on the server.
 */
export async function runEpisodesOneByOne<T>(
  group: readonly T[],
  runOne: (entry: T) => Promise<ActionResult<unknown>>,
  onStep?: () => void
): Promise<EpisodeGroupOutcome<T>> {
  const outcome: EpisodeGroupOutcome<T> = { succeeded: 0, failed: 0, firstError: '', failedEntries: [] }
  for (const entry of group) {
    let result: ActionResult<unknown>
    try {
      result = await runOne(entry)
    } catch (error) {
      console.error('Episode batch step failed', error)
      result = { ok: false, error: '' }
    }
    if (result.ok) {
      outcome.succeeded++
    } else {
      outcome.failed++
      outcome.failedEntries.push(entry)
      if (!outcome.firstError && result.error) outcome.firstError = result.error
    }
    onStep?.()
  }
  return outcome
}

/**
 * Runs a podcast's entries as one request (the fork server's batch episode endpoints). The server
 * validates the whole request first, so it either applies to every entry or to none.
 *
 * When it rejects the request because an entry no longer exists (404: removed in another tab, by a
 * socket update or an auto-cleanup), the group is retried with `fallbackOne`, one request at a time,
 * so the remaining entries still go through and only the stale one fails. Other failures (403, 5xx,
 * network) would fail every entry the same way and are not retried.
 */
export async function runEpisodesInOneRequest<T>(
  group: readonly T[],
  request: (group: readonly T[]) => Promise<ActionResult<unknown> | StatusActionResult<unknown>>,
  step: (count: number) => void,
  fallbackOne?: (entry: T) => Promise<ActionResult<unknown>>
): Promise<EpisodeGroupOutcome<T>> {
  const result = await request(group)
  if (!result.ok && fallbackOne && group.length > 1 && 'status' in result && result.status === BATCH_ENTRY_NOT_FOUND_STATUS) {
    return runEpisodesOneByOne(group, fallbackOne, () => step(1))
  }
  step(group.length)
  return result.ok
    ? { succeeded: group.length, failed: 0, firstError: '', failedEntries: [] }
    : { succeeded: 0, failed: group.length, firstError: result.error, failedEntries: [...group] }
}

/**
 * Runs a batch over episodes one podcast at a time (podcasts never run concurrently), collecting
 * failures instead of stopping at the first one. `runGroup` handles one podcast's entries and calls
 * `step(n)` as entries finish, so progress can be reported per episode or per podcast.
 */
export async function runEpisodeBatch<T extends Pick<EpisodeRef, 'libraryItemId'>>(
  entries: readonly T[],
  runGroup: (group: T[], step: (count: number) => void) => Promise<EpisodeGroupOutcome<T>>,
  onProgress?: BatchProgressCallback
): Promise<EpisodeBatchOutcome<T>> {
  const total = entries.length
  const outcome: EpisodeBatchOutcome<T> = { total, succeeded: 0, failed: 0, firstError: '', failedEntries: [] }
  let done = 0
  onProgress?.(0, total)

  for (const group of groupEpisodesByPodcast(entries)) {
    const doneBefore = done
    const step = (count: number) => {
      done = Math.min(doneBefore + group.length, done + count)
      onProgress?.(done, total)
    }

    let groupOutcome: EpisodeGroupOutcome<T>
    try {
      groupOutcome = await runGroup(group, step)
    } catch (error) {
      console.error('Episode batch group failed', error)
      groupOutcome = { succeeded: 0, failed: group.length, firstError: '', failedEntries: group }
    }

    outcome.succeeded += groupOutcome.succeeded
    outcome.failed += groupOutcome.failed
    outcome.failedEntries.push(...groupOutcome.failedEntries)
    if (!outcome.firstError && groupOutcome.firstError) outcome.firstError = groupOutcome.firstError

    if (done !== doneBefore + group.length) {
      done = doneBefore + group.length
      onProgress?.(done, total)
    }
  }

  return outcome
}

export interface EpisodeBatchRequests<T> {
  /** One entry per request: works on every server. */
  one: (entry: T) => Promise<ActionResult<unknown>>
  /**
   * All of one podcast's entries in a request: needs the `batchEpisodes` server feature. Return the
   * HTTP status (StatusActionResult) so a 404 for a stale entry can fall back to `one`.
   */
  many: (entries: readonly T[]) => Promise<ActionResult<unknown> | StatusActionResult<unknown>>
}

export interface EpisodeBatchRunOptions {
  /** The server advertises `batchEpisodes`: send one request per podcast instead of one per episode. */
  useBatchEndpoint?: boolean
  onProgress?: BatchProgressCallback
}

/**
 * Runs an episode batch one podcast at a time with the request style the server supports: one
 * batch request per podcast when it advertises `batchEpisodes`, otherwise one request per episode
 * (stock servers). A failure does not stop the rest; the outcome counts what succeeded and failed.
 */
export function runEpisodeRequests<T extends Pick<EpisodeRef, 'libraryItemId'>>(
  entries: readonly T[],
  requests: EpisodeBatchRequests<T>,
  { useBatchEndpoint = false, onProgress }: EpisodeBatchRunOptions = {}
): Promise<EpisodeBatchOutcome<T>> {
  return runEpisodeBatch(
    entries,
    (group, step) => (useBatchEndpoint ? runEpisodesInOneRequest(group, requests.many, step, requests.one) : runEpisodesOneByOne(group, requests.one, () => step(1))),
    onProgress
  )
}

/**
 * What the selection should become after an episode removal batch: cleared when everything went through,
 * left alone when nothing did (so the user can retry), and narrowed to the failed episodes after a
 * partial failure (the removed ones are gone, the rest can be retried as they are).
 */
export function selectionAfterEpisodeBatch(outcome: EpisodeBatchOutcome<EpisodeRef>): { type: 'clear' } | { type: 'keep' } | { type: 'keepOnly'; keys: Set<string> } {
  if (outcome.failed === 0) return { type: 'clear' }
  if (outcome.succeeded === 0) return { type: 'keep' }
  return { type: 'keepOnly', keys: new Set(outcome.failedEntries.map((ref) => episodeSelectionKey(ref.episodeId))) }
}
