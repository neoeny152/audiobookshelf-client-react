import { BookshelfSelectionProvider, useBookshelfSelection } from '@/contexts/BookshelfSelectionContext'
import { useBookshelfCardSelection } from '@/hooks/useBookshelfCardSelection'
import type { LibraryItem } from '@/types/api'

function book(id: string): LibraryItem {
  return {
    id,
    libraryId: 'lib_1',
    mediaType: 'book',
    isMissing: false,
    isInvalid: false,
    media: { metadata: { title: id }, audioFiles: [], tracks: [], chapters: [] }
  } as unknown as LibraryItem
}

/** 8 slots, indexes 2-4 are an unloaded page (holes in the array, like useBookshelfData). */
function makeShelf(): (LibraryItem | null)[] {
  const shelf: (LibraryItem | null)[] = new Array(8)
  for (const i of [0, 1, 5, 6, 7]) shelf[i] = book(`li_${i}`)
  return shelf
}

const renderCounts = new Map<string, number>()

function Card({ shelf, index, scopeId = 'bookshelf:items' }: { shelf: (LibraryItem | null)[]; index: number; scopeId?: string }) {
  const item = shelf[index]!
  const { selected, isSelectionMode, onSelect } = useBookshelfCardSelection(item, index, shelf, undefined, { scopeId })
  renderCounts.set(item.id, (renderCounts.get(item.id) ?? 0) + 1)
  return (
    <button
      type="button"
      data-cy={`card-${item.id}`}
      data-selected={String(selected)}
      data-mode={String(isSelectionMode)}
      onClick={(event) => onSelect?.(event)}
    >
      {item.id}
    </button>
  )
}

function SelectionSummary() {
  const { selectedItems, selectionKind, clearSelection } = useBookshelfSelection()
  return (
    <div>
      <span data-cy="selected">{selectedItems.map((item) => item.libraryItemId).join(',')}</span>
      <span data-cy="kind">{selectionKind ?? ''}</span>
      <button type="button" data-cy="clear" onClick={clearSelection}>
        clear
      </button>
    </div>
  )
}

function Shelf({ shelf }: { shelf: (LibraryItem | null)[] }) {
  return (
    <BookshelfSelectionProvider>
      <SelectionSummary />
      {shelf.map((item, index) => (item ? <Card key={item.id} shelf={shelf} index={index} /> : null))}
      <Card shelf={[book('other')]} index={0} scopeId="shelf:other" />
    </BookshelfSelectionProvider>
  )
}

describe('useBookshelfCardSelection', () => {
  beforeEach(() => {
    renderCounts.clear()
  })

  it('shift-click selects the loaded cards of a range that crosses an unloaded page', () => {
    cy.mount(<Shelf shelf={makeShelf()} />)

    cy.get('[data-cy=card-li_1]').click()
    cy.get('[data-cy=selected]').should('have.text', 'li_1')
    cy.get('[data-cy=kind]').should('have.text', 'book')

    cy.get('[data-cy=card-li_6]').click({ shiftKey: true })
    cy.get('[data-cy=selected]').should('have.text', 'li_1,li_5,li_6')
    cy.get('[data-cy=card-li_0]').should('have.attr', 'data-selected', 'false')
    cy.get('[data-cy=card-li_7]').should('have.attr', 'data-selected', 'false')
    cy.get('[data-cy=card-li_5]').should('have.attr', 'data-selected', 'true').and('have.attr', 'data-mode', 'true')
  })

  it('keeps selection to one shelf scope', () => {
    cy.mount(<Shelf shelf={makeShelf()} />)

    cy.get('[data-cy=card-li_0]').click()
    cy.get('[data-cy=card-other]').should('have.attr', 'data-mode', 'false').click()
    cy.get('[data-cy=selected]').should('have.text', 'li_0')

    cy.get('[data-cy=clear]').click()
    cy.get('[data-cy=selected]').should('have.text', '')
    cy.get('[data-cy=card-other]').click()
    cy.get('[data-cy=selected]').should('have.text', 'other')
  })

  it('re-renders only the cards whose selection state changed', () => {
    cy.mount(<Shelf shelf={makeShelf()} />)

    // The first click switches every card on the shelf into selection mode
    cy.get('[data-cy=card-li_0]').click()
    cy.get('[data-cy=card-li_0]').should('have.attr', 'data-selected', 'true')
    cy.then(() => {
      renderCounts.clear()
    })

    // Later clicks only touch the clicked card
    cy.get('[data-cy=card-li_6]').click()
    cy.get('[data-cy=card-li_6]').should('have.attr', 'data-selected', 'true')
    cy.then(() => {
      expect(renderCounts.get('li_6')).to.be.greaterThan(0)
      expect(renderCounts.has('li_1')).to.equal(false)
      expect(renderCounts.has('li_5')).to.equal(false)
      expect(renderCounts.has('other')).to.equal(false)
    })
  })
})
