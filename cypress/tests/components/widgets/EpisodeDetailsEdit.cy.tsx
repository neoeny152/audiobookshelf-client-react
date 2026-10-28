import EpisodeDetailsEdit from '@/components/widgets/EpisodeDetailsEdit'
import type { PodcastEpisode } from '@/types/api'

const episode: PodcastEpisode = {
  libraryItemId: 'li_podcast',
  podcastId: 'pod_1',
  id: 'ep_1',
  title: 'Episode Title',
  subtitle: 'Episode Subtitle',
  episodeType: 'full',
  chapters: [],
  addedAt: 0,
  updatedAt: 0
}

function mountEpisode() {
  const onChange = cy.spy().as('onChange')
  cy.mount(<EpisodeDetailsEdit episode={episode} onChange={onChange} />)
}

function lastHasChanges() {
  return cy.get('@onChange').its('lastCall.args.0.hasChanges')
}

describe('EpisodeDetailsEdit', () => {
  it('highlights the subtitle only while it differs from the saved value', () => {
    mountEpisode()
    cy.get('[cy-id="textarea-input-textarea"]').as('subtitle').should('not.have.class', 'text-info')

    cy.get('@subtitle').type('!')
    cy.get('@subtitle').should('have.class', 'text-info')
    lastHasChanges().should('equal', true)

    cy.get('@subtitle').type('{backspace}')
    cy.get('@subtitle').should('not.have.class', 'text-info')
    lastHasChanges().should('equal', false)
  })

  it('highlights the episode type only while it differs from the saved value', () => {
    mountEpisode()
    cy.get('button[role="combobox"]').as('episodeType').should('not.have.class', 'text-info')

    cy.get('@episodeType').click()
    cy.get('[role="option"]').contains('Bonus').click()
    cy.get('@episodeType').should('have.class', 'text-info')
    lastHasChanges().should('equal', true)

    cy.get('@episodeType').click()
    cy.get('[role="option"]').contains('Full').click()
    cy.get('@episodeType').should('not.have.class', 'text-info')
    lastHasChanges().should('equal', false)
  })
})
