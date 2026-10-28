import { useDetailsEdit } from '@/hooks/useDetailsEdit'
import type { Author, Series } from '@/types/api'

type ProbeDetails = {
  title: string | null
  description?: string | null
  authors: Author[]
  series: Series[]
  genres: string[]
}

const extractAuthor = (details: ProbeDetails) => details.authors.map((a) => a.name).join(', ')

const NO_TAGS: string[] = []

function DetailsEditProbe({ metadata, tags = NO_TAGS }: { metadata: ProbeDetails; tags?: string[] }) {
  const { details, changes, dirtyFields, tagsDirty, updateField, updateTags } = useDetailsEdit<ProbeDetails>({
    metadata,
    tags,
    libraryItemId: 'li_1',
    extractAuthor
  })

  return (
    <div>
      <span data-cy="has-changes">{String(changes.hasChanges)}</span>
      <span data-cy="dirty-fields">{[...dirtyFields].sort().join(',')}</span>
      <span data-cy="tags-dirty">{String(tagsDirty)}</span>
      <button data-cy="set-title" onClick={() => updateField('title')('Changed')}>
        set title
      </button>
      <button data-cy="restore-title" onClick={() => updateField('title')(metadata.title ?? '')}>
        restore title
      </button>
      <button data-cy="clear-description" onClick={() => updateField('description')('')}>
        clear description
      </button>
      <button data-cy="remove-author" onClick={() => updateField('authors')(details.authors.slice(1))}>
        remove first author
      </button>
      <button
        data-cy="readd-author"
        onClick={() => {
          // MultiSelect re-adds an author as a fresh `{ id, name }` without the API's extra keys
          const first = metadata.authors[0]
          updateField('authors')([{ id: first.id, name: first.name }, ...details.authors])
        }}
      >
        re-add first author
      </button>
      <button data-cy="swap-authors" onClick={() => updateField('authors')([...details.authors].reverse())}>
        swap authors
      </button>
      <button data-cy="edit-sequence" onClick={() => updateField('series')(details.series.map((s, i) => (i === 0 ? { ...s, sequence: '2' } : s)))}>
        edit sequence
      </button>
      <button
        data-cy="restore-sequence"
        onClick={() =>
          // TwoStageMultiSelect writes '' for a cleared modifier; the API may have sent null/undefined
          updateField('series')(details.series.map((s, i) => (i === 0 ? { id: s.id, name: s.name, sequence: '' } : s)))
        }
      >
        restore sequence
      </button>
      <button data-cy="add-tag" onClick={() => updateTags([...tags, 'new-tag'])}>
        add tag
      </button>
      <button data-cy="restore-tags" onClick={() => updateTags([...tags])}>
        restore tags
      </button>
    </div>
  )
}

const baseMetadata = (): ProbeDetails => ({
  title: 'Title',
  description: null,
  authors: [
    { id: 'au_1', name: 'First Author', addedAt: 1, updatedAt: 2 },
    { id: 'au_2', name: 'Second Author' }
  ],
  series: [{ id: 'se_1', name: 'Series', sequence: undefined }],
  genres: ['Fantasy']
})

describe('useDetailsEdit', () => {
  it('starts clean', () => {
    cy.mount(<DetailsEditProbe metadata={baseMetadata()} tags={['a']} />)
    cy.get('[data-cy="has-changes"]').should('have.text', 'false')
    cy.get('[data-cy="dirty-fields"]').should('have.text', '')
    cy.get('[data-cy="tags-dirty"]').should('have.text', 'false')
  })

  it('marks a text field dirty and clean again when restored', () => {
    cy.mount(<DetailsEditProbe metadata={baseMetadata()} />)
    cy.get('[data-cy="set-title"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'true')
    cy.get('[data-cy="dirty-fields"]').should('have.text', 'title')
    cy.get('[data-cy="restore-title"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'false')
    cy.get('[data-cy="dirty-fields"]').should('have.text', '')
  })

  it('treats a cleared null description as unchanged', () => {
    cy.mount(<DetailsEditProbe metadata={baseMetadata()} />)
    cy.get('[data-cy="clear-description"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'false')
  })

  it('treats a removed then re-added author as unchanged even without the extra API keys', () => {
    cy.mount(<DetailsEditProbe metadata={baseMetadata()} />)
    cy.get('[data-cy="remove-author"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'true')
    cy.get('[data-cy="dirty-fields"]').should('have.text', 'authors')
    cy.get('[data-cy="readd-author"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'false')
    cy.get('[data-cy="dirty-fields"]').should('have.text', '')
  })

  it('treats a changed author order as a change', () => {
    cy.mount(<DetailsEditProbe metadata={baseMetadata()} />)
    cy.get('[data-cy="swap-authors"]').click()
    cy.get('[data-cy="dirty-fields"]').should('have.text', 'authors')
    cy.get('[data-cy="swap-authors"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'false')
  })

  it('treats an empty series sequence the same as a missing one', () => {
    cy.mount(<DetailsEditProbe metadata={baseMetadata()} />)
    cy.get('[data-cy="restore-sequence"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'false')
    cy.get('[data-cy="edit-sequence"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'true')
    cy.get('[data-cy="dirty-fields"]').should('have.text', 'series')
    cy.get('[data-cy="restore-sequence"]').click()
    cy.get('[data-cy="has-changes"]').should('have.text', 'false')
  })

  it('reports tag changes separately from metadata fields', () => {
    cy.mount(<DetailsEditProbe metadata={baseMetadata()} tags={['a']} />)
    cy.get('[data-cy="add-tag"]').click()
    cy.get('[data-cy="tags-dirty"]').should('have.text', 'true')
    cy.get('[data-cy="dirty-fields"]').should('have.text', '')
    cy.get('[data-cy="has-changes"]').should('have.text', 'true')
    cy.get('[data-cy="restore-tags"]').click()
    cy.get('[data-cy="tags-dirty"]').should('have.text', 'false')
    cy.get('[data-cy="has-changes"]').should('have.text', 'false')
  })
})
