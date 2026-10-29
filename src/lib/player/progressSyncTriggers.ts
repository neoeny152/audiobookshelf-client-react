import { PlayerState } from '@/types/api'

/** Delay before syncing a seek made while paused, so a burst of jumps sends one sync */
export const PAUSED_SEEK_SYNC_DELAY_MS = 1000

/**
 * Pausing stops the sync interval, so the position since the last interval sync (up to ~10 s,
 * plus any seek) must be sent right away. Otherwise another device resumes at the wrong place (#5492).
 *
 * `wasActive` is true when the player was PLAYING (possibly followed by LOADING while buffering)
 * since the last pause, so PLAYING -> LOADING -> PAUSED also syncs.
 */
export function shouldSyncOnStateChange(wasActive: boolean, nextState: PlayerState): boolean {
  return wasActive && nextState === PlayerState.PAUSED
}

/**
 * While playing, the sync interval picks up a seek within one interval. While paused nothing
 * syncs, so a seek has to schedule its own sync (#5492).
 */
export function shouldSyncAfterSeek(state: PlayerState): boolean {
  return state !== PlayerState.PLAYING && state !== PlayerState.IDLE && state !== PlayerState.ERROR
}

export interface DebouncedTrigger {
  /** (Re)start the timer; only the last call within the delay fires */
  schedule: () => void
  /** Drop a pending call */
  cancel: () => void
  /** Run a pending call now (no-op if none is pending) */
  flush: () => void
  /** True while a call is scheduled */
  isPending: () => boolean
}

/**
 * Small trailing debounce with explicit cancel/flush, used for the paused-seek sync.
 */
export function createDebouncedTrigger(callback: () => void, delayMs: number = PAUSED_SEEK_SYNC_DELAY_MS): DebouncedTrigger {
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    schedule: () => {
      cancel()
      timer = setTimeout(() => {
        timer = null
        callback()
      }, delayMs)
    },
    cancel,
    flush: () => {
      if (timer === null) return
      cancel()
      callback()
    },
    isPending: () => timer !== null
  }
}

export interface SeekSyncOptions {
  /**
   * false for a seek that only mirrors progress saved elsewhere (another device's
   * user_item_progress_updated). Syncing it back would echo the other device's position through
   * this session and make the server treat that device's next rewind as stale.
   */
  sync?: boolean
}

export interface ProgressSyncControllerDeps {
  getState: () => PlayerState
  /** Current player time, or null when no player is loaded */
  getCurrentTime: () => number | null
  sync: (currentTime: number, options?: { force?: boolean }) => Promise<void> | void
  delayMs?: number
}

export interface ProgressSyncController {
  /** Call on every player stateChange (after the sync interval was started/stopped) */
  onStateChange: (state: PlayerState) => void
  /** Call after a seek was applied to the player */
  onSeek: (options?: SeekSyncOptions) => void
  /** Send a pending paused-seek sync now (before closing the session); resolves when it is sent */
  flushBeforeClose: () => Promise<void>
  /** Drop a pending sync and forget the play state (player destroyed) */
  reset: () => void
}

/**
 * Decides when the web player sends a progress sync outside the playing interval (#5492):
 * on pause after playing, and (debounced) after a user seek while not playing.
 */
export function createProgressSyncController(deps: ProgressSyncControllerDeps): ProgressSyncController {
  let wasActive = false

  const syncCurrent = (options?: { force?: boolean }): Promise<void> | void => {
    const time = deps.getCurrentTime()
    if (time === null) return
    return deps.sync(time, options)
  }

  const trigger = createDebouncedTrigger(() => {
    if (!shouldSyncAfterSeek(deps.getState())) return
    void syncCurrent()
  }, deps.delayMs)

  return {
    onStateChange: (state) => {
      if (state === PlayerState.PLAYING) {
        wasActive = true
        // A pending paused-seek sync is covered by the sync interval from here on
        trigger.cancel()
        return
      }
      if (shouldSyncOnStateChange(wasActive, state)) {
        wasActive = false
        trigger.cancel()
        void syncCurrent({ force: true })
        return
      }
      // Buffering keeps the "played since last pause" flag; anything else ends it
      if (state !== PlayerState.LOADING) wasActive = false
    },
    onSeek: (options) => {
      if (options?.sync === false) {
        // The position now equals what the server already has; a pending local seek is superseded
        trigger.cancel()
        return
      }
      if (shouldSyncAfterSeek(deps.getState())) trigger.schedule()
    },
    flushBeforeClose: async () => {
      if (!trigger.isPending()) return
      trigger.cancel()
      await syncCurrent()
    },
    reset: () => {
      wasActive = false
      trigger.cancel()
    }
  }
}
