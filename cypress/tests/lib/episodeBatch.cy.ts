import type { ActionResult } from '@/lib/actionResult'
import { groupEpisodesByPodcast, runEpisodeBatch, runEpisodeRequests, runEpisodesOneByOne, type EpisodeRef } from '@/lib/batchSelection/episodeBatch'

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
    expect(outcome).to.deep.equal({ total: 5, succeeded: 3, failed: 2, firstError: 'Episode not found' })
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
        if (group[0].libraryItemId === 'pod_b') return { succeeded: 0, failed: group.length, firstError: 'Forbidden' }
        if (group[0].libraryItemId === 'pod_c') throw new Error('network')
        return { succeeded: group.length, failed: 0, firstError: '' }
      },
      (done) => progress.push(done)
    )

    expect(groups).to.deep.equal([['a1', 'a2'], ['b1', 'b2'], ['c1']])
    expect(progress).to.deep.equal([0, 2, 4, 5])
    expect(outcome).to.deep.equal({ total: 5, succeeded: 2, failed: 3, firstError: 'Forbidden' })
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
    expect(outcome).to.deep.equal({ total: 5, succeeded: 4, failed: 1, firstError: 'Episode not found' })
  })

  it('falls back to one request per episode on a stock server', async () => {
    const recorded = recordingRequests()
    const outcome = await runEpisodeRequests(refs, recorded.requests)

    expect(recorded.many).to.deep.equal([])
    expect(recorded.one).to.deep.equal(['a1', 'a2', 'b1', 'b2', 'c1'])
    expect(outcome).to.deep.equal({ total: 5, succeeded: 5, failed: 0, firstError: '' })
  })
})
