import GuidedFixCard, { type GuidedFixActions, type GuidedFixCardProps } from '@/components/widgets/guided-fix/GuidedFixCard'
import { GuidedFixContext, type GuidedFix } from '@/contexts/GuidedFixContext'
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

/** Hosts the card like the item page; the button stands in for a `pipeline_item_updated` event */
function Harness({ next, ...props }: GuidedFixCardProps & { next?: PipelineItemState }) {
  const [state, setState] = useState(props.pipelineState)
  return (
    <>
      <GuidedFixCard {...props} pipelineState={state} />
      {next && (
        <button type="button" cy-id="push-state" onClick={() => setState(next)}>
          push
        </button>
      )}
    </>
  )
}

function mountCard({
  props = {},
  actions = {},
  guide = null,
  next
}: { props?: Partial<GuidedFixCardProps>; actions?: Partial<GuidedFixActions>; guide?: GuidedFix | null; next?: PipelineItemState } = {}) {
  const current = props.health ?? health(ALL_ISSUES)
  const fullActions: GuidedFixActions = {
    getHealth: actions.getHealth ?? cy.stub().as('getHealth').resolves({ ok: true, data: current }),
    run:
      actions.run ??
      cy
        .stub()
        .as('run')
        .resolves({ ok: true, data: pipelineState({ status: 'queued', trigger: 'fix', updatedAt: 10 }) }),
    enableAutoRepair: actions.enableAutoRepair ?? cy.stub().as('enableAutoRepair').resolves({ ok: true, data: {} })
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
        onStartGuide={cy.stub().as('onStartGuide')}
        onRepairFiles={cy.stub().as('onRepairFiles').resolves(true)}
        {...props}
      />
    </GuidedFixContext.Provider>
  )
}

describe('<GuidedFixCard />', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('says what is wrong first and offers both ways out', () => {
    mountCard()
    cy.get('[cy-id="guided-fix-card"]').should('contain.text', "Chapters probably aren't right for this book.")
    cy.get('[cy-id="guided-fix-reason"]').should('have.text', 'The MP3 files report the wrong length (off by 1 min 30 s).')
    cy.contains('button', 'Guide me').click()
    cy.get('@onStartGuide').should('have.been.calledOnce')
  })

  it('stays away when the chapters are only unverified', () => {
    mountCard({ props: { health: health(['chapters-unverified']) } })
    cy.get('[cy-id="guided-fix-card"]').should('not.exist')
  })

  it('remembers a dismissal until the issues change', () => {
    mountCard()
    cy.get('button[aria-label="Dismiss"]').click()
    cy.get('[cy-id="guided-fix-card"]').should('not.exist')
    mountCard()
    cy.get('[cy-id="guided-fix-card"]').should('not.exist')
    mountCard({ props: { health: health(['unmatched', 'chapters-from-files']) } })
    cy.get('[cy-id="guided-fix-card"]').should('exist')
  })

  it('asks before rewriting MP3s, and can turn the setting on for next time', () => {
    mountCard()
    cy.contains('button', 'Fix automatically').click()
    cy.get('@getHealth').should('have.been.calledWith', 'li_1', true)
    cy.get('[cy-id="repair-consent"]')
      .should('contain.text', 'Repair the audio files first?')
      .and('contain.text', 'Rewrite 4 MP3 files')
      .and('contain.text', 'Do this automatically from now on')
    cy.get('[role="dialog"]').contains('button', 'Cancel').click()
    cy.get('@run').should('not.have.been.called')

    cy.contains('button', 'Fix automatically').click()
    cy.get('[cy-id="repair-consent"] input[type="checkbox"]').click()
    cy.get('[role="dialog"]').contains('button', 'Repair and fix').click()
    cy.get('@enableAutoRepair').should('have.been.calledOnce')
    cy.get('@run').should('have.been.calledOnceWith', 'li_1', { fix: true, repairSeekIndex: true })
    cy.get('[cy-id="guided-fix-progress"]').should('contain.text', 'Fixing this book: Queued')
  })

  it('does not ask when the library repairs on its own', () => {
    mountCard({ props: { health: health(ALL_ISSUES, true) } })
    cy.contains('button', 'Fix automatically').click()
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
    mountCard({
      props: { health: health(['unmatched', 'chapters-from-files']), pipelineState: pipelineState({ status: 'done', updatedAt: 5 }) },
      next: stopped
    })
    cy.contains('button', 'Fix automatically').click()
    cy.get('@run').should('have.been.calledWith', 'li_1', { fix: true, repairSeekIndex: false })
    // The state from before the run is not its result
    cy.get('[cy-id="guided-fix-progress"]').should('contain.text', 'Queued')
    cy.get('[cy-id="push-state"]').click()
    cy.get('[cy-id="guided-fix-result"]').should('have.text', 'Not sure which book this is (best match 86 %). Pick it yourself.')
    cy.contains('button', 'Pick the match').click()
    cy.get('@onStartGuide').should('have.been.calledOnceWith', 'match')
  })

  it('shows Repair files as the first guide step and moves on once the files are repaired', () => {
    const guide: GuidedFix = { stepId: 'repair', stepIndex: 0, total: 5, paused: false, advance: cy.stub().as('advance'), resume: cy.stub(), stop: cy.stub() }
    mountCard({ guide })
    cy.contains('button', 'Fix automatically').should('not.exist')
    cy.get('[cy-id="guide-hint"]').should('contain.text', 'Step 1 of 5: Repair the audio files')
    cy.contains('button', 'Repair files').click()
    cy.get('[role="dialog"]').contains('button', 'Repair').click()
    cy.get('@onRepairFiles').should('have.been.calledOnce')
    cy.get('@advance').should('have.been.calledOnce')
  })
})
