import { createServerFeatureStore, useServerFeatureFrom, type ServerFeatureStore, type ServerFeaturesFetcher } from '@/lib/serverFeatureStore'
import type { ServerFeature } from '@/lib/serverFeatures'

const FULL = ['batchEpisodes', 'libraryDownloadPost', 'chapterbotVerify', 'chapterbotEpub']
const BASE = ['batchEpisodes', 'libraryDownloadPost']

/** Manual clock and timers, so the refresh schedule can be stepped through without waiting. */
function fakeClock() {
  let time = 1_000_000
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => time,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++
      timers.set(id, { at: time + ms, fn })
      return id
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number)
    },
    pending: () => [...timers.values()].map((t) => t.at - time),
    /** Move time forward, firing due timers in order. */
    advance(ms: number) {
      const end = time + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        time = due[1].at
        due[1].fn()
      }
      time = end
    }
  }
}

/** A fetcher answering from a queue of results ('fail' rejects, null = action reported failure). */
function queuedFetcher(results: (readonly string[] | null | 'fail')[]) {
  const calls = { count: 0 }
  const fetchFeatures: ServerFeaturesFetcher = () => {
    calls.count++
    const next = results.length > 1 ? results.shift()! : results[0]
    return next === 'fail' ? Promise.reject(new Error('network')) : Promise.resolve(next)
  }
  return { fetchFeatures, calls }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createServerFeatureStore', () => {
  it('starts empty and shares one request between callers', async () => {
    const clock = fakeClock()
    const { fetchFeatures, calls } = queuedFetcher([FULL])
    const store = createServerFeatureStore({ fetchFeatures, ...clock })
    expect(store.getFeatures()).to.deep.equal([])
    const [a, b] = await Promise.all([store.refresh(), store.refresh()])
    expect(a).to.deep.equal(FULL)
    expect(b).to.equal(a)
    expect(calls.count).to.equal(1)
    // fresh: no second request within the TTL
    await store.refresh()
    expect(calls.count).to.equal(1)
  })

  it('keeps the last good list when a read fails (rejected or reported as null)', async () => {
    const clock = fakeClock()
    const { fetchFeatures } = queuedFetcher([FULL, 'fail', null])
    const store = createServerFeatureStore({ fetchFeatures, ...clock })
    await store.refresh()
    expect(await store.refresh(true)).to.deep.equal(FULL)
    expect(await store.refresh(true)).to.deep.equal(FULL)
    expect(store.getFeatures()).to.deep.equal(FULL)
  })

  it('re-checks sooner after a failed read or a list without the optional features, then backs off to the TTL', async () => {
    const clock = fakeClock()
    const { fetchFeatures, calls } = queuedFetcher(['fail', BASE, BASE, BASE, FULL])
    const store = createServerFeatureStore({ fetchFeatures, ttlMs: 60_000, retryDelaysMs: [5_000, 15_000, 30_000], ...clock })
    await store.refresh()
    expect(store.currentDelayMs()).to.equal(5_000)
    clock.advance(4_999)
    await store.refresh()
    expect(calls.count).to.equal(1)
    clock.advance(1)
    await store.refresh()
    expect(calls.count).to.equal(2)
    expect(store.getFeatures()).to.deep.equal(BASE)
    expect(store.currentDelayMs()).to.equal(15_000)
    clock.advance(15_000)
    await store.refresh()
    expect(store.currentDelayMs()).to.equal(30_000)
    clock.advance(30_000)
    await store.refresh()
    expect(store.currentDelayMs()).to.equal(30_000)
    clock.advance(30_000)
    await store.refresh()
    expect(store.getFeatures()).to.deep.equal(FULL)
    expect(store.currentDelayMs()).to.equal(60_000)
  })

  it('refreshes on a timer only while a live subscriber is attached, and notifies on change', async () => {
    const clock = fakeClock()
    const { fetchFeatures, calls } = queuedFetcher([BASE, FULL])
    const store = createServerFeatureStore({ fetchFeatures, retryDelaysMs: [5_000], ...clock })
    const seen: (readonly string[])[] = []
    const unsubscribe = store.subscribe(() => seen.push(store.getFeatures()), true)
    await flush()
    expect(calls.count).to.equal(1)
    expect(seen).to.deep.equal([BASE])
    expect(clock.pending()).to.deep.equal([5_000])

    clock.advance(5_000)
    await flush()
    expect(calls.count).to.equal(2)
    expect(seen).to.deep.equal([BASE, FULL])
    expect(clock.pending()).to.deep.equal([60_000])

    unsubscribe()
    expect(clock.pending()).to.deep.equal([])
  })

  it('does not poll for subscribers that only watch always-on features', async () => {
    const clock = fakeClock()
    const { fetchFeatures, calls } = queuedFetcher([BASE])
    const store = createServerFeatureStore({ fetchFeatures, ...clock })
    store.subscribe(() => {}, false)
    await flush()
    expect(calls.count).to.equal(1)
    expect(clock.pending()).to.deep.equal([])
  })
})

function FeatureProbe({ store, feature }: { store: ServerFeatureStore; feature: ServerFeature }) {
  const available = useServerFeatureFrom(store, feature)
  return <span data-testid="probe">{available ? 'yes' : 'no'}</span>
}

describe('useServerFeatureFrom', () => {
  it('re-renders a component mounted before the features loaded', () => {
    let resolve: (value: readonly string[] | null) => void = () => {}
    const store = createServerFeatureStore({ fetchFeatures: () => new Promise((r) => (resolve = r)) })
    cy.mount(<FeatureProbe store={store} feature="chapterbotVerify" />)
    cy.get('[data-testid="probe"]').should('have.text', 'no')
    cy.then(() => resolve(FULL))
    cy.get('[data-testid="probe"]').should('have.text', 'yes')
  })

  it('shows a feature that appears while mounted (server learnt its sidecar health late)', () => {
    const { fetchFeatures } = queuedFetcher([BASE, FULL])
    const store = createServerFeatureStore({ fetchFeatures, retryDelaysMs: [50] })
    cy.mount(<FeatureProbe store={store} feature="chapterbotVerify" />)
    cy.get('[data-testid="probe"]').should('have.text', 'yes')
  })

  it('keeps showing a feature when a later read fails', () => {
    const { fetchFeatures, calls } = queuedFetcher([FULL, 'fail'])
    const store = createServerFeatureStore({ fetchFeatures, ttlMs: 50, retryDelaysMs: [50] })
    cy.mount(<FeatureProbe store={store} feature="chapterbotVerify" />)
    cy.get('[data-testid="probe"]').should('have.text', 'yes')
    cy.wrap(calls).its('count').should('be.gte', 3)
    cy.get('[data-testid="probe"]').should('have.text', 'yes')
  })
})
