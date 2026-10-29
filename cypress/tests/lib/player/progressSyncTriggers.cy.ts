import {
  createDebouncedTrigger,
  createProgressSyncController,
  PAUSED_SEEK_SYNC_DELAY_MS,
  shouldSyncAfterSeek,
  shouldSyncOnStateChange
} from '@/lib/player/progressSyncTriggers'
import { PlayerState } from '@/types/api'

describe('progressSyncTriggers (#5492)', () => {
  describe('shouldSyncOnStateChange', () => {
    it('syncs when playback pauses', () => {
      expect(shouldSyncOnStateChange(true, PlayerState.PAUSED)).to.equal(true)
    })

    it('does not sync for other transitions', () => {
      expect(shouldSyncOnStateChange(false, PlayerState.PAUSED)).to.equal(false)
      expect(shouldSyncOnStateChange(true, PlayerState.PLAYING)).to.equal(false)
      expect(shouldSyncOnStateChange(true, PlayerState.LOADING)).to.equal(false)
    })
  })

  describe('shouldSyncAfterSeek', () => {
    it('syncs seeks made while paused or loaded', () => {
      expect(shouldSyncAfterSeek(PlayerState.PAUSED)).to.equal(true)
      expect(shouldSyncAfterSeek(PlayerState.LOADED)).to.equal(true)
    })

    it('leaves seeks during playback to the sync interval and ignores an idle player', () => {
      expect(shouldSyncAfterSeek(PlayerState.PLAYING)).to.equal(false)
      expect(shouldSyncAfterSeek(PlayerState.IDLE)).to.equal(false)
      expect(shouldSyncAfterSeek(PlayerState.ERROR)).to.equal(false)
    })
  })

  describe('createDebouncedTrigger', () => {
    it('fires once after a burst of seeks', () => {
      const callback = cy.stub()
      const trigger = createDebouncedTrigger(callback)

      cy.clock().then(() => trigger.schedule())
      cy.tick(PAUSED_SEEK_SYNC_DELAY_MS - 1).then(() => {
        expect(callback.callCount).to.equal(0)
        trigger.schedule()
      })
      cy.tick(PAUSED_SEEK_SYNC_DELAY_MS - 1).then(() => {
        expect(callback.callCount).to.equal(0)
      })
      cy.tick(1).then(() => {
        expect(callback.callCount).to.equal(1)
      })
    })

    it('does not fire after cancel', () => {
      const callback = cy.stub()
      const trigger = createDebouncedTrigger(callback, 500)

      cy.clock().then(() => {
        trigger.schedule()
        trigger.cancel()
      })
      cy.tick(1000).then(() => {
        expect(callback.callCount).to.equal(0)
      })
    })

    it('flush runs a pending call immediately and only once', () => {
      const callback = cy.stub()
      const trigger = createDebouncedTrigger(callback, 500)

      cy.clock().then(() => {
        trigger.flush()
        expect(callback.callCount).to.equal(0)

        trigger.schedule()
        trigger.flush()
        expect(callback.callCount).to.equal(1)
      })
      cy.tick(1000).then(() => {
        expect(callback.callCount).to.equal(1)
      })
    })
  })

  describe('createProgressSyncController', () => {
    const setup = (initialState: PlayerState = PlayerState.PAUSED) => {
      const env = { state: initialState, time: 100 as number | null }
      const sync = cy.stub().resolves()
      const controller = createProgressSyncController({
        getState: () => env.state,
        getCurrentTime: () => env.time,
        sync
      })
      return { env, sync, controller }
    }

    it('forces a sync when playback pauses', () => {
      const { env, sync, controller } = setup(PlayerState.PLAYING)
      controller.onStateChange(PlayerState.PLAYING)
      env.state = PlayerState.PAUSED
      env.time = 142
      controller.onStateChange(PlayerState.PAUSED)
      expect(sync.callCount).to.equal(1)
      expect(sync.firstCall.args).to.deep.equal([142, { force: true }])
    })

    it('syncs a pause that follows buffering (PLAYING -> LOADING -> PAUSED)', () => {
      const { sync, controller } = setup()
      controller.onStateChange(PlayerState.PLAYING)
      controller.onStateChange(PlayerState.LOADING)
      controller.onStateChange(PlayerState.PAUSED)
      expect(sync.callCount).to.equal(1)
    })

    it('does not sync a load that lands paused', () => {
      const { sync, controller } = setup()
      controller.onStateChange(PlayerState.LOADING)
      controller.onStateChange(PlayerState.LOADED)
      controller.onStateChange(PlayerState.PAUSED)
      expect(sync.callCount).to.equal(0)
    })

    it('syncs a user seek while paused after the debounce', () => {
      const { env, sync, controller } = setup()
      cy.clock().then(() => {
        env.time = 70
        controller.onSeek()
      })
      cy.tick(PAUSED_SEEK_SYNC_DELAY_MS).then(() => {
        expect(sync.callCount).to.equal(1)
        expect(sync.firstCall.args[0]).to.equal(70)
      })
    })

    it('does not echo a seek that mirrors another device (user_item_progress_updated)', () => {
      const { sync, controller } = setup()
      cy.clock().then(() => controller.onSeek({ sync: false }))
      cy.tick(PAUSED_SEEK_SYNC_DELAY_MS * 5).then(() => {
        expect(sync.callCount).to.equal(0)
      })
    })

    it('a remote seek supersedes a pending local paused seek', () => {
      const { sync, controller } = setup()
      cy.clock().then(() => {
        controller.onSeek()
        controller.onSeek({ sync: false })
      })
      cy.tick(PAUSED_SEEK_SYNC_DELAY_MS * 5).then(() => {
        expect(sync.callCount).to.equal(0)
      })
    })

    it('sends a pending paused seek before the session closes', () => {
      const { env, sync, controller } = setup()
      cy.clock()
        .then(() => {
          env.time = 55
          controller.onSeek()
          return controller.flushBeforeClose()
        })
        .then(() => {
          expect(sync.callCount).to.equal(1)
          expect(sync.firstCall.args[0]).to.equal(55)
        })
      cy.tick(PAUSED_SEEK_SYNC_DELAY_MS * 2).then(() => {
        expect(sync.callCount).to.equal(1)
      })
    })

    it('flushBeforeClose sends nothing without a pending seek', () => {
      const { sync, controller } = setup()
      cy.wrap(null)
        .then(() => controller.flushBeforeClose())
        .then(() => {
          expect(sync.callCount).to.equal(0)
        })
    })
  })
})
