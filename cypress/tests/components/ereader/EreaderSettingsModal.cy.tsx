import EreaderSettingsModal from '@/components/ereader/EreaderSettingsModal'
import { DEFAULT_EREADER_SETTINGS, type EreaderSettings } from '@/lib/ereader/ereaderSettings'

function mountModal(readAlong?: { available: boolean; reason?: string }, settings: Partial<EreaderSettings> = {}) {
  const onChange = cy.stub().as('onChange')
  cy.mount(
    <EreaderSettingsModal
      isOpen
      ebookFormat="epub"
      settings={{ ...DEFAULT_EREADER_SETTINGS, ...settings }}
      onChange={onChange}
      onClose={() => {}}
      readAlong={readAlong}
    />
  )
}

describe('EreaderSettingsModal read-along', () => {
  it('hides the read-along toggles without data', () => {
    mountModal(undefined)
    cy.contains('Font family').should('exist')
    cy.get('[cy-id="ereader-read-along-settings"]').should('not.exist')
    cy.contains('Read along with the narration').should('not.exist')
  })

  it('shows both toggles when the data matches and changes the settings', () => {
    mountModal({ available: true })
    cy.get('[cy-id="ereader-read-along-settings"]').within(() => {
      cy.get('[role="switch"]').should('have.length', 2)
      cy.get('[role="switch"]').eq(0).should('have.attr', 'aria-checked', 'true').and('not.be.disabled')
      cy.get('[role="switch"]').eq(1).should('have.attr', 'aria-checked', 'true').and('not.be.disabled')
      cy.contains('Read along with the narration')
      cy.contains('Tap a sentence to play from there')
      cy.get('[role="switch"]').eq(0).click()
    })
    cy.get('@onChange').should('have.been.calledWith', { readAlong: false })
    cy.get('[cy-id="ereader-read-along-reason"]').should('not.exist')
  })

  it('disables tap-to-seek while read-along is off', () => {
    mountModal({ available: true }, { readAlong: false })
    cy.get('[cy-id="ereader-read-along-settings"] [role="switch"]').eq(1).should('be.disabled')
  })

  it('shows the reason and disabled toggles on a mismatch', () => {
    mountModal({ available: false, reason: 'Read-along data does not match this EPUB' })
    cy.get('[cy-id="ereader-read-along-settings"] [role="switch"]').each(($el) => {
      cy.wrap($el).should('be.disabled').and('have.attr', 'aria-checked', 'false')
    })
    cy.get('[cy-id="ereader-read-along-reason"]').should('have.text', 'Read-along data does not match this EPUB')
  })
})
