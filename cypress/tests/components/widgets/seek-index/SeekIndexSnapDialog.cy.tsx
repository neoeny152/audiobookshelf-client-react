import SeekIndexSnapDialog, { type SeekIndexSnapDialogProps } from '@/components/widgets/seek-index/SeekIndexSnapDialog'

function mountDialog(overrides: Partial<SeekIndexSnapDialogProps> = {}) {
  const props: SeekIndexSnapDialogProps = {
    isOpen: true,
    fileCount: 4,
    maxDrift: 43.38,
    chapterCount: 50,
    shiftDefault: true,
    onChoose: cy.stub().as('onChoose'),
    ...overrides
  }
  cy.mount(<SeekIndexSnapDialog {...props} />)
}

describe('<SeekIndexSnapDialog />', () => {
  it('explains the drift and the repair', () => {
    mountDialog()
    cy.get('[cy-id="seek-index-snap-dialog"]')
      .should('contain.text', 'Repair audio files before snapping?')
      .and('contain.text', '4 of this book')
      .and('contain.text', 'by up to 43.4 s near the end of the worst file')
      .and('contain.text', 'copied bit-for-bit (no re-encoding, no quality loss)')
      .and('contain.text', 'kept as a backup you can restore')
  })

  it('repair and snap shifts the chapters by default', () => {
    mountDialog()
    cy.contains('button', 'Repair and snap').click()
    cy.get('@onChoose').should('have.been.calledOnceWith', { choice: 'repair', shiftChapters: true })
  })

  it('does not shift chapters just taken from Audible unless asked', () => {
    mountDialog({ shiftDefault: false })
    cy.contains('button', 'Repair and snap').click()
    cy.get('@onChoose').should('have.been.calledOnceWith', { choice: 'repair', shiftChapters: false })
  })

  it('snap anyway', () => {
    mountDialog()
    cy.contains('button', 'Snap anyway').click()
    cy.get('@onChoose').should('have.been.calledOnceWith', { choice: 'snap' })
  })

  it('cancel', () => {
    mountDialog()
    cy.contains('button', 'Cancel').click()
    cy.get('@onChoose').should('have.been.calledOnceWith', { choice: 'cancel' })
  })
})
