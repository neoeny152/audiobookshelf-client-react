import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { hasServerFeature, OPTIONAL_SERVER_FEATURES, type ServerFeature } from './serverFeatures'

/**
 * Shared, self-refreshing copy of the `/status` `serverFeatures` list.
 *
 * - One request at a time is shared by every caller.
 * - A failed read keeps the last good list (a flaky `/status` never hides a feature that was there).
 * - A list without the optional (chapterbot) features, or a failed read, is re-checked sooner (`retryDelaysMs`) than
 *   a complete one (`ttlMs`): the server may simply not have known its sidecar's health yet.
 * - While a component watches an optional feature, the list is re-read on a timer, so a feature that shows up (or
 *   goes away) while e.g. the chapter editor is open re-renders it without a remount.
 */

/** Resolves with the advertised features, or null when they could not be read. May also reject (same as null). */
export type ServerFeaturesFetcher = () => Promise<readonly string[] | null>

export interface ServerFeatureStoreOptions {
  fetchFeatures: ServerFeaturesFetcher
  /** Re-check a complete list after this long. */
  ttlMs?: number
  /** Re-check after a failed read, or a list without the optional features: one delay per consecutive miss, the last repeats until ttlMs. */
  retryDelaysMs?: readonly number[]
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface ServerFeatureStore {
  /** The current list (stable reference until it changes). Empty until the first good read. */
  getFeatures: () => readonly string[]
  /** Subscribe to changes. `live` subscribers keep the list refreshed on a timer while subscribed. */
  subscribe: (listener: () => void, live?: boolean) => () => void
  /** Read `/status` again now unless a fresh enough read exists (or `force`). */
  refresh: (force?: boolean) => Promise<readonly string[]>
  /** When the next read is due (ms after the last one). */
  currentDelayMs: () => number
}

export const NO_SERVER_FEATURES: readonly string[] = Object.freeze([])
export const SERVER_FEATURES_TTL_MS = 60_000
export const SERVER_FEATURES_RETRY_DELAYS_MS: readonly number[] = Object.freeze([5_000, 15_000, 30_000])

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function createServerFeatureStore({
  fetchFeatures,
  ttlMs = SERVER_FEATURES_TTL_MS,
  retryDelaysMs = SERVER_FEATURES_RETRY_DELAYS_MS,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}: ServerFeatureStoreOptions): ServerFeatureStore {
  let features = NO_SERVER_FEATURES
  /** 0 = never read */
  let fetchedAt = 0
  /** Consecutive reads that failed or came back without the optional features */
  let misses = 0
  let inflight: Promise<readonly string[]> | null = null
  let timer: unknown = null
  const listeners = new Set<() => void>()
  let liveCount = 0

  const currentDelayMs = () => {
    if (misses === 0) return ttlMs
    if (!retryDelaysMs.length) return ttlMs
    return Math.min(ttlMs, retryDelaysMs[Math.min(misses - 1, retryDelaysMs.length - 1)])
  }

  const isFresh = () => fetchedAt > 0 && now() - fetchedAt < currentDelayMs()

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  const schedule = () => {
    cancelTimer()
    if (liveCount <= 0 || inflight) return
    const wait = fetchedAt > 0 ? Math.max(0, fetchedAt + currentDelayMs() - now()) : 0
    timer = setTimer(() => {
      timer = null
      void refresh()
    }, wait)
  }

  const refresh = (force = false): Promise<readonly string[]> => {
    if (!force && isFresh()) return Promise.resolve(features)
    if (!inflight) {
      cancelTimer()
      inflight = Promise.resolve()
        .then(() => fetchFeatures())
        .catch(() => null)
        .then((next) => {
          fetchedAt = now()
          if (next === null || !Array.isArray(next)) {
            // keep the last good list
            misses++
          } else {
            const complete = OPTIONAL_SERVER_FEATURES.some((feature) => next.includes(feature))
            misses = complete ? 0 : misses + 1
            if (!sameList(features, next)) {
              features = Object.freeze([...next])
              notify()
            }
          }
          return features
        })
        .finally(() => {
          inflight = null
          schedule()
        })
    }
    return inflight
  }

  const subscribe = (listener: () => void, live = false) => {
    listeners.add(listener)
    if (live) liveCount++
    void refresh()
    if (live && !inflight) schedule()
    return () => {
      listeners.delete(listener)
      if (live) {
        liveCount--
        if (liveCount <= 0) cancelTimer()
      }
    }
  }

  return { getFeatures: () => features, subscribe, refresh, currentDelayMs }
}

/**
 * Whether `store` advertises `feature`, re-rendering when the list changes. Optional (chapterbot) features are
 * watched live, so they appear without remounting; always-on ones are read once per mount (and on the shared refresh).
 */
export function useServerFeatureFrom(store: ServerFeatureStore, feature: ServerFeature): boolean {
  const live = OPTIONAL_SERVER_FEATURES.includes(feature)
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener, live), [store, live])
  const features = useSyncExternalStore(
    subscribe,
    store.getFeatures,
    () => NO_SERVER_FEATURES
  )
  // Re-read when the tab comes back: the server may have learnt its sidecar's health meanwhile
  useEffect(() => {
    if (!live || typeof document === 'undefined') return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void store.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [store, live])
  return hasServerFeature(features, feature)
}
