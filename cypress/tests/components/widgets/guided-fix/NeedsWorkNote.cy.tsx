import NeedsWorkNote from '@/components/widgets/guided-fix/NeedsWorkNote'
import type { NeedsWorkItem } from '@/types/api'

const redRising: NeedsWorkItem = {
  libraryItemId: 'li_1',
  title: 'Red Rising',
  issues: ['seek-index', 'unmatched'],
  next: 'repair',
  duration: { stored: 58127.6, drift: 133.7, unmeasured: 0 },
  match: { asin: null, confidence: null, reason: null },
  chapters: { count: 4, kind: 'scanner', end: 58127.6, audible: null }
}

describe('<NeedsWorkNote />', () => {
  it('says the book needs processing and lists why on focus', () => {
    cy.mount(<NeedsWorkNote item={redRising} />)
    cy.contains('button', 'Needs processing').focus()
    cy.contains('li', 'The MP3 files report the wrong length (off by 2 min 14 s).').should('exist')
    cy.contains('li', "It isn't matched to Audible yet.").should('exist')
  })
})
