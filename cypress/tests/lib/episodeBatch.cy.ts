import type { ActionResult } from '@/lib/actionResult'
import { groupEpisodesByPodcast, runEpisodeBatch, runEpisodesOneByOne, type EpisodeRef } from '@/lib/batchSelection/episodeBatch'

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
