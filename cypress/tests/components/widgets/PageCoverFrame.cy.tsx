import CollectionGroupCover from '@/components/widgets/media-card/CollectionGroupCover'
import PageCoverFrame from '@/components/widgets/PageCoverFrame'
import { CardSizeProvider } from '@/contexts/CardSizeContext'

describe('<PageCoverFrame />', () => {
  it('wraps the cover in a rounded, shadowed frame', () => {
    cy.mount(
      <PageCoverFrame>
        <div cy-id="cover" style={{ width: 120, height: 80 }} />
      </PageCoverFrame>
    )
    cy.get('[cy-id="page-cover-frame"]').should('have.class', 'box-shadow-book').and('have.class', 'rounded-sm').and('have.class', 'overflow-hidden')
    cy.get('[cy-id="page-cover-frame"]').should('have.css', 'box-shadow').and('not.eq', 'none')
    cy.get('[cy-id="page-cover-frame"] [cy-id="cover"]').should('exist')
  })

  it('sizes itself to the cover and does not shrink in a flex row', () => {
    cy.mount(
      <div className="flex w-40">
        <PageCoverFrame>
          <div style={{ width: 120, height: 80 }} />
        </PageCoverFrame>
        <div className="w-full">text</div>
      </div>
    )
    cy.get('[cy-id="page-cover-frame"]').invoke('outerWidth').should('eq', 120)
    cy.get('[cy-id="page-cover-frame"]').invoke('outerHeight').should('eq', 80)
  })

  it('accepts extra classes', () => {
    cy.mount(
      <PageCoverFrame className="mt-2">
        <div />
      </PageCoverFrame>
    )
    cy.get('[cy-id="page-cover-frame"]').should('have.class', 'mt-2')
  })

  it('frames an empty collection cover', () => {
    cy.mount(
      <CardSizeProvider>
        <div className="flex">
          <PageCoverFrame>
            <CollectionGroupCover books={[]} width={240} height={120} />
          </PageCoverFrame>
        </div>
      </CardSizeProvider>
    )
    cy.get('[cy-id="page-cover-frame"]').invoke('outerWidth').should('eq', 240)
    cy.get('[cy-id="page-cover-frame"]').invoke('outerHeight').should('eq', 120)
  })
})
