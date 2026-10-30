import DuplicateGroupsPanel, { type DuplicateGroupsPanelProps } from '@/components/widgets/duplicates/DuplicateGroupsPanel'
import type { DuplicateGroup, DuplicateGroupItem } from '@/types/api'

const LIBRARY_ID = 'lib_1'

function item(id: string, overrides: Partial<DuplicateGroupItem> = {}): DuplicateGroupItem {
  return {
    id,
    title: 'The Hobbit',
    author: 'J.R.R. Tolkien',
    path: `/audiobooks/${id}/The Hobbit`,
    relPath: `${id}/The Hobbit`,
    size: 512_000_000,
    duration: 36000,
    numAudioFiles: 1,
    hasEbook: false,
    asin: null,
    isbn: null,
    addedAt: new Date(2026, 0, 15).valueOf(),
    isMissing: false,
    isInvalid: false,
    ...overrides
  }
}

const hobbit: DuplicateGroup = {
  id: 'g_hobbit',
  matchTypes: ['title'],
  dismissed: false,
  items: [item('li_a'), item('li_b', { relPath: 'Incoming/Hobbit (Unabridged)', numAudioFiles: 19, duration: 36150, size: 0 })]
}
const dune: DuplicateGroup = {
  id: 'g_dune',
  matchTypes: ['asin', 'title'],
  dismissed: true,
  items: [item('li_c', { title: 'Dune', author: 'Frank Herbert' }), item('li_d', { title: 'Dune', author: 'Frank Herbert', hasEbook: true })]
}
const podcast: DuplicateGroup = {
  id: 'g_pod',
  matchTypes: ['feed'],
  dismissed: false,
  items: [
    item('li_p1', { title: 'Show', author: 'Host', duration: 0, numAudioFiles: 0, numEpisodes: 1 }),
    item('li_p2', { title: 'Show', author: 'Host', duration: 0, numAudioFiles: 0, numEpisodes: 12 })
  ]
}

function mountPanel(overrides: Partial<DuplicateGroupsPanelProps> = {}) {
  const props: DuplicateGroupsPanelProps = {
    libraryId: LIBRARY_ID,
    groups: [hobbit],
    loading: false,
    checking: false,
    showDismissed: false,
    busyGroupIds: new Set(),
    dateFormat: 'MM/dd/yyyy',
    lastCheckedAt: null,
    error: null,
    onCheck: cy.stub().as('onCheck'),
    onShowDismissedChange: cy.stub().as('onShowDismissedChange'),
    onSetDismissed: cy.stub().as('onSetDismissed'),
    ...overrides
  }
  cy.mount(<DuplicateGroupsPanel {...props} />)
}

describe('<DuplicateGroupsPanel />', () => {
  it('lists each group with a link, path and details for every item', () => {
    mountPanel()
    cy.get('[cy-id="duplicates-count"]').should('have.text', '1')
    cy.get('[cy-id="duplicate-group"]').should('have.length', 1)
    cy.get('[cy-id="duplicate-group-match"]').should('contain.text', 'Same title, author and length')
    cy.get('[cy-id="duplicate-item"]').should('have.length', 2)
    cy.get('[cy-id="duplicate-item-link"]').eq(0).should('have.attr', 'href', `/library/${LIBRARY_ID}/item/li_a`).and('have.text', 'The Hobbit')
    cy.get('[cy-id="duplicate-item-link"]').eq(1).should('have.attr', 'href', `/library/${LIBRARY_ID}/item/li_b`)
    cy.get('[cy-id="duplicate-item-path"]').eq(1).should('have.text', '/audiobooks/li_b/The Hobbit')
    cy.get('[cy-id="duplicate-item-details"]').eq(0).should('have.text', '10:00:00 · 1 audio file · 512 MB · Added 01/15/2026')
    // No size when the server reports none
    cy.get('[cy-id="duplicate-item-details"]').eq(1).should('have.text', '10:02:30 · 19 audio files · Added 01/15/2026')
  })

  it('shows every match type, episode counts for podcasts and marks dismissed groups', () => {
    mountPanel({ groups: [dune, podcast], showDismissed: true })
    cy.get('[cy-id="duplicates-count"]').should('have.text', '1')
    cy.get('[cy-id="duplicate-group"]')
      .eq(0)
      .should('contain.text', 'Same ASIN')
      .and('contain.text', 'Same title, author and length')
      .and('contain.text', 'Marked not a duplicate')
    cy.get('[cy-id="duplicate-group"]').eq(0).find('[cy-id="duplicate-item-details"]').eq(1).should('contain.text', 'Ebook')
    cy.get('[cy-id="duplicate-group"]').eq(1).should('contain.text', 'Same podcast feed')
    cy.get('[cy-id="duplicate-group"]').eq(1).find('[cy-id="duplicate-item-details"]').eq(1).should('have.text', '12 episodes · 512 MB · Added 01/15/2026')
  })

  it('marks a group as not a duplicate, and restores a dismissed one', () => {
    mountPanel({ groups: [hobbit, dune], showDismissed: true })
    cy.get('[cy-id="duplicate-group"]').eq(0).contains('button', 'Not a duplicate').click()
    cy.get('@onSetDismissed').should('have.been.calledOnceWith', 'g_hobbit', true)
    cy.get('[cy-id="duplicate-group"]').eq(1).contains('button', 'Flag again').click()
    cy.get('@onSetDismissed').should('have.been.calledWith', 'g_dune', false)
  })

  it('offers no delete or merge action', () => {
    mountPanel({ groups: [hobbit, dune], showDismissed: true })
    cy.get('[cy-id="duplicates-panel"] button').each(($button) => {
      expect($button.text()).to.not.match(/delete|remove|merge/i)
    })
  })

  it('checks again and toggles dismissed groups', () => {
    mountPanel()
    cy.contains('button', 'Check again').click()
    cy.get('@onCheck').should('have.been.calledOnce')
    cy.contains('Show groups marked not a duplicate').should('be.visible')
    cy.get('[cy-id="duplicates-panel"] input[type="checkbox"]').click()
    cy.get('@onShowDismissedChange').should('have.been.calledOnceWith', true)
  })

  it('collapses the list', () => {
    mountPanel()
    cy.get('[cy-id="duplicates-toggle"]').should('have.attr', 'aria-expanded', 'true').click()
    cy.get('[cy-id="duplicate-group"]').should('not.exist')
    cy.get('[cy-id="duplicates-toggle"]').should('have.attr', 'aria-expanded', 'false')
  })

  it('shows an empty message and errors', () => {
    mountPanel({ groups: [] })
    cy.get('[cy-id="duplicates-empty"]').should('have.text', 'No possible duplicates found.')
    mountPanel({ groups: [], error: 'Forbidden' })
    cy.get('[cy-id="duplicates-error"]').should('have.text', 'Forbidden')
    cy.get('[cy-id="duplicates-empty"]').should('not.exist')
  })

  it('shows when the library was last checked', () => {
    mountPanel({ lastCheckedAt: new Date(2026, 9, 30, 14, 5).valueOf() })
    cy.get('[cy-id="duplicates-panel"]').should('contain.text', 'Last checked 10/30/2026 14:05.')
  })
})
