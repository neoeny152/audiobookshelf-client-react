import PipelineProcessingView, { type PipelineProcessingViewProps } from '@/components/widgets/pipeline/PipelineProcessingView'
import type { PipelineTab } from '@/lib/autoPipeline'
import type { PipelineItemState } from '@/types/api'
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { useState } from 'react'
import { LIBRARY_ID, pipelineState } from './pipelineFixtures'

const ITEMS: PipelineItemState[] = [
  pipelineState({ libraryItemId: 'li_q1', title: 'Queued Two', status: 'queued', queuedAt: 20 }),
  pipelineState({ libraryItemId: 'li_q2', title: 'Matching One', status: 'matching', queuedAt: 10 }),
  pipelineState({
    libraryItemId: 'li_r1',
    title: 'Late Chapters',
    status: 'needs-review',
    step: 'chapters',
    reason: '3 LATE',
    match: { result: 'matched', confidence: 98, asin: 'B0A', candidates: [] },
    chapters: { result: 'needs-review', source: 'aligned', diffSec: 1, applied: false, needsReview: [{ index: 3, why: 'late' }], backup: null }
  }),
  pipelineState({
    libraryItemId: 'li_r2',
    title: 'Unsure Match',
    status: 'needs-review',
    step: 'matching',
    reason: 'low confidence',
    match: { result: 'needs-review', confidence: 81, asin: null, candidates: [] }
  }),
  pipelineState({
    libraryItemId: 'li_d1',
    title: 'All Good',
    status: 'done',
    updatedAt: 5,
    chapters: { result: 'applied', source: 'aligned', diffSec: 0, applied: true, needsReview: [], backup: 'chapters-2026.json' }
  }),
  pipelineState({ libraryItemId: 'li_d2', title: 'Would Do', status: 'done', dryRun: true, updatedAt: 9, would: 'would apply 47 chapters' }),
  pipelineState({ libraryItemId: 'li_f1', title: 'Broken', status: 'failed', step: 'epub', reason: 'Sidecar unreachable' })
]

type HarnessProps = Partial<Omit<PipelineProcessingViewProps, 'tab' | 'onTabChange'>> & { initialTab?: PipelineTab }

function Harness({ initialTab = 'queue', ...props }: HarnessProps) {
  const [tab, setTab] = useState<PipelineTab>(initialTab)
  return (
    <PipelineProcessingView
      libraryId={LIBRARY_ID}
      items={ITEMS}
      mode="on"
      gate
      canRunLibrary
      onRetry={() => {}}
      onDismiss={() => {}}
      onUndoChapters={() => {}}
      onRunLibrary={() => {}}
      coverUrl={() => 'data:image/gif;base64,R0lGODlhAQABAAAAACw='}
      {...props}
      tab={tab}
      onTabChange={setTab}
    />
  )
}

function mountView(props: HarnessProps = {}) {
  const router = {
    back: cy.stub(),
    forward: cy.stub(),
    refresh: cy.stub(),
    push: cy.stub(),
    replace: cy.stub(),
    prefetch: cy.stub()
  } as unknown as AppRouterInstance
  const handlers = {
    onRetry: cy.stub().as('retry'),
    onDismiss: cy.stub().as('dismiss'),
    onUndoChapters: cy.stub().as('undo'),
    onRunLibrary: cy.stub().as('runLibrary')
  }
  cy.mount(
    <AppRouterContext.Provider value={router}>
      <Harness {...handlers} {...props} />
    </AppRouterContext.Provider>
  )
}

const row = (id: string) => cy.get(`[cy-id="pipeline-row"][data-item-id="${id}"]`)
const confirmYes = () => cy.get('[role="dialog"]').find('button').last().click()

describe('<PipelineProcessingView />', () => {
  it('counts the books per tab and lists the queue oldest first', () => {
    mountView()
    cy.get('[cy-id="pipeline-tab-count-queue"]').should('have.text', '2')
    cy.get('[cy-id="pipeline-tab-count-review"]').should('have.text', '2')
    cy.get('[cy-id="pipeline-tab-count-done"]').should('have.text', '2')
    cy.get('[cy-id="pipeline-tab-count-failed"]').should('have.text', '1')
    cy.get('[cy-id="pipeline-row-title"]').then((titles) => {
      expect([...titles].map((el) => el.textContent)).to.deep.equal(['Matching One', 'Queued Two'])
    })
    cy.get('[cy-id="pipeline-mode"]').should('contain.text', 'On')
  })

  it('switches tabs', () => {
    mountView()
    cy.get('[cy-id="pipeline-tab-failed"]').click()
    cy.get('[cy-id="pipeline-tab-failed"]').should('have.attr', 'aria-selected', 'true')
    cy.get('[cy-id="pipeline-row"]').should('have.length', 1).and('contain.text', 'Broken')
  })

  it('offers chapter review for a chapters review and Match for a match review', () => {
    mountView({ initialTab: 'review' })
    row('li_r1').find('[cy-id="pipeline-status-match"]').should('have.text', 'Match 98%')
    row('li_r1').find('[cy-id="pipeline-status-reason"]').should('have.text', '3 LATE')
    row('li_r1').contains('a', 'Review chapters').should('have.attr', 'href', `/library/${LIBRARY_ID}/item/li_r1?edit=chapters&proposal=pipeline`)
    row('li_r1').find('[cy-id="pipeline-row-actions"] a').filter(':contains("Match")').should('not.exist')
    row('li_r2').find('[cy-id="pipeline-row-actions"]').contains('a', 'Match').should('have.attr', 'href', `/library/${LIBRARY_ID}/item/li_r2?edit=match`)
    row('li_r2').find('a').filter(':contains("Review chapters")').should('not.exist')
    row('li_r2').contains('a', 'Open').should('have.attr', 'href', `/library/${LIBRARY_ID}/item/li_r2`)
  })

  it('retries and dismisses a row', () => {
    mountView({ initialTab: 'failed' })
    row('li_f1').find('[cy-id="pipeline-status-reason"]').should('have.text', 'Sidecar unreachable')
    row('li_f1').contains('button', 'Retry').click()
    cy.get('@retry').should('have.been.calledOnce').its('firstCall.args.0.libraryItemId').should('equal', 'li_f1')
    row('li_f1').contains('button', 'Dismiss').click()
    cy.get('@dismiss').should('have.been.calledOnce')
  })

  it('does not offer Retry while a book is still queued', () => {
    mountView()
    row('li_q1').find('button').filter(':contains("Retry")').should('not.exist')
    row('li_q1').contains('button', 'Dismiss').should('exist')
  })

  it('undoes applied chapters after confirming, and shows dry-run results', () => {
    mountView({ initialTab: 'done' })
    row('li_d2').find('[cy-id="pipeline-status-would"]').should('have.text', 'would apply 47 chapters')
    row('li_d2').find('button').filter(':contains("Undo chapters")').should('not.exist')
    row('li_d1').contains('button', 'Undo chapters').click()
    cy.get('[role="dialog"]').should('contain.text', 'All Good').contains('button', 'Cancel').click()
    cy.get('@undo').should('not.have.been.called')
    row('li_d1').contains('button', 'Undo chapters').click()
    confirmYes()
    cy.get('@undo').should('have.been.calledOnce')
  })

  it('runs the whole library after confirming', () => {
    mountView()
    cy.contains('button', 'Run on unprocessed items').click()
    cy.get('[role="dialog"]').should('contain.text', 'not been processed yet')
    confirmYes()
    cy.get('@runLibrary').should('have.been.calledOnceWith', 'unprocessed')
    cy.contains('button', 'Run on all items').click()
    confirmYes()
    cy.get('@runLibrary').should('have.been.calledWith', 'all')
  })

  it('hides the library buttons from non-admins and explains a closed gate', () => {
    mountView({ canRunLibrary: false, gate: false })
    cy.get('[cy-id="pipeline-gate-off"]').should('exist')
    cy.contains('button', 'Run on unprocessed items').should('not.exist')
  })

  it('disables a row while its request runs', () => {
    mountView({ initialTab: 'failed', busyItemIds: new Set(['li_f1']) })
    row('li_f1').contains('button', 'Retry').should('be.disabled')
  })

  it('does not let a book be dismissed while the worker is on it', () => {
    mountView({ workerCurrent: 'li_q2' })
    row('li_q2').find('[cy-id="pipeline-row-current"]').should('exist')
    row('li_q2').contains('button', 'Dismiss').should('be.disabled')
    row('li_q1').contains('button', 'Dismiss').should('not.be.disabled')
  })

  it('offers no chapter review for a dry run and no second undo after a restore', () => {
    const review = ITEMS[2]
    const applied = ITEMS[4]
    mountView({
      initialTab: 'review',
      items: [
        { ...review, dryRun: true },
        { ...applied, libraryItemId: 'li_d3', status: 'needs-review', step: 'chapters', chapters: { ...applied.chapters!, result: 'restored' } }
      ]
    })
    row('li_r1').find('a').filter(':contains("Review chapters")').should('not.exist')
    row('li_d3').find('button').filter(':contains("Undo chapters")').should('not.exist')
  })

  it('says when a tab is empty', () => {
    mountView({ items: [] })
    cy.get('[cy-id="pipeline-empty"]').should('exist')
  })
})
