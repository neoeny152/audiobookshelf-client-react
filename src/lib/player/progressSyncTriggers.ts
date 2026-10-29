import { PlayerState } from '@/types/api'

/** Delay before syncing a seek made while paused, so a burst of jumps sends one sync */
export const PAUSED_SEEK_SYNC_DELAY_MS = 1000

/**
 * Pausing stops the sync interval, so the position since the last interval sync (up to ~10 s,
 * plus any seek) must be sent right away. Otherwise another device resumes at the wrong place (#5492).
 */
export function shouldSyncOnStateChange(previousState: PlayerState | null, nextState: PlayerState): boolean {
  return previousState === PlayerState.PLAYING && nextState === PlayerState.PAUSED
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
    }
  }
}
