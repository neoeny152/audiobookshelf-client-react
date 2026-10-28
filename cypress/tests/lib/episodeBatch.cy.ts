import type { ActionResult, StatusActionResult } from '@/lib/actionResult'
import {
  groupEpisodesByPodcast,
  runEpisodeBatch,
  runEpisodeRequests,
  runEpisodesOneByOne,
  selectionAfterEpisodeBatch,
  type EpisodeRef
} from '@/lib/batchSelection/episodeBatch'

const refs: EpisodeRef[] = [
  { libraryItemId: 'pod_a', episodeId: 'a1' },
  { libraryItemId: 'pod_b', episodeId: 'b1' },
  { libraryItemId: 'pod_a', episodeId: 'a2' },
  { libraryItemId: 'pod_c', episodeId: 'c1' },
  { libraryItemId: 'pod_b', episodeId: 'b2' }
]

const delay = () => new Promise((resolve) => setTimeout(resolve, 1))

describe('groupEpisodesByPodcast', () => {
  it('groups by podcast in first-seen order and keeps entry order', () => {
    expect(groupEpisodesByPodcast(refs).map((group) => group.map((ref) => ref.episodeId))).to.deep.equal([['a1', 'a2'], ['b1', 'b2'], ['c1']])
  })
})

describe('runEpisodeBatch with one request per episode', () => {
  it('runs podcasts one at a time and one request at a time, and keeps going after failures', async () => {
    const calls: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const progress: [number, number][] = []

    const runOne = async (ref: EpisodeRef): Promise<ActionResult> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      calls.push(ref.episodeId)
      await delay()
      inFlight--
      if (ref.episodeId === 'a2') return { ok: false, error: 'Episode not found' }
      if (ref.episodeId === 'c1') throw new Error('network')
      return { ok: true, data: undefined }
    }

    const outcome = await runEpisodeBatch(
      refs,
      (group, step) => runEpisodesOneByOne(group, runOne, () => step(1)),
      (done, total) => progress.push([done, total])
    )

    expect(calls).to.deep.equal(['a1', 'a2', 'b1', 'b2', 'c1'])
    expect(maxInFlight).to.equal(1)
    expect(outcome).to.deep.equal({ total: 5, succeeded: 3, failed: 2, firstError: 'Episode not found', failedEntries: [refs[2], refs[3]] })
    expect(progress).to.deep.equal([
      [0, 5],
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5]
    ])
  })
})

describe('runEpisodeBatch with one request per podcast', () => {
  it('reports progress per podcast and counts a failed podcast as all of its episodes', async () => {
    const progress: number[] = []
    const groups: string[][] = []

    const outcome = await runEpisodeBatch(
      refs,
      async (group) => {
        groups.push(group.map((ref) => ref.episodeId))
        await delay()
        if (group[0].libraryItemId === 'pod_b') return { succeeded: 0, failed: group.length, firstError: 'Forbidden', failedEntries: group }
        if (group[0].libraryItemId === 'pod_c') throw new Error('network')
        return { succeeded: group.length, failed: 0, firstError: '', failedEntries: [] }
      },
      (done) => progress.push(done)
    )

    expect(groups).to.deep.equal([['a1', 'a2'], ['b1', 'b2'], ['c1']])
    expect(progress).to.deep.equal([0, 2, 4, 5])
    expect(outcome).to.deep.equal({ total: 5, succeeded: 2, failed: 3, firstError: 'Forbidden', failedEntries: [refs[1], refs[4], refs[3]] })
  })
})

describe('runEpisodeRequests (batchEpisodes server feature)', () => {
  function recordingRequests() {
    const one: string[] = []
    const many: string[][] = []
    return {
      one,
      many,
      requests: {
        one: async (ref: EpisodeRef): Promise<ActionResult> => {
          one.push(ref.episodeId)
          return { ok: true, data: undefined }
        },
        many: async (entries: readonly EpisodeRef[]): Promise<ActionResult> => {
          many.push(entries.map((ref) => ref.episodeId))
          return entries.some((ref) => ref.libraryItemId === 'pod_c') ? { ok: false, error: 'Episode not found' } : { ok: true, data: undefined }
        }
      }
    }
  }

  it('sends one batch request per podcast when the server advertises batchEpisodes', async () => {
    const recorded = recordingRequests()
    const outcome = await runEpisodeRequests(refs, recorded.requests, { useBatchEndpoint: true })

    expect(recorded.one).to.deep.equal([])
    expect(recorded.many).to.deep.equal([['a1', 'a2'], ['b1', 'b2'], ['c1']])
    expect(outcome).to.deep.equal({ total: 5, succeeded: 4, failed: 1, firstError: 'Episode not found', failedEntries: [refs[3]] })
  })

  it('falls back to one request per episode on a stock server', async () => {
    const recorded = recordingRequests()
    const outcome = await runEpisodeRequests(refs, recorded.requests)

    expect(recorded.many).to.deep.equal([])
    expect(recorded.one).to.deep.equal(['a1', 'a2', 'b1', 'b2', 'c1'])
    expect(outcome).to.deep.equal({ total: 5, succeeded: 5, failed: 0, firstError: '', failedEntries: [] })
  })
})

describe('runEpisodeRequests when a batch request fails', () => {
  /** pod_a's batch request fails with `status`; one-by-one, only a2 (the stale entry) fails. */
  function failingRequests(status: number) {
    const one: string[] = []
    const many: string[][] = []
    return {
      one,
      many,
      requests: {
        one: async (ref: EpisodeRef): Promise<ActionResult> => {
          one.push(ref.episodeId)
          return ref.episodeId === 'a2' ? { ok: false, error: 'Episode not found' } : { ok: true, data: undefined }
        },
        many: async (entries: readonly EpisodeRef[]): Promise<StatusActionResult<unknown>> => {
          many.push(entries.map((ref) => ref.episodeId))
          return entries[0].libraryItemId === 'pod_a' ? { ok: false, status, error: status === 404 ? 'Episode not found' : 'Forbidden' } : { ok: true, data: undefined }
        }
      }
    }
  }

  it('retries a podcast one episode at a time when an entry no longer exists (404)', async () => {
    const recorded = failingRequests(404)
    const progress: number[] = []
    const outcome = await runEpisodeRequests(refs, recorded.requests, { useBatchEndpoint: true, onProgress: (done) => progress.push(done) })

    expect(recorded.many).to.deep.equal([['a1', 'a2'], ['b1', 'b2'], ['c1']])
    expect(recorded.one).to.deep.equal(['a1', 'a2'])
    expect(outcome).to.deep.equal({ total: 5, succeeded: 4, failed: 1, firstError: 'Episode not found', failedEntries: [refs[2]] })
    expect(progress).to.deep.equal([0, 1, 2, 4, 5])
  })

  it('does not retry other failures, which would fail every entry again', async () => {
    const recorded = failingRequests(403)
    const outcome = await runEpisodeRequests(refs, recorded.requests, { useBatchEndpoint: true })

    expect(recorded.one).to.deep.equal([])
    expect(outcome).to.deep.equal({ total: 5, succeeded: 3, failed: 2, firstError: 'Forbidden', failedEntries: [refs[0], refs[2]] })
  })
})

describe('selectionAfterEpisodeBatch', () => {
  const base = { total: 3, firstError: '' }

  it('clears the selection when every episode went through', () => {
    expect(selectionAfterEpisodeBatch({ ...base, succeeded: 3, failed: 0, failedEntries: [] })).to.deep.equal({ type: 'clear' })
  })

  it('keeps the selection when nothing went through', () => {
    expect(selectionAfterEpisodeBatch({ ...base, succeeded: 0, failed: 3, failedEntries: refs.slice(0, 3) })).to.deep.equal({ type: 'keep' })
  })

  it('keeps only the failed episodes after a partial failure', () => {
    const result = selectionAfterEpisodeBatch({ ...base, succeeded: 2, failed: 1, failedEntries: [refs[2]] })
    expect(result.type).to.equal('keepOnly')
    expect(result.type === 'keepOnly' && [...result.keys]).to.deep.equal(['ep:a2'])
  })
})
