import BookDetailsEdit from '@/components/widgets/BookDetailsEdit'
import type { BookLibraryItem } from '@/types/api'

function makeBookItem(description: string): BookLibraryItem {
  return {
    id: 'li_book',
    ino: '',
    libraryId: 'lib_1',
    path: '',
    relPath: '',
    isFile: false,
    mtimeMs: 0,
    ctimeMs: 0,
    birthtimeMs: 0,
    addedAt: 0,
    updatedAt: 0,
    isMissing: false,
    isInvalid: false,
    mediaType: 'book',
    media: {
      metadata: {
        title: 'Book Title',
        description,
        authors: [{ id: 'au_1', name: 'Author One' }],
        narrators: [],
        series: [],
        genres: [],
        explicit: false,
        abridged: false
      },
      tags: []
    }
  }
}

function mountBook(description: string) {
  const onChange = cy.spy().as('onChange')
  cy.mount(
    <BookDetailsEdit
      libraryItem={makeBookItem(description)}
      availableAuthors={[]}
      availableNarrators={[]}
      availableGenres={[]}
      availableTags={[]}
      availableSeries={[]}
      onChange={onChange}
    />
  )
}

function lastHasChanges() {
  return cy.get('@onChange').its('lastCall.args.0.hasChanges')
}

describe('BookDetailsEdit', () => {
  it('description: edit then restore reports no changes', () => {
    // Non-canonical source HTML (`<b>`, whitespace between blocks) that the editor rewrites on load
    mountBook('<p>Hello <b>world</b></p>\n<p>Second</p>')
    cy.get('[cy-id="slate-editor"] [contenteditable="true"]').should('contain.text', 'Second')
    lastHasChanges().should('equal', false)

    cy.get('[cy-id="slate-editor"] [contenteditable="true"]').click().type('{moveToEnd}x')
    lastHasChanges().should('equal', true)

    cy.get('[cy-id="slate-editor"] [contenteditable="true"]').type('{backspace}')
    lastHasChanges().should('equal', false)
  })

  it('description: clearing an empty description reports no changes', () => {
    mountBook('')
    cy.get('[cy-id="slate-editor"] [contenteditable="true"]').click().type('x')
    lastHasChanges().should('equal', true)
    cy.get('[cy-id="slate-editor"] [contenteditable="true"]').type('{backspace}')
    lastHasChanges().should('equal', false)
  })

  it('highlights only the fields that differ from the saved values', () => {
    mountBook('')
    cy.get('input[aria-label="Title"]').as('title').should('not.have.class', 'text-info')
    cy.get('input[aria-label="Subtitle"]').should('not.have.class', 'text-info')

    cy.get('@title').type(' Two')
    cy.get('@title').should('have.class', 'text-info')
    cy.get('input[aria-label="Subtitle"]').should('not.have.class', 'text-info')
    cy.get('[role="list"]').first().should('not.have.class', 'text-info')

    cy.get('@title').clear().type('Book Title')
    cy.get('@title').should('not.have.class', 'text-info')
    lastHasChanges().should('equal', false)
  })

  it('highlights the authors list when an author is removed', () => {
    mountBook('')
    cy.get('[role="list"]').first().as('authors').should('not.have.class', 'text-info')
    cy.get('@authors').find('[role="listitem"]').first().find('button[aria-label="Remove"]').click({ force: true })
    cy.get('@authors').should('have.class', 'text-info')
  })
})
