import { shouldLeaveIssuesPage } from '@/lib/libraryIssues'

describe('shouldLeaveIssuesPage', () => {
  it('stays while there are missing/invalid items or possible duplicates', () => {
    expect(shouldLeaveIssuesPage({ numIssues: 2 }, false)).to.equal(false)
    expect(shouldLeaveIssuesPage({ numIssues: 0, numDuplicateGroups: 1 }, false)).to.equal(false)
  })

  it('leaves when there is nothing to list, as on a stock server', () => {
    expect(shouldLeaveIssuesPage({ numIssues: 0 }, false)).to.equal(true)
    expect(shouldLeaveIssuesPage({}, false)).to.equal(true)
    expect(shouldLeaveIssuesPage({ numIssues: 0, numDuplicateGroups: 0 }, false)).to.equal(true)
  })

  it('stays after the last duplicate group shown on this visit was dismissed', () => {
    expect(shouldLeaveIssuesPage({ numIssues: 0, numDuplicateGroups: 0 }, true)).to.equal(false)
  })
})
