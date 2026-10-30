import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { formatDrift, getGuideSteps, toItemHealth, toNeedsWorkItems } from '@/lib/itemHealth'

function DriftProbe({ seconds }: { seconds: number }) {
  const t = useTypeSafeTranslations()
  return <span data-cy="drift">{formatDrift(seconds, t)}</span>
}

// Red Rising before the repair: four header-less MP3s, no ASIN, chapters from the files
const redRising = {
  libraryItemId: 'c1c77a16',
  duration: { stored: 59580.2, drift: 90.3, unmeasured: 0 },
  seekIndex: { needsRepairCount: 4, maxDrift: 41.2, processing: false },
  match: { asin: null, confidence: 85, reason: 'low-confidence' },
  chapters: { count: 4, kind: 'scanner', end: 59580.2, audible: { count: 50, runtimeSec: 59672 } },
  issues: ['seek-index', 'low-confidence', 'chapters-from-files', 'chapters-length', 'chapters-count', 'chapters-unverified', 'new-code'],
  next: 'repair',
  autoFix: { available: true, autoRepair: false, minConfidence: 90 }
}

describe('toItemHealth', () => {
  it('reads the health response and drops unknown issue codes', () => {
    const health = toItemHealth(redRising)
    expect(health?.issues).to.deep.equal(['seek-index', 'low-confidence', 'chapters-from-files', 'chapters-length', 'chapters-count', 'chapters-unverified'])
    expect(health?.duration.drift).to.equal(90.3)
    expect(health?.chapters.audible).to.deep.equal({ count: 50, runtimeSec: 59672 })
    expect(health?.next).to.equal('repair')
  })

  it('fills missing parts and rejects anything that is not a response', () => {
    expect(toItemHealth({ libraryItemId: 'x' })).to.deep.include({
      issues: [],
      next: null,
      autoFix: { available: false, autoRepair: false, minConfidence: 90 }
    })
    expect(toItemHealth(null)).to.equal(null)
    expect(toItemHealth({ issues: [] })).to.equal(null)
  })
})

describe('toNeedsWorkItems', () => {
  it('reads the books with their title and drops entries that are not one', () => {
    const items = toNeedsWorkItems({ items: [{ ...redRising, title: 'Red Rising' }, { title: 'No id' }] })
    expect(items).to.have.length(1)
    expect(items[0]).to.deep.include({ libraryItemId: 'c1c77a16', title: 'Red Rising', next: 'repair' })
    expect(items[0].match).to.deep.equal({ asin: null, confidence: 85, reason: 'low-confidence' })
    expect(items[0]).not.to.have.any.keys('seekIndex', 'autoFix')
    expect(toNeedsWorkItems(null)).to.deep.equal([])
  })
})

describe('getGuideSteps', () => {
  it('starts with the match and the repair only when the book needs them', () => {
    expect(getGuideSteps({ issues: ['seek-index', 'unmatched', 'chapters-from-files'] })).to.deep.equal(['match', 'repair', 'lookup', 'snap', 'save'])
    expect(getGuideSteps({ issues: ['low-confidence'] })).to.deep.equal(['match', 'lookup', 'snap', 'save'])
    expect(getGuideSteps({ issues: ['chapters-count'] })).to.deep.equal(['lookup', 'snap', 'save'])
    expect(getGuideSteps({ issues: ['chapters-count'] }, { epub: true })).to.deep.equal(['lookup', 'snap', 'save', 'epub'])
  })
})

describe('formatDrift', () => {
  it('shows seconds under a minute and minutes from there, without the sign', () => {
    cy.mount(<DriftProbe seconds={90.3} />)
    cy.get('[data-cy="drift"]').should('have.text', '1 min 30 s')
    cy.mount(<DriftProbe seconds={-4.25} />)
    cy.get('[data-cy="drift"]').should('have.text', '4.3 s')
    cy.mount(<DriftProbe seconds={119.7} />)
    cy.get('[data-cy="drift"]').should('have.text', '2 min 0 s')
  })
})
