import PipelineStatusChip from '@/components/widgets/pipeline/PipelineStatusChip'
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { ReactNode } from 'react'
import { pipelineState } from './pipelineFixtures'

function withRouter(node: ReactNode) {
  const router = { back: cy.stub(), forward: cy.stub(), refresh: cy.stub(), push: cy.stub(), replace: cy.stub(), prefetch: cy.stub() } as unknown as AppRouterInstance
  return <AppRouterContext.Provider value={router}>{node}</AppRouterContext.Provider>
}

describe('<PipelineStatusChip />', () => {
  it('shows the status, reason and match confidence', () => {
    cy.mount(
      withRouter(
        <PipelineStatusChip
          state={pipelineState({
            status: 'needs-review',
            step: 'chapters',
            reason: '3 chapters start late',
            match: { result: 'matched', confidence: 97, asin: 'B0TEST', candidates: [] }
          })}
          href="/library/lib_1/processing?tab=review"
        />
      )
    )
    cy.get('[cy-id="pipeline-status"]').should('have.attr', 'data-status', 'needs-review')
    cy.get('[cy-id="pipeline-status-chip"]').should('contain.text', 'Needs review')
    cy.get('[cy-id="pipeline-status-reason"]').should('have.text', '3 chapters start late')
    cy.get('[cy-id="pipeline-status-match"]').should('have.text', 'Match 97%')
    cy.get('[cy-id="pipeline-status"] a').should('have.attr', 'href', '/library/lib_1/processing?tab=review')
  })

  it('labels each step while it runs', () => {
    cy.mount(withRouter(<PipelineStatusChip state={pipelineState({ status: 'chapters' })} />))
    cy.get('[cy-id="pipeline-status-chip"]').should('contain.text', 'Checking chapters')
    cy.get('[cy-id="pipeline-status-reason"]').should('not.exist')
    cy.get('[cy-id="pipeline-status-match"]').should('not.exist')
    cy.get('[cy-id="pipeline-status"] a').should('not.exist')
  })

  it('marks dry runs and lists what they would have done', () => {
    cy.mount(
      withRouter(
        <PipelineStatusChip
          state={pipelineState({
            status: 'done',
            dryRun: true,
            match: { result: 'matched', confidence: 96, asin: 'B0TEST', candidates: [], would: 'would match B0TEST at 96 %' },
            chapters: { result: 'applied', source: 'aligned', diffSec: 1, applied: false, needsReview: [], backup: null, would: 'would apply 47 chapters' }
          })}
        />
      )
    )
    cy.get('[cy-id="pipeline-status-chip"]').should('contain.text', 'Processed').and('contain.text', 'dry run')
    cy.get('[cy-id="pipeline-status-would"]').should('have.length', 2).first().should('have.text', 'would match B0TEST at 96 %')
  })
})
