import GlobalSearchMenu from '@/app/(main)/GlobalSearchMenu'
import { useGlobalSearchTransformer } from '@/hooks/useGlobalSearchTransformer'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { searchResultsToShelves } from '@/lib/searchResultsToShelves'
import type { BookLibraryItem, PodcastLibraryItem, SearchLibraryResponse } from '@/types/api'
import { useRef } from 'react'

function makeBook(id: string, title: string): BookLibraryItem {
  return {
    id,
    libraryId: 'lib1',
    mediaType: 'book',
    media: { id: `media-${id}`, metadata: { title, authorName: 'Pierce Brown' } }
  } as unknown as BookLibraryItem
}

function makePodcast(id: string, title: string): PodcastLibraryItem {
  return {
    id,
    libraryId: 'lib1',
    mediaType: 'podcast',
    media: { id: `media-${id}`, metadata: { title, author: 'Host' } }
  } as unknown as PodcastLibraryItem
}

function makeResults(): SearchLibraryResponse {
  return {
    book: [
      { libraryItem: makeBook('b1', 'Golden Son 01.mp3 Companion') },
      { libraryItem: makeBook('b2', 'Golden Son'), matchKey: 'file', matchText: 'Golden Son 01.mp3' }
    ],
    podcast: [{ libraryItem: makePodcast('p1', 'My Show'), matchKey: 'file', matchText: 'episode-042.mp3' }],
    narrators: [],
    tags: [],
    genres: [],
    series: [],
    authors: []
  }
}

function MenuHarness({ results, query }: { results: SearchLibraryResponse; query: string }) {
  const menuRef = useRef<HTMLDivElement>(null)
  const flatResults = useGlobalSearchTransformer({
    searchResults: results,
    searchQuery: query,
    isSearching: false,
    isTyping: false,
    searchError: null,
    selectedLibraryId: 'lib1'
  })
  return (
    <div style={{ position: 'relative', width: 400 }}>
      <GlobalSearchMenu results={flatResults} focusedIndex={-1} onItemClick={() => {}} onItemSelect={() => {}} menuRef={menuRef} searchQuery={query} />
    </div>
  )
}

function ShelvesHarness({ results }: { results: SearchLibraryResponse }) {
  const t = useTypeSafeTranslations()
  const shelves = searchResultsToShelves(results, t)
  return (
    <ul>
      {shelves.map((shelf) => (
        <li key={shelf.id} data-testid={`shelf-${shelf.id}`}>
          {shelf.label}:{shelf.entities.map((entity) => ('id' in entity ? entity.id : '')).join(',')}
        </li>
      ))}
    </ul>
  )
}

describe('Search results matched by file name (#5680)', () => {
  it('shows the matched file path under file-matched results in the global search menu', () => {
    cy.mount(<MenuHarness results={makeResults()} query="golden son 01.mp3" />)

    cy.get('[data-testid="search-result-matched-file"]').should('have.length', 2)
    cy.get('[data-testid="search-result-matched-file"]').first().should('contain.text', 'Golden Son 01.mp3').and('have.attr', 'title', 'Matched file')
    cy.get('[data-testid="search-result-matched-file"]').eq(1).should('contain.text', 'episode-042.mp3')

    // Metadata matches do not show a file line
    cy.contains('Golden Son 01.mp3 Companion').closest('[data-index]').find('[data-testid="search-result-matched-file"]').should('not.exist')
  })

  it('highlights the query inside the matched file path, normalizing backslashes', () => {
    cy.mount(<MenuHarness results={makeResults()} query="\Golden Son 01" />)
    cy.get('[data-testid="search-result-matched-file"]').should('have.length', 2)
    cy.mount(<MenuHarness results={makeResults()} query="son 01.MP3" />)
    cy.get('[data-testid="search-result-matched-file"]').first().find('span.font-bold').should('have.text', 'Son 01.mp3')
  })

  it('shows no file line when nothing matched by file', () => {
    const results = makeResults()
    results.book = [results.book[0]]
    results.podcast = []
    cy.mount(<MenuHarness results={results} query="golden" />)
    cy.contains('Golden Son 01.mp3 Companion').should('exist')
    cy.get('[data-testid="search-result-matched-file"]').should('not.exist')
  })

  it('puts file matches on their own shelves on the search page', () => {
    cy.mount(<ShelvesHarness results={makeResults()} />)
    cy.get('[data-testid="shelf-books"]').should('have.text', 'Books:b1')
    cy.get('[data-testid="shelf-podcasts"]').should('not.exist')
    cy.get('[data-testid="shelf-books-file-matches"]').should('have.text', 'Matched by file name:b2')
    cy.get('[data-testid="shelf-podcasts-file-matches"]').should('have.text', 'Matched by file name:p1')
    cy.get('li').then(($items) => {
      expect([...$items].map((el) => el.getAttribute('data-testid'))).to.deep.equal(['shelf-books', 'shelf-books-file-matches', 'shelf-podcasts-file-matches'])
    })
  })
})
