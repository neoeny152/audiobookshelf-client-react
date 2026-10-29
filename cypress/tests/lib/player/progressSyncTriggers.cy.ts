import { createDebouncedTrigger, PAUSED_SEEK_SYNC_DELAY_MS, shouldSyncAfterSeek, shouldSyncOnStateChange } from '@/lib/player/progressSyncTriggers'
import { PlayerState } from '@/types/api'

describe('progressSyncTriggers (#5492)', () => {
  describe('shouldSyncOnStateChange', () => {
    it('syncs when playback pauses', () => {
      expect(shouldSyncOnStateChange(PlayerState.PLAYING, PlayerState.PAUSED)).to.equal(true)
    })

    it('does not sync for other transitions', () => {
      expect(shouldSyncOnStateChange(null, PlayerState.PAUSED)).to.equal(false)
      expect(shouldSyncOnStateChange(PlayerState.PAUSED, PlayerState.PAUSED)).to.equal(false)
      expect(shouldSyncOnStateChange(PlayerState.LOADING, PlayerState.PAUSED)).to.equal(false)
      expect(shouldSyncOnStateChange(PlayerState.PAUSED, PlayerState.PLAYING)).to.equal(false)
      expect(shouldSyncOnStateChange(PlayerState.PLAYING, PlayerState.LOADING)).to.equal(false)
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
})
