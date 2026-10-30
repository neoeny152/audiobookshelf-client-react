import GuideTarget from '@/components/widgets/guided-fix/GuideTarget'
import { GuidedFixContext, type GuidedFix } from '@/contexts/GuidedFixContext'

function guide(partial: Partial<GuidedFix> = {}): GuidedFix {
  return { stepId: 'lookup', stepIndex: 2, total: 5, paused: false, advance: cy.stub(), resume: cy.stub(), stop: cy.stub().as('stop'), ...partial }
}

function mountTarget(value: GuidedFix | null) {
  cy.mount(
    <GuidedFixContext.Provider value={value}>
      <GuideTarget step="lookup">
        <form>
          <button type="button">Region</button>
          <button type="submit">Search</button>
        </form>
      </GuideTarget>
    </GuidedFixContext.Provider>
  )
}

describe('<GuideTarget />', () => {
  it('renders the control alone when its step is not the current one', () => {
    mountTarget(null)
    cy.get('[cy-id="guide-hint"]').should('not.exist')
    mountTarget(guide({ stepId: 'snap' }))
    cy.get('[cy-id="guide-hint"]').should('not.exist')
    mountTarget(guide({ paused: true }))
    cy.get('[cy-id="guide-hint"]').should('not.exist')
  })

  it('marks the current step with a hint that describes the control', () => {
    mountTarget(guide())
    cy.get('[cy-id="guide-hint"] [role="status"]')
      .should('have.text', 'Step 3 of 5: Search Audible for its chapters')
      .invoke('attr', 'id')
      .then((id) => {
        cy.contains('button', 'Search').should('have.attr', 'aria-describedby', id)
        cy.contains('button', 'Region').should('not.have.attr', 'aria-describedby')
      })
    cy.focused().should('not.exist')
  })

  it('stops the guide with its button or Escape', () => {
    mountTarget(guide())
    cy.get('button[aria-label="Stop the guide"]').focus().type('{esc}')
    cy.get('@stop').should('have.been.calledOnce')
    cy.get('button[aria-label="Stop the guide"]').click()
    cy.get('@stop').should('have.been.calledTwice')
  })
})
