import NeedsRepairList from '@/components/widgets/pipeline/NeedsRepairList'
import type { PipelineItemState } from '@/types/api'
import { LIBRARY_ID, pipelineState } from './pipelineFixtures'

const chapters = { source: null, diffSec: null, applied: false, needsReview: [], backup: null }

const waiting = pipelineState({
  libraryItemId: 'li_rr',
  title: 'Red Rising',
  status: 'needs-review',
  repair: { result: 'needs-ok', files: 4, maxDrift: 41.2 },
  chapters: { ...chapters, result: 'needs-review', reason: 'needs-seek-index-repair' }
})

const items: PipelineItemState[] = [
  waiting,
  // From before the repair step: the drift is on the chapters result
  pipelineState({
    libraryItemId: 'li_old',
    title: 'Golden Son',
    status: 'needs-review',
    chapters: { ...chapters, result: 'needs-review', reason: 'needs-seek-index-repair', seekIndex: { files: 2, maxDrift: 75 } }
  }),
  pipelineState({
    libraryItemId: 'li_late',
    title: 'Late chapters',
    status: 'needs-review',
    chapters: { ...chapters, result: 'needs-review', reason: '2 late' }
  }),
  pipelineState({
    libraryItemId: 'li_dry',
    status: 'needs-review',
    dryRun: true,
    chapters: { ...chapters, result: 'needs-review', reason: 'needs-seek-index-repair' }
  }),
  pipelineState({ libraryItemId: 'li_run', status: 'repairing' })
]

function mountList(list: PipelineItemState[] = items) {
  cy.mount(
    <NeedsRepairList libraryId={LIBRARY_ID} items={list} busyItemIds={new Set()} onRepair={cy.stub().as('onRepair')} onNotNow={cy.stub().as('onNotNow')} />
  )
}

describe('<NeedsRepairList />', () => {
  it('lists only the books waiting for an OK to repair their MP3s', () => {
    mountList()
    cy.get('[cy-id="needs-repair-list"]').should('contain.text', 'Needs your OK')
    cy.get('[cy-id="needs-repair-row"]').should('have.length', 2)
    cy.get('[cy-id="needs-repair-row"]')
      .first()
      .should('contain.text', 'Red Rising')
      .and('contain.text', '4 MP3 files report the wrong length (off by up to 41.2 s).')
    cy.get('[cy-id="needs-repair-row"]').last().should('contain.text', '(off by up to 1 min 15 s)')
  })

  it('renders nothing when no book waits', () => {
    mountList(items.slice(2))
    cy.get('[cy-id="needs-repair-list"]').should('not.exist')
  })

  it('repairs after the OK, passing the "from now on" choice, and puts a book aside', () => {
    mountList()
    cy.get('[cy-id="needs-repair-row"]').first().contains('button', 'Repair').click()
    cy.get('[cy-id="repair-consent"] input[type="checkbox"]').click()
    cy.get('[role="dialog"]').contains('button', 'Repair').click()
    cy.get('@onRepair').should('have.been.calledOnceWith', waiting, true)
    cy.get('[cy-id="needs-repair-row"]').first().contains('button', 'Not now').click()
    cy.get('@onNotNow').should('have.been.calledOnceWith', waiting)
  })
})
