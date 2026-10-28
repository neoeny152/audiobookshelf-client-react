import type { ActionResult } from '@/lib/actionResult'

export interface EpisodeRef {
  libraryItemId: string
  episodeId: string
}

/** Called after each finished step with how many entries are done so far. */
export type BatchProgressCallback = (done: number, total: number) => void

export interface EpisodeBatchOutcome {
  total: number
  succeeded: number
  failed: number
  /** The first server message of a failure, '' when there was none. */
  firstError: string
}

/** What one podcast's run reports back. */
export interface EpisodeGroupOutcome {
  succeeded: number
  failed: number
  firstError: string
}

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
): Promise<EpisodeGroupOutcome> {
  const outcome: EpisodeGroupOutcome = { succeeded: 0, failed: 0, firstError: '' }
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
      if (!outcome.firstError && result.error) outcome.firstError = result.error
    }
    onStep?.()
  }
  return outcome
}

/**
 * Runs a podcast's entries as one request (the fork server's batch episode endpoints). The server
 * validates the whole request first, so it either applies to every entry or to none.
 */
export async function runEpisodesInOneRequest<T>(
  group: readonly T[],
  request: (group: readonly T[]) => Promise<ActionResult<unknown>>,
  step: (count: number) => void
): Promise<EpisodeGroupOutcome> {
  const result = await request(group)
  step(group.length)
  return result.ok ? { succeeded: group.length, failed: 0, firstError: '' } : { succeeded: 0, failed: group.length, firstError: result.error }
}

/**
 * Runs a batch over episodes one podcast at a time (podcasts never run concurrently), collecting
 * failures instead of stopping at the first one. `runGroup` handles one podcast's entries and calls
 * `step(n)` as entries finish, so progress can be reported per episode or per podcast.
 */
export async function runEpisodeBatch<T extends Pick<EpisodeRef, 'libraryItemId'>>(
  entries: readonly T[],
  runGroup: (group: T[], step: (count: number) => void) => Promise<EpisodeGroupOutcome>,
  onProgress?: BatchProgressCallback
): Promise<EpisodeBatchOutcome> {
  const total = entries.length
  const outcome: EpisodeBatchOutcome = { total, succeeded: 0, failed: 0, firstError: '' }
  let done = 0
  onProgress?.(0, total)

  for (const group of groupEpisodesByPodcast(entries)) {
    const doneBefore = done
    const step = (count: number) => {
      done = Math.min(doneBefore + group.length, done + count)
      onProgress?.(done, total)
    }

    let groupOutcome: EpisodeGroupOutcome
    try {
      groupOutcome = await runGroup(group, step)
    } catch (error) {
      console.error('Episode batch group failed', error)
      groupOutcome = { succeeded: 0, failed: group.length, firstError: '' }
    }

    outcome.succeeded += groupOutcome.succeeded
    outcome.failed += groupOutcome.failed
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
  /** All of one podcast's entries in a request: needs the `batchEpisodes` server feature. */
  many: (entries: readonly T[]) => Promise<ActionResult<unknown>>
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
): Promise<EpisodeBatchOutcome> {
  return runEpisodeBatch(
    entries,
    (group, step) => (useBatchEndpoint ? runEpisodesInOneRequest(group, requests.many, step) : runEpisodesOneByOne(group, requests.one, () => step(1))),
    onProgress
  )
}
