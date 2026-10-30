import GuidedFixHint, { type GuidedFixActions, type GuidedFixHintProps } from '@/components/widgets/guided-fix/GuidedFixHint'
import { GuidedFixContext, type GuidedFix } from '@/contexts/GuidedFixContext'
import { getGuidancePreference } from '@/lib/itemHealth'
import type { ItemHealth, ItemHealthIssue, PipelineItemState } from '@/types/api'
import { useState } from 'react'
import { pipelineState } from '../pipeline/pipelineFixtures'

function health(issues: ItemHealthIssue[], autoRepair = false): ItemHealth {
  return {
    libraryItemId: 'li_1',
    duration: { stored: 59580.2, drift: 90.3, unmeasured: 0 },
    seekIndex: { needsRepairCount: issues.includes('seek-index') ? 4 : 0, maxDrift: 41.2, processing: false },
    match: { asin: null, confidence: null, reason: null },
    chapters: { count: 4, kind: 'scanner', end: 59580.2, audible: null },
    issues,
    next: issues.includes('seek-index') ? 'repair' : 'chapters',
    autoFix: { available: true, autoRepair, minConfidence: 90 }
  }
}

const ALL_ISSUES: ItemHealthIssue[] = ['seek-index', 'unmatched', 'chapters-from-files', 'chapters-unverified']

/** Hosts the hint like the item page (which keeps the dismissal); the button stands in for a `pipeline_item_updated` event */
function Harness({ next, ...props }: GuidedFixHintProps & { next?: PipelineItemState }) {
  const [state, setState] = useState(props.pipelineState)
  const [dismissed, setDismissed] = useState(props.dismissed)
  return (
    <>
      <GuidedFixHint
        {...props}
        pipelineState={state}
        dismissed={dismissed}
        onDismiss={() => {
          setDismissed(true)
          props.onDismiss()
        }}
      />
      {next && (
        <button type="button" cy-id="push-state" onClick={() => setState(next)}>
          push
        </button>
      )}
    </>
  )
}

function mountHint({
  props = {},
  actions = {},
  guide = null,
  next
}: { props?: Partial<GuidedFixHintProps>; actions?: Partial<GuidedFixActions>; guide?: GuidedFix | null; next?: PipelineItemState } = {}) {
  const current = props.health ?? health(ALL_ISSUES)
  const fullActions: GuidedFixActions = {
    getHealth: actions.getHealth ?? cy.stub().as('getHealth').resolves({ ok: true, data: current }),
    run:
      actions.run ??
      cy
        .stub()
        .as('run')
        .resolves({ ok: true, data: pipelineState({ status: 'queued', trigger: 'fix', updatedAt: 10 }) }),
    enableAutoRepair: actions.enableAutoRepair ?? cy.stub().as('enableAutoRepair').resolves({ ok: true, data: {} }),
    enableAutomation: actions.enableAutomation ?? cy.stub().as('enableAutomation').resolves({ ok: true, data: {} }),
    startEpub: actions.startEpub ?? cy.stub().as('startEpub').resolves({ ok: true, data: {} })
  }
  cy.mount(
    <GuidedFixContext.Provider value={guide}>
      <Harness
        next={next}
        libraryItemId="li_1"
        health={current}
        pipelineState={null}
        repairProgress={null}
        reviewHref="/library/lib_1/item/li_1?edit=chapters&proposal=pipeline"
        actions={fullActions}
        dismissed={false}
        onDismiss={cy.stub().as('onDismiss')}
        onStartGuide={cy.stub().as('onStartGuide')}
        onRepairFiles={cy.stub().as('onRepairFiles').resolves(true)}
        askNextTime={false}
        onNextTimeAnswered={cy.stub().as('onNextTimeAnswered')}
        canAutomate
        epubOffer="create"
        canAutomateEpub
        {...props}
      />
    </GuidedFixContext.Provider>
  )
}

function guideAt(stepId: GuidedFix['stepId'], stepIndex: number, total: number): GuidedFix {
  return { stepId, stepIndex, total, paused: false, advance: cy.stub().as('advance'), resume: cy.stub(), stop: cy.stub() }
}

describe('<GuidedFixHint />', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('says to start with Edit, in one line, with every problem in its tooltip', () => {
    mountHint()
    cy.get('[cy-id="guided-fix-hint"]').should('contain.text', 'This book needs processing: click Edit to start.').and('contain.text', 'Fix it for me')
    cy.contains('button', 'Guide me').should('not.exist')
    cy.get('[cy-id="guided-fix-start"] button[aria-label="Needs work"]').focus()
    cy.get('[cy-id="guided-fix-reasons"] li').then((reasons) => {
      expect([...reasons].map((reason) => reason.textContent)).to.deep.equal([
        'The MP3 files report the wrong length (off by 1 min 30 s).',
        "It isn't matched to Audible yet.",
        'The chapters come from the files, not from Audible.'
      ])
    })
  })

  it('stays away when the chapters are only unverified, and once dismissed', () => {
    mountHint({ props: { health: health(['chapters-unverified']) } })
    cy.get('[cy-id="guided-fix-hint"]').should('not.exist')
    mountHint()
    cy.get('button[aria-label="Dismiss"]').click()
    cy.get('@onDismiss').should('have.been.calledOnce')
    cy.get('[cy-id="guided-fix-hint"]').should('not.exist')
  })

  it('asks before rewriting MP3s, and can turn the setting on for next time', () => {
    mountHint()
    cy.contains('button', 'Fix it for me').click()
    cy.get('@getHealth').should('have.been.calledWith', 'li_1', true)
    cy.get('[cy-id="repair-consent"]').should('contain.text', 'Repair the audio files first?').and('contain.text', 'Rewrite 4 MP3 files')
    cy.get('[role="dialog"]').should('contain.text', 'Do this automatically from now on')
    cy.get('[role="dialog"]').contains('button', 'Cancel').click()
    cy.get('@run').should('not.have.been.called')

    cy.contains('button', 'Fix it for me').click()
    cy.get('[role="dialog"] input[type="checkbox"]').click()
    cy.get('[role="dialog"]').contains('button', 'Repair and fix').click()
    cy.get('@enableAutoRepair').should('have.been.calledOnce')
    cy.get('@run').should('have.been.calledOnceWith', 'li_1', { fix: true, repairSeekIndex: true })
    cy.get('[cy-id="guided-fix-progress"]').should('contain.text', 'Fixing this book: Queued')
  })

  it('does not ask when the library repairs on its own', () => {
    mountHint({ props: { health: health(ALL_ISSUES, true) } })
    cy.contains('button', 'Fix it for me').click()
    cy.get('@run').should('have.been.calledOnceWith', 'li_1', { fix: true, repairSeekIndex: true })
    cy.get('[cy-id="repair-consent"]').should('not.exist')
    cy.get('@enableAutoRepair').should('not.have.been.called')
  })

  it('follows the run and sums up where it stopped', () => {
    const stopped = pipelineState({
      status: 'needs-review',
      trigger: 'fix',
      updatedAt: 20,
      match: { result: 'needs-review', reason: 'low-confidence', confidence: 86, asin: null, candidates: [] }
    })
    mountHint({
      props: { health: health(['unmatched', 'chapters-from-files']), pipelineState: pipelineState({ status: 'done', updatedAt: 5 }) },
      next: stopped
    })
    cy.contains('button', 'Fix it for me').click()
    cy.get('@run').should('have.been.calledWith', 'li_1', { fix: true, repairSeekIndex: false })
    // The state from before the run is not its result
    cy.get('[cy-id="guided-fix-progress"]').should('contain.text', 'Queued')
    cy.get('[cy-id="push-state"]').click()
    cy.get('[cy-id="guided-fix-result"]').should('have.text', 'Not sure which book this is (best match 86 %). Pick it yourself.')
    cy.contains('button', 'Pick the match').click()
    cy.get('@onStartGuide').should('have.been.calledOnceWith', 'match')
  })

  it('shows Repair files as the first guide step and moves on once the files are repaired, without the library setting', () => {
    mountHint({ guide: guideAt('repair', 0, 5) })
    cy.contains('button', 'Fix it for me').should('not.exist')
    cy.get('[cy-id="guide-hint"]').should('contain.text', 'Step 1 of 5: Repair the audio files')
    cy.contains('button', 'Repair files').click()
    cy.get('[role="dialog"] input[type="checkbox"]').should('not.exist')
    cy.get('[role="dialog"]').contains('button', 'Repair').click()
    cy.get('@onRepairFiles').should('have.been.calledOnce')
    cy.get('@advance').should('have.been.calledOnce')
  })

  it('offers the read-along EPUB as a last step', () => {
    mountHint({ guide: guideAt('epub', 5, 6) })
    cy.get('[cy-id="guide-hint"]').should('contain.text', 'Step 6 of 6: Optionally make a read-along EPUB from the audio')
    cy.contains('button', 'Create a read-along EPUB with highlighting').click()
    cy.get('@startEpub').should('have.been.calledOnceWith', 'li_1')
    cy.get('@advance').should('have.been.calledOnce')
  })

  it('lets the EPUB step be skipped', () => {
    mountHint({ guide: guideAt('epub', 5, 6) })
    cy.contains('button', 'Skip').click()
    cy.get('@startEpub').should('not.have.been.called')
    cy.get('@advance').should('have.been.calledOnce')
  })

  it('asks how to handle such books next time, and can turn the automation on', () => {
    mountHint({ props: { askNextTime: true, health: health(['chapters-unverified']) } })
    cy.get('[cy-id="guided-fix-next-time"]').should('contain.text', 'All done. Next time a book needs this:')
    cy.get('[cy-id="guided-fix-next-time"] input[type="checkbox"]').should('have.length', 2).eq(1).click()
    cy.contains('button', 'Do all of this automatically').click()
    cy.get('@enableAutomation').should('have.been.calledOnceWith', { autoRepairSeekIndex: false, autoEpub: true })
    cy.get('@onNextTimeAnswered')
      .should('have.been.calledOnce')
      .then(() => expect(getGuidancePreference()).to.equal('auto'))
  })

  it('can turn guidance off, and offers no automation without the pipeline', () => {
    mountHint({ props: { askNextTime: true, canAutomate: false } })
    cy.contains('button', 'Do all of this automatically').should('not.exist')
    cy.get('[cy-id="guided-fix-next-time"] input[type="checkbox"]').should('not.exist')
    cy.contains('button', 'No guidance, no automation').click()
    cy.get('@onNextTimeAnswered')
      .should('have.been.calledOnce')
      .then(() => expect(getGuidancePreference()).to.equal('off'))
  })
})
