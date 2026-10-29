import SnapToAudioPanel, { type SnapToAudioPanelProps } from '@/components/widgets/chapters-edit/SnapToAudioPanel'
import type { SnapTitlePick } from '@/lib/chapters/chapterEditorUtils'
import { SNAP_DEFAULT_OPTIONS, type SnapRow, type SnapSession, type SnapSpeechBatchResult } from '@/lib/chapters/chapterSnap'
import type { SnapChapterProposal, SnapChapterSpeech, SnapChaptersResponse } from '@/types/api'

const mediaDuration = 1000
const starts = [0, 100, 200, 300]
const snapshot = starts.map((start, i) => ({ clientKey: `ch-${i}`, start, title: `Chapter ${i + 1}` }))

const pause = (start: number, end: number) => ({ start, end, duration: end - start, startClipped: false, endClipped: false, crossesFileBoundary: false })

function proposal(partial: Partial<SnapChapterProposal> & Pick<SnapChapterProposal, 'index'>): SnapChapterProposal {
  const originalStart = partial.originalStart ?? starts[partial.index]
  const proposedStart = partial.proposedStart ?? originalStart
  const delta = Math.round((proposedStart - originalStart) * 1000) / 1000
  return {
    id: partial.index,
    title: `Chapter ${partial.index + 1}`,
    delta,
    changed: delta !== 0,
    pause: null,
    reason: 'no-pause-in-window',
    confidence: 'none',
    trackIndex: 0,
    speech: null,
    ...partial,
    originalStart,
    proposedStart
  }
}

function makeResponse(chapters: SnapChapterProposal[], complete = true, duration = mediaDuration): SnapChaptersResponse {
  return {
    libraryItemId: 'li_1',
    duration,
    complete,
    options: { ...SNAP_DEFAULT_OPTIONS, leadSec: 0.25, snapToFileStart: false },
    stats: { segments: 3, ffmpegCalls: 3, failedSegments: 0, analysedSec: 180, pausesFound: 12, elapsedMs: 6000, moved: 2, unchanged: 1, skipped: 0 },
    chapters,
    proposedChapters: chapters.map((c, i) => ({ id: i, title: c.title, start: c.proposedStart, end: chapters[i + 1]?.proposedStart ?? duration })),
    warnings: []
  }
}

function makeSession(chapters: SnapChapterProposal[], complete = true): SnapSession {
  return { snapshot, response: makeResponse(chapters, complete), options: { ...SNAP_DEFAULT_OPTIONS } }
}

const completeSession = makeSession([
  proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }),
  proposal({ index: 1, proposedStart: 96.75, reason: 'heading-lookback', confidence: 'high', pause: pause(95, 97) }),
  proposal({ index: 2, proposedStart: 220.3, reason: 'nearest-longest-pause', confidence: 'low', pause: pause(219, 220.55) }),
  proposal({ index: 3, reason: 'inside-pause', confidence: 'high', pause: pause(299, 301) })
])

function mountPanel(overrides: Partial<SnapToAudioPanelProps> = {}) {
  const props: SnapToAudioPanelProps = {
    chapterCount: starts.length,
    ...overrides,
    onSnap: overrides.onSnap ?? cy.stub().as('onSnap').resolves(completeSession),
    onRetry: overrides.onRetry ?? cy.stub().as('onRetry').resolves(null),
    onApply: overrides.onApply ?? cy.stub().as('onApply').returns(1)
  }
  cy.mount(<SnapToAudioPanel {...props} />)
}

const confidenceDot = (row: number) => cy.get('[cy-id="snap-row"]').eq(row).find('[cy-id="snap-confidence"] [role="img"]')

describe('<SnapToAudioPanel /> settings', () => {
  it('keeps the advanced settings collapsed with the server defaults', () => {
    mountPanel()
    cy.get('[cy-id="snap-settings"]').should('not.exist')
    cy.get('button[aria-label="Snap settings"]').should('have.attr', 'aria-expanded', 'false').click()
    cy.get('[cy-id="snap-settings"] input').should('have.length', 4)
    cy.get('[cy-id="snap-settings"] input').eq(0).should('have.value', '25')
    cy.get('[cy-id="snap-settings"] input').eq(1).should('have.value', '0.7')
    cy.get('[cy-id="snap-settings"] input').eq(2).should('have.value', '-38')
    cy.get('[cy-id="snap-settings"] input').eq(3).should('have.value', '3')
  })

  it('sends the edited settings, clamped to the server ranges', () => {
    mountPanel()
    cy.get('button[aria-label="Snap settings"]').click()
    cy.get('[cy-id="snap-settings"] input').eq(0).clear().type('999')
    cy.get('[cy-id="snap-settings"] input').eq(3).clear().type('1.5')
    cy.contains('button', 'Snap to audio').click()
    cy.get('@onSnap').should('have.been.calledOnceWith', { windowSec: 60, minSilenceSec: 0.7, noiseDb: -38, headingLookbackSec: 1.5 })
  })

  it('is disabled with a single chapter', () => {
    mountPanel({ chapterCount: 1 })
    cy.contains('button', 'Snap to audio').should('be.disabled')
  })
})

describe('<SnapToAudioPanel /> running', () => {
  it('shows progress and disables the controls until the snap finishes', () => {
    let resolveSnap: (session: SnapSession | null) => void = () => {}
    const onSnap = cy
      .stub()
      .as('onSnap')
      .callsFake(
        () =>
          new Promise<SnapSession | null>((resolve) => {
            resolveSnap = resolve
          })
      )
    mountPanel({ onSnap })
    cy.get('button[aria-label="Snap settings"]').click()
    cy.contains('button', 'Snap to audio').click()
    cy.get('[role="status"]').should('contain.text', 'Analysing the audio')
    cy.get('[cy-id="snap-to-audio-panel"]').should('have.attr', 'aria-busy', 'true')
    cy.get('[cy-id="snap-to-audio-panel"] button').first().should('be.disabled')
    cy.get('[cy-id="snap-settings"] input').first().should('be.disabled')
    cy.then(() => resolveSnap(null))
    cy.get('[cy-id="snap-to-audio-panel"]').should('not.have.attr', 'aria-busy')
    cy.get('[cy-id="snap-settings"] input').first().should('not.be.disabled')
    cy.get('[cy-id="snap-proposal"]').should('not.exist')
  })
})

describe('<SnapToAudioPanel /> proposal', () => {
  beforeEach(() => {
    mountPanel()
    cy.contains('button', 'Snap to audio').click()
  })

  it('lists the chapters that would move, one compact line each', () => {
    cy.get('[cy-id="snap-row"]').should('have.length', 2)
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-row-start"]').should('contain.text', '0:01:40.0').and('contain.text', '0:01:36.7')
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-row-delta"]').should('have.text', '-3.3 s')
    cy.get('[cy-id="snap-row"]').eq(1).find('[cy-id="snap-row-delta"]').should('have.text', '+20.3 s')
  })

  it('shows reason and confidence as a coloured dot with a label', () => {
    confidenceDot(0).should('have.attr', 'aria-label', 'High confidence: Moved before spoken heading').and('have.attr', 'data-confidence', 'high')
    confidenceDot(1).should('have.attr', 'aria-label', 'Low confidence: Moved to nearest pause').and('have.class', 'bg-warning')
    // the words are not spelled out in the row itself
    cy.get('[cy-id="snap-row"]').eq(0).invoke('text').should('not.contain', 'Moved before spoken heading')
  })

  it('says "No confidence" for a move without one', () => {
    mountPanel({
      onSnap: cy.stub().resolves(makeSession([proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }), proposal({ index: 1, proposedStart: 98, reason: 'nearest-longest-pause' })]))
    })
    cy.contains('button', 'Snap to audio').click()
    confidenceDot(0).should('have.attr', 'aria-label', 'No confidence: Moved to nearest pause')
  })

  it('sums up the proposal on one line and flags the unsure move', () => {
    cy.get('[cy-id="snap-summary"]').should('have.text', '2 would move · 1 flagged')
    cy.get('[cy-id="snap-row"]').eq(1).should('have.attr', 'data-flag', 'low-confidence').and('have.class', 'bg-warning/10')
    cy.get('[cy-id="snap-row"]').eq(0).should('not.have.attr', 'data-flag')
  })

  it('filters to the flagged rows', () => {
    cy.get('[cy-id="snap-only-flagged"] input[type="checkbox"]').click()
    cy.get('[cy-id="snap-row"]').should('have.length', 1).and('have.attr', 'data-index', '2')
    cy.get('[cy-id="snap-only-flagged"] input[type="checkbox"]').click()
    cy.get('[cy-id="snap-row"]').should('have.length', 2)
  })

  it('pre-checks changed rows except low-confidence ones', () => {
    cy.get('[cy-id="snap-row"]').eq(0).find('input[type="checkbox"]').should('be.checked')
    cy.get('[cy-id="snap-row"]').eq(1).find('input[type="checkbox"]').should('not.be.checked')
    cy.contains('button', 'Apply 1 change').should('not.be.disabled')
  })

  it('reveals unchanged chapters on request', () => {
    cy.contains('label', 'Show unchanged').siblings('input[type="checkbox"]').click()
    cy.get('[cy-id="snap-row"]').should('have.length', 4)
    cy.get('[cy-id="snap-row"]').eq(3).find('[cy-id="snap-row-delta"]').should('have.text', '')
    confidenceDot(3).should('have.attr', 'aria-label', 'High confidence: Already in a pause')
  })

  it('expands a row for its details, keyboard reachable', () => {
    cy.get('[cy-id="snap-row-details"]').should('not.exist')
    cy.get('[cy-id="snap-row"]').eq(0).find('button[aria-label="Details for Chapter 2"]').should('have.attr', 'aria-expanded', 'false').click()
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-row-toggle"]').should('have.attr', 'aria-expanded', 'true').invoke('attr', 'aria-controls').as('detailsId')
    cy.get('@detailsId').then((id) => {
      cy.get(`[id="${id}"]`).should('contain.text', 'High confidence: Moved before spoken heading')
    })
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-row-toggle"]').click()
    cy.get('[cy-id="snap-row-details"]').should('not.exist')
  })

  it('applies only the checked rows and closes the proposal', () => {
    cy.contains('button', 'Apply 1 change').click()
    cy.get('@onApply').should('have.been.calledOnce')
    cy.get('@onApply').then((stub) => {
      const appliedRows = (stub as unknown as sinon.SinonStub).firstCall.args[0] as SnapRow[]
      expect(appliedRows.map((row) => [row.clientKey, row.originalStart, row.newStart])).to.deep.equal([['ch-1', 100, 96.75]])
    })
    cy.get('[cy-id="snap-proposal"]').should('not.exist')
  })

  it('applies a low-confidence row once it is checked', () => {
    cy.get('[cy-id="snap-row"]').eq(1).find('input[type="checkbox"]').click()
    cy.contains('button', 'Apply 2 changes').click()
    cy.get('@onApply').then((stub) => {
      const appliedRows = (stub as unknown as sinon.SinonStub).firstCall.args[0] as SnapRow[]
      expect(appliedRows.map((row) => row.newStart)).to.deep.equal([96.75, 220.3])
    })
  })
})

describe('<SnapToAudioPanel /> layout', () => {
  it('keeps a long title on one line, truncated, with the full title on hover', () => {
    const longTitle = 'Chapter Twelve: In Which Our Heroes Finally Reach the Mountain After a Very Long and Winding Journey Through the Marshes'
    const session = makeSession([
      proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }),
      proposal({ index: 1, proposedStart: 281.6 - 1.8, originalStart: 281.6, reason: 'heading-lookback', confidence: 'high' }),
      proposal({ index: 2, reason: 'inside-pause', confidence: 'high' }),
      proposal({ index: 3, reason: 'inside-pause', confidence: 'high' })
    ])
    session.snapshot = session.snapshot.map((chapter, i) => (i === 1 ? { ...chapter, start: 281.6, title: longTitle } : chapter))
    cy.viewport(700, 600)
    mountPanel({ onSnap: cy.stub().resolves(session) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-row"]').should('have.length', 1)
    cy.get('[cy-id="snap-row-title"]').should('have.attr', 'title', longTitle)
    cy.get('[cy-id="snap-row-title"]').should(($el) => {
      expect($el[0].scrollWidth).to.be.greaterThan($el[0].clientWidth)
    })
    cy.get('[cy-id="snap-row"]').should(($row) => {
      expect($row[0].getBoundingClientRect().height).to.be.lessThan(40)
    })
    // "→" for the eye, "to" for screen readers
    cy.get('[cy-id="snap-row-start"]').should('have.text', '0:04:41.6→ to 0:04:39.8')
    cy.get('[cy-id="snap-row-delta"]').should('have.text', '-1.8 s')
  })
})

describe('<SnapToAudioPanel /> sub-second proposals', () => {
  it('shows the exact proposal inside a short pause, checked', () => {
    const session = makeSession([
      proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }),
      proposal({ index: 1, proposedStart: 98.65, reason: 'nearest-longest-pause', confidence: 'medium', pause: pause(98.2, 98.9) }),
      proposal({ index: 2, reason: 'inside-pause', confidence: 'high', pause: pause(199, 201) }),
      proposal({ index: 3, reason: 'inside-pause', confidence: 'high', pause: pause(299, 301) })
    ])
    mountPanel({ onSnap: cy.stub().as('onSnap').resolves(session) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-row"]').should('have.length', 1)
    cy.get('[cy-id="snap-row"]').eq(0).should('contain.text', '0:01:38.6').and('contain.text', '-1.4 s')
    cy.get('[cy-id="snap-row"]').eq(0).find('input[type="checkbox"]').should('be.checked')
    cy.contains('button', 'Apply 1 change').click()
    cy.get('@onApply').then((stub) => {
      const appliedRows = (stub as unknown as sinon.SinonStub).firstCall.args[0] as SnapRow[]
      expect(appliedRows.map((row) => row.newStart)).to.deep.equal([98.65])
    })
  })
})

describe('<SnapToAudioPanel /> preview', () => {
  it('previews the proposed start with the editor player', () => {
    const playChapter = cy.stub().as('playChapter')
    const destroyAudioEl = cy.stub().as('destroyAudioEl')
    mountPanel({ preview: { selectedChapterId: null, isPlayingChapter: false, isLoadingChapter: false, playChapter, destroyAudioEl } })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-row"]').eq(0).find('button[aria-label="Play from proposed start"]').click()
    cy.get('@playChapter').should('have.been.calledOnceWith', 'snap-1', 96.75)
  })

  const playingSnapPreview = () => ({
    selectedChapterId: 'snap-1',
    isPlayingChapter: true,
    isLoadingChapter: false,
    playChapter: cy.stub().as('playChapter'),
    destroyAudioEl: cy.stub().as('destroyAudioEl')
  })

  it('stops a playing proposal preview when the proposal is applied', () => {
    mountPanel({ preview: playingSnapPreview() })
    cy.contains('button', 'Snap to audio').click()
    cy.get('@destroyAudioEl').should('have.been.calledOnce')
    cy.contains('button', 'Apply 1 change').click()
    cy.get('@destroyAudioEl').should('have.been.calledTwice')
  })

  it('stops a playing proposal preview when the proposal is closed', () => {
    mountPanel({ preview: playingSnapPreview() })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-proposal"]').contains('button', 'Close').click()
    cy.get('@destroyAudioEl').should('have.been.calledTwice')
    cy.get('[cy-id="snap-proposal"]').should('not.exist')
  })

  it('leaves a chapter-table preview playing', () => {
    const destroyAudioEl = cy.stub().as('destroyAudioEl')
    mountPanel({ preview: { selectedChapterId: 3, isPlayingChapter: true, isLoadingChapter: false, playChapter: cy.stub(), destroyAudioEl } })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-proposal"]').contains('button', 'Close').click()
    cy.get('@destroyAudioEl').should('not.have.been.called')
  })
})

describe('<SnapToAudioPanel /> incomplete result', () => {
  it('says so and retries the remaining chapters', () => {
    const partial = makeSession(
      [
        proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }),
        proposal({ index: 1, proposedStart: 96.75, reason: 'heading-lookback', confidence: 'high', pause: pause(95, 97) }),
        proposal({ index: 2, reason: 'not-analysed' }),
        proposal({ index: 3, reason: 'not-analysed' })
      ],
      false
    )
    const retried = makeSession([
      proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }),
      proposal({ index: 1, proposedStart: 96.75, reason: 'heading-lookback', confidence: 'high', pause: pause(95, 97) }),
      proposal({ index: 2, proposedStart: 203.5, reason: 'nearest-longest-pause', confidence: 'medium', pause: pause(202, 203.75) }),
      proposal({ index: 3, reason: 'inside-pause', confidence: 'high', pause: pause(299, 301) })
    ])

    mountPanel({ onSnap: cy.stub().as('onSnap').resolves(partial), onRetry: cy.stub().as('onRetry').resolves(retried) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-incomplete"]').should('contain.text', '2 chapters were not analysed')
    cy.get('[cy-id="snap-row"]').should('have.length', 1)

    cy.contains('button', 'Retry remaining').click()
    cy.get('@onRetry').should('have.been.calledOnceWith', partial)
    cy.get('[cy-id="snap-incomplete"]').should('not.exist')
    cy.get('[cy-id="snap-row"]').should('have.length', 2)
    cy.contains('button', 'Apply 2 changes').should('exist')
  })
})

const heardSpeech = (partial: Partial<SnapChapterSpeech> = {}): SnapChapterSpeech => ({
  before: 'and that was the end of it',
  after: 'chapter two the long road home',
  heading: false,
  late: false,
  early: false,
  ...partial
})

describe('<SnapToAudioPanel /> speech check', () => {
  function verifiedSession(warnings: string[] = []): SnapSession {
    const session = makeSession([
      proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }),
      proposal({ index: 1, proposedStart: 96.75, reason: 'heading-lookback', confidence: 'high', pause: pause(95, 97), speech: heardSpeech({ heading: true }) }),
      proposal({
        index: 2,
        proposedStart: 205,
        reason: 'nearest-longest-pause',
        confidence: 'low',
        pause: pause(204, 205.25),
        speech: heardSpeech({ late: true, before: 'the end. chapter three', after: 'she walked in' })
      }),
      proposal({
        index: 3,
        proposedStart: 295,
        reason: 'nearest-longest-pause',
        confidence: 'medium',
        pause: pause(294, 295.3),
        speech: heardSpeech({ early: true })
      })
    ])
    session.options = { ...session.options, verify: true }
    session.response.options = { ...session.response.options, verify: true }
    session.response.warnings = ['Time limit reached: developer note', ...warnings]
    return session
  }

  it('hides the toggle unless the server advertises the speech check', () => {
    mountPanel()
    cy.get('[cy-id="snap-check-speech"]').should('not.exist')
    cy.contains('button', 'Snap to audio').click()
    cy.get('@onSnap').should('have.been.calledOnceWith', SNAP_DEFAULT_OPTIONS)
    cy.get('[cy-id="snap-speech"]').should('not.exist')
  })

  it('is off by default and sends verify only when switched on', () => {
    mountPanel({ speechCheckAvailable: true, onSnap: cy.stub().as('onSnap').resolves(null) })
    cy.get('[cy-id="snap-check-speech"]').should('contain.text', 'Check speech')
    cy.get('[cy-id="snap-check-speech"] input[type="checkbox"]').should('not.be.checked')
    cy.contains('button', 'Snap to audio').click()
    cy.get('@onSnap').its('firstCall.args.0').should('deep.equal', SNAP_DEFAULT_OPTIONS)

    cy.get('[cy-id="snap-check-speech"] input[type="checkbox"]').click()
    cy.contains('button', 'Snap to audio').click()
    cy.get('@onSnap')
      .its('secondCall.args.0')
      .should('deep.equal', { ...SNAP_DEFAULT_OPTIONS, verify: true })
  })

  it('says the speech check is slower while it runs', () => {
    let resolveSnap: (session: SnapSession | null) => void = () => {}
    const onSnap = cy.stub().callsFake(
      () =>
        new Promise<SnapSession | null>((resolve) => {
          resolveSnap = resolve
        })
    )
    mountPanel({ speechCheckAvailable: true, onSnap })
    cy.get('[cy-id="snap-check-speech"] input[type="checkbox"]').click()
    cy.contains('button', 'Snap to audio').click()
    cy.get('[role="status"]').should('contain.text', 'checking speech')
    cy.get('[cy-id="snap-check-speech"] input[type="checkbox"]').should('be.disabled')
    cy.then(() => resolveSnap(null))
  })

  it('shows a speech icon per row and flags late and early rows', () => {
    mountPanel({ speechCheckAvailable: true, onSnap: cy.stub().resolves(verifiedSession()) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-row"]').eq(0).should('have.attr', 'data-speech', 'heading').find('[cy-id="snap-speech-icon"]').should('have.attr', 'aria-label', 'Heading heard')
    cy.get('[cy-id="snap-row"]').eq(1).should('have.attr', 'data-speech', 'late').and('have.attr', 'data-flag', 'late').and('have.class', 'bg-warning/10')
    cy.get('[cy-id="snap-row"]').eq(1).find('[cy-id="snap-speech-icon"]').should('have.attr', 'aria-label', 'Starts late')
    cy.get('[cy-id="snap-row"]').eq(2).should('have.attr', 'data-speech', 'early').and('have.class', 'bg-warning/10')
    cy.get('[cy-id="snap-row"]').eq(2).find('[cy-id="snap-speech-icon"]').should('have.attr', 'aria-label', 'Starts early')
    cy.get('[cy-id="snap-row"]').eq(0).should('not.have.class', 'bg-warning/10')
    cy.get('[cy-id="snap-summary"]').should('have.text', '3 would move · 1 heading heard · 2 flagged')
  })

  it('leaves late and early rows unchecked, even at medium confidence', () => {
    mountPanel({ speechCheckAvailable: true, onSnap: cy.stub().resolves(verifiedSession()) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-row"]').eq(0).find('input[type="checkbox"]').should('be.checked')
    cy.get('[cy-id="snap-row"]').eq(1).find('input[type="checkbox"]').should('not.be.checked')
    cy.get('[cy-id="snap-row"]').eq(2).find('input[type="checkbox"]').should('not.be.checked')
    cy.contains('button', 'Apply 1 change').should('exist')
  })

  it('shows what was heard before and after the start on expand', () => {
    mountPanel({ speechCheckAvailable: true, onSnap: cy.stub().resolves(verifiedSession()) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-speech-transcript"]').should('not.exist')
    cy.get('[cy-id="snap-row"]').eq(1).find('[cy-id="snap-row-toggle"]').click()
    cy.get('[cy-id="snap-row-details"]').should('have.length', 1).and('contain.text', 'heading is heard just before the proposed start')
    cy.get('[cy-id="snap-speech-before"]').should('contain.text', 'the end. chapter three')
    cy.get('[cy-id="snap-speech-after"]').should('contain.text', 'she walked in')
  })

  it('leaves the speech cell blank for rows the check skipped', () => {
    mountPanel({ speechCheckAvailable: true, onSnap: cy.stub().resolves(verifiedSession()) })
    cy.contains('button', 'Snap to audio').click()
    cy.contains('label', 'Show unchanged').siblings('input[type="checkbox"]').click()
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-speech"]').should('have.text', '')
    cy.get('[cy-id="snap-proposal"]').should('not.contain.text', 'Not checked')
  })

  it("shows the server's speech check warnings but not its developer notes", () => {
    const warning = 'Speech check skipped: chapterbot is busy, 3 chapters not checked, try again later'
    mountPanel({ speechCheckAvailable: true, onSnap: cy.stub().resolves(verifiedSession([warning])) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-speech-warning"]').should('have.length', 1).and('contain.text', warning)
    cy.get('[cy-id="snap-speech-notes"]').should('not.contain.text', 'developer note')
  })
})

describe('<SnapToAudioPanel /> whole-book speech check', () => {
  /** 40 chapters, 100 s apart; every one moves 2 s earlier. Chapters 1-39 can be checked. */
  const BOOK = 40
  const bookStarts = Array.from({ length: BOOK }, (_, i) => i * 100)
  const bookSnapshot = bookStarts.map((start, i) => ({ clientKey: `ch-${i}`, start, title: `Chapter ${i + 1}` }))

  function bookProposal(i: number, speech: SnapChapterSpeech | null, extra: Partial<SnapChapterProposal> = {}): SnapChapterProposal {
    if (i === 0) return proposal({ index: 0, originalStart: 0, reason: 'first-chapter', confidence: 'high' })
    return proposal({ index: i, originalStart: bookStarts[i], proposedStart: bookStarts[i] - 2, reason: 'heading-lookback', confidence: 'high', speech, ...extra })
  }

  /** What the snap request returns: the first 15 checkable chapters checked. */
  function firstSession(): SnapSession {
    const response = makeResponse(
      bookStarts.map((_, i) => bookProposal(i, i >= 1 && i <= 15 ? heardSpeech({ heading: true }) : null)),
      true,
      BOOK * 100
    )
    response.options = { ...response.options, verify: true }
    response.warnings = ['Speech check limited to 15 chapters per request: 24 not checked. Resend with "indexes" set to the rest to check them.']
    return { snapshot: bookSnapshot, response, options: { ...SNAP_DEFAULT_OPTIONS, verify: true } }
  }

  /** The server's answer to a batch: those chapters checked (chapter 20 heard late), the rest not requested. */
  function batchResult(indexes: number[]): SnapSpeechBatchResult {
    const wanted = new Set(indexes)
    const chapters = bookStarts.map((start, i) => {
      if (!wanted.has(i)) return i === 0 ? bookProposal(0, null) : proposal({ index: i, originalStart: start, reason: 'not-requested' })
      return i === 20 ? bookProposal(i, heardSpeech({ late: true }), { confidence: 'low' }) : bookProposal(i, heardSpeech({ heading: true }))
    })
    const response = makeResponse(chapters, true, BOOK * 100)
    response.options = { ...response.options, verify: true }
    return { ok: true, response }
  }

  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)

  /** onCheckSpeech whose answers the test releases one at a time; tracks how many run at once. */
  function deferredCheck() {
    const pending: { indexes: number[]; resolve: (result: SnapSpeechBatchResult) => void }[] = []
    const state = { active: 0, maxActive: 0 }
    const stub = cy
      .stub()
      .as('onCheckSpeech')
      .callsFake(
        (_session: SnapSession, indexes: number[]) =>
          new Promise<SnapSpeechBatchResult>((resolve) => {
            state.active++
            state.maxActive = Math.max(state.maxActive, state.active)
            pending.push({
              indexes,
              resolve: (result) => {
                state.active--
                resolve(result)
              }
            })
          })
      )
    const release = (result?: SnapSpeechBatchResult) =>
      cy.wrap(pending).should('have.length.greaterThan', 0).then(() => {
        const next = pending.shift()!
        next.resolve(result ?? batchResult(next.indexes))
      })
    return { stub, release, state }
  }

  function mountBook(overrides: Partial<SnapToAudioPanelProps> = {}) {
    mountPanel({
      chapterCount: BOOK,
      speechCheckAvailable: true,
      onSnap: cy.stub().as('onSnap').resolves(firstSession()),
      ...overrides
    })
    cy.get('[cy-id="snap-check-speech"] input[type="checkbox"]').click()
    cy.contains('button', 'Snap to audio').click()
  }

  it('checks the rest of the book in batches of 15, one request at a time, with progress', () => {
    const { stub, release, state } = deferredCheck()
    mountBook({ onCheckSpeech: stub })

    cy.get('[cy-id="snap-speech-progress-label"]').should('have.text', 'Checking speech 15/39')
    cy.get('[cy-id="snap-speech-progress"] [role="progressbar"]').should('have.attr', 'aria-valuenow', '15').and('have.attr', 'aria-valuemax', '39')
    cy.get('@onCheckSpeech').should('have.been.calledOnce')
    cy.get('@onCheckSpeech').its('firstCall.args.1').should('deep.equal', range(16, 30))
    // the batch goes out for the session that was snapped
    cy.get('@onCheckSpeech').its('firstCall.args.0.snapshot').should('deep.equal', bookSnapshot)
    // the list stays browsable while the check runs; only the actions wait
    cy.get('[cy-id="snap-proposal"]').should('not.have.attr', 'inert')
    cy.contains('button', 'Snap to audio').should('be.disabled')
    cy.contains('button', /^Apply/).should('be.disabled')
    cy.get('[cy-id="snap-row"][data-index="22"] [cy-id="snap-row-toggle"]').click()
    cy.get('[cy-id="snap-row-details"]').should('exist')
    // a choice made during the run survives the batch that checks the row
    cy.get('[cy-id="snap-row"][data-index="25"] input[type="checkbox"]').click()

    release()
    cy.get('[cy-id="snap-speech-progress-label"]').should('have.text', 'Checking speech 30/39')
    cy.get('@onCheckSpeech').should('have.been.calledTwice')
    cy.get('@onCheckSpeech').its('secondCall.args.1').should('deep.equal', range(31, 39))

    release()
    cy.get('[cy-id="snap-speech-progress"]').should('not.exist')
    cy.get('@onCheckSpeech').should('have.been.calledTwice')
    cy.then(() => expect(state.maxActive).to.equal(1))

    // merged: 38 heard, chapter 21 (index 20) late and unchecked, no stale limit warning, nothing left to check
    cy.get('[cy-id="snap-summary"]').should('have.text', '39 would move · 38 headings heard · 1 flagged')
    cy.get('[cy-id="snap-row"][data-index="20"]').should('have.attr', 'data-speech', 'late').find('input[type="checkbox"]').should('not.be.checked')
    cy.get('[cy-id="snap-row"][data-index="21"]').should('have.attr', 'data-speech', 'heading').find('input[type="checkbox"]').should('be.checked')
    cy.get('[cy-id="snap-row"][data-index="25"]').should('have.attr', 'data-speech', 'heading').find('input[type="checkbox"]').should('not.be.checked')
    cy.get('[cy-id="snap-speech-notes"]').should('not.exist')
    cy.contains('button', 'Apply 37 changes').should('not.be.disabled')
  })

  it('cancels between batches, keeps what the last request checked and offers to check the rest', () => {
    const { stub, release } = deferredCheck()
    mountBook({ onCheckSpeech: stub })
    cy.get('[cy-id="snap-speech-progress-label"]').should('have.text', 'Checking speech 15/39')
    cy.get('[cy-id="snap-speech-progress"]').contains('button', 'Cancel').click()

    cy.get('[cy-id="snap-speech-progress"]').should('not.exist')
    // the request already sent still runs on the server: wait for it before sending anything else
    cy.get('[cy-id="snap-speech-finishing"]').should('exist')
    cy.contains('button', 'Snap to audio').should('be.disabled')

    release()
    cy.get('[cy-id="snap-speech-finishing"]').should('not.exist')
    cy.get('@onCheckSpeech').should('have.been.calledOnce')
    cy.get('[cy-id="snap-summary"]').should('contain.text', '29 headings heard').and('contain.text', '9 not checked')
    cy.contains('button', 'Snap to audio').should('not.be.disabled')

    // the user's ticks on the rest are kept by the next run
    cy.get('[cy-id="snap-row"][data-index="35"] input[type="checkbox"]').click()
    cy.contains('button', 'Check speech for 9 more chapters').click()
    cy.get('@onCheckSpeech').should('have.been.calledTwice')
    cy.get('@onCheckSpeech').its('secondCall.args.1').should('deep.equal', range(31, 39))
    release()
    cy.get('[cy-id="snap-summary"]').should('not.contain.text', 'not checked')
    cy.get('[cy-id="snap-row"][data-index="35"]').should('have.attr', 'data-speech', 'heading').find('input[type="checkbox"]').should('not.be.checked')
    cy.get('[cy-id="snap-row"][data-index="36"]').find('input[type="checkbox"]').should('be.checked')
  })

  it('waits and resends a batch the server turned away as busy', () => {
    let calls = 0
    const onCheckSpeech = cy
      .stub()
      .as('onCheckSpeech')
      .callsFake(async (_session: SnapSession, indexes: number[]) => (++calls === 1 ? { ok: false, busy: true } : batchResult(indexes)))
    mountBook({ onCheckSpeech, busyRetryDelayMs: 10 })
    cy.get('[cy-id="snap-speech-progress"]').should('not.exist')
    cy.get('@onCheckSpeech').should('have.been.calledThrice')
    cy.get('@onCheckSpeech').its('firstCall.args.1').should('deep.equal', range(16, 30))
    cy.get('@onCheckSpeech').its('secondCall.args.1').should('deep.equal', range(16, 30))
    cy.get('[cy-id="snap-summary"]').should('not.contain.text', 'not checked')
  })

  it('stops when the server stays busy and says so', () => {
    const onCheckSpeech = cy.stub().as('onCheckSpeech').resolves({ ok: false, busy: true })
    mountBook({ onCheckSpeech, busyRetryDelayMs: 10 })
    cy.get('[cy-id="snap-speech-notes"]').should('contain.text', 'the server is busy')
    cy.get('@onCheckSpeech').should('have.callCount', 4)
    cy.get('[cy-id="snap-summary"]').should('contain.text', '24 not checked')
    cy.contains('button', 'Check speech for 24 more chapters').should('not.be.disabled')
  })

  it('stops after a failed batch (the editor shows the error)', () => {
    const onCheckSpeech = cy.stub().as('onCheckSpeech').resolves({ ok: false, busy: false })
    mountBook({ onCheckSpeech })
    cy.contains('button', 'Check speech for 24 more chapters').should('exist')
    cy.get('@onCheckSpeech').should('have.been.calledOnce')
  })

  it('stops when a batch says chapterbot is busy or failed, and offers to try again', () => {
    const onCheckSpeech = cy
      .stub()
      .as('onCheckSpeech')
      .callsFake(async (_session: SnapSession, indexes: number[]) => {
        const result = batchResult([]) as Extract<SnapSpeechBatchResult, { ok: true }>
        result.response.warnings = [`Speech check skipped: chapterbot is busy, ${indexes.length} chapters not checked, try again later`]
        return result
      })
    mountBook({ onCheckSpeech })
    cy.get('[cy-id="snap-speech-warning"]').should('contain.text', 'chapterbot is busy, 15 chapters not checked')
    cy.get('[cy-id="snap-speech-progress"]').should('not.exist')
    cy.get('@onCheckSpeech').should('have.been.calledOnce')
    cy.contains('button', 'Check speech for 24 more chapters').click()
    cy.get('@onCheckSpeech').should('have.been.calledTwice')
    cy.get('[cy-id="snap-speech-progress"]').should('not.exist')
  })

  it('gives up on chapters the server keeps leaving unchecked', () => {
    // the server answers without a verdict or a reason
    const onCheckSpeech = cy
      .stub()
      .as('onCheckSpeech')
      .callsFake(async () => batchResult([]))
    mountBook({ onCheckSpeech })
    cy.get('@onCheckSpeech').should('have.been.calledTwice')
    cy.get('[cy-id="snap-speech-progress"]').should('not.exist')
  })

  it('sends no batches when the snap says the speech check cannot run', () => {
    const onCheckSpeech = cy.stub().as('onCheckSpeech')
    const session = firstSession()
    session.response.warnings = ['Speech check skipped: the audio files are outside the configured chapterbot path map']
    mountBook({ onCheckSpeech, onSnap: cy.stub().as('onSnap').resolves(session) })
    cy.get('[cy-id="snap-speech-warning"]').should('contain.text', 'outside the configured chapterbot path map')
    cy.get('[cy-id="snap-speech-notes"]').should('not.contain.text', 'Check speech for')
    cy.get('@onCheckSpeech').should('not.have.been.called')
  })

  it('does not batch a plain snap or on a server without the speech check', () => {
    const onCheckSpeech = cy.stub().as('onCheckSpeech')
    const plain = firstSession()
    plain.response.options = { ...plain.response.options, verify: false }
    plain.options = { ...SNAP_DEFAULT_OPTIONS }
    mountPanel({ chapterCount: BOOK, speechCheckAvailable: true, onSnap: cy.stub().resolves(plain), onCheckSpeech })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-proposal"]').should('exist')
    // nothing was checked, so there is no "check speech for N more"
    cy.get('[cy-id="snap-speech-notes"]').should('not.exist')
    cy.get('@onCheckSpeech').should('not.have.been.called')
  })
})

describe('<SnapToAudioPanel /> Audible lookup hint', () => {
  it('suggests snapping freshly looked-up chapters, with the speech check when available', () => {
    const onLookupHintDismiss = cy.stub().as('onLookupHintDismiss')
    mountPanel({ speechCheckAvailable: true, showLookupHint: true, onLookupHintDismiss })
    cy.get('[cy-id="snap-lookup-hint"]').should('contain.text', 'loaded from Audible').and('contain.text', 'titles stay as they are')
    cy.get('[cy-id="snap-lookup-hint"]').contains('button', 'Snap these to the audio').click()
    cy.get('@onSnap').should('have.been.calledOnceWith', { ...SNAP_DEFAULT_OPTIONS, verify: true })
    cy.get('@onLookupHintDismiss').should('have.been.called')
    cy.get('[cy-id="snap-check-speech"] input[type="checkbox"]').should('be.checked')
    cy.get('[cy-id="snap-lookup-hint"]').should('not.exist')
  })

  it('snaps without the speech check on a server without it', () => {
    mountPanel({ showLookupHint: true })
    cy.get('[cy-id="snap-lookup-hint"]').contains('button', 'Snap these to the audio').click()
    cy.get('@onSnap').should('have.been.calledOnceWith', SNAP_DEFAULT_OPTIONS)
  })

  it('stays when the snap fails', () => {
    const onLookupHintDismiss = cy.stub().as('onLookupHintDismiss')
    mountPanel({ showLookupHint: true, onLookupHintDismiss, onSnap: cy.stub().as('onSnap').resolves(null) })
    cy.get('[cy-id="snap-lookup-hint"]').contains('button', 'Snap these to the audio').click()
    cy.get('@onSnap').should('have.been.calledOnce')
    cy.get('[cy-id="snap-lookup-hint"]').contains('button', 'Snap these to the audio').should('not.be.disabled')
    cy.get('@onLookupHintDismiss').should('not.have.been.called')
  })

  it('can be dismissed', () => {
    const onLookupHintDismiss = cy.stub().as('onLookupHintDismiss')
    mountPanel({ showLookupHint: true, onLookupHintDismiss })
    cy.get('[cy-id="snap-lookup-hint"] button[aria-label="Dismiss"]').click()
    cy.get('@onLookupHintDismiss').should('have.been.calledOnce')
    cy.get('@onSnap').should('not.have.been.called')
  })

  it('is not shown without a lookup', () => {
    mountPanel()
    cy.get('[cy-id="snap-lookup-hint"]').should('not.exist')
  })
})

describe('<SnapToAudioPanel /> heard titles', () => {
  const speech = (partial: Partial<SnapChapterSpeech>): SnapChapterSpeech => ({
    before: 'and the door slammed behind her',
    after: "Chapter 3 The rain didn't let up all night",
    heading: false,
    late: false,
    early: false,
    ...partial
  })

  /** QA: file-style titles, while the narrator reads out chapter numbers. */
  function heardSession(heard: Partial<Record<number, string | null>> = { 1: 'Chapter 2', 2: 'Chapter 3', 3: 'Chapter 4' }): SnapSession {
    const session = makeSession([
      proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }),
      proposal({ index: 1, proposedStart: 96.75, reason: 'heading-lookback', confidence: 'high', pause: pause(95, 97), speech: speech({ heard: heard[1] }) }),
      // start stays put, but the narrator says a different heading
      proposal({ index: 2, reason: 'inside-pause', confidence: 'high', pause: pause(199, 201), speech: speech({ heard: heard[2] }) }),
      // the title's own heading was heard: nothing to offer
      proposal({
        index: 3,
        proposedStart: 295,
        reason: 'nearest-longest-pause',
        confidence: 'medium',
        pause: pause(294, 295.3),
        speech: speech({ heading: true, heard: heard[3] })
      })
    ])
    session.snapshot = session.snapshot.map((chapter, i) => ({ ...chapter, title: i === 3 ? 'Chapter Four' : `Black Ice - Part 0${i + 1}` }))
    session.options = { ...session.options, verify: true }
    session.response.options = { ...session.response.options, verify: true }
    return session
  }

  function mountHeard(session = heardSession(), applyTitles?: (picks: SnapTitlePick[]) => string[]) {
    mountPanel({
      speechCheckAvailable: true,
      onSnap: cy.stub().resolves(session),
      onApplyTitles: cy
        .stub()
        .as('onApplyTitles')
        .callsFake(applyTitles ?? ((picks: SnapTitlePick[]) => picks.map((pick) => pick.clientKey)))
    })
    cy.contains('button', 'Snap to audio').click()
  }

  const useHeardTitle = (row: number) => {
    cy.get('[cy-id="snap-row"]').eq(row).find('[cy-id="snap-row-toggle"]').click()
    cy.get('[cy-id="snap-heard-title"]').contains('button', 'Use heard title').click()
  }

  it('marks rows with a different heard title and offers it in the details', () => {
    mountHeard()
    cy.get('[cy-id="snap-row"]').should('have.length', 3)
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-heard-badge"]').should('have.attr', 'aria-label', 'Heard: Chapter 2')
    cy.get('[cy-id="snap-row"]').eq(1).should('have.attr', 'data-index', '2').find('[cy-id="snap-heard-badge"]').should('have.attr', 'aria-label', 'Heard: Chapter 3')
    cy.get('[cy-id="snap-row"]').eq(1).find('[cy-id="snap-speech-icon"]').should('have.attr', 'aria-label', 'Heading not heard')
    cy.get('[cy-id="snap-row"]').eq(2).find('[cy-id="snap-heard-badge"]').should('not.exist')
    // the unchanged row can be checked for the bulk action but is not pre-checked
    cy.get('[cy-id="snap-row"]').eq(1).find('input[type="checkbox"]').should('not.be.disabled').and('not.be.checked')
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-row-toggle"]').click()
    cy.get('[cy-id="snap-heard-title"]').should('contain.text', 'Heard: Chapter 2').and('contain.text', 'Use heard title')
  })

  it('never changes a title unless asked', () => {
    mountHeard()
    cy.contains('button', 'Apply 2 changes').click()
    cy.get('@onApplyTitles').should('not.have.been.called')
  })

  it('uses the heard title for one row without touching the starts', () => {
    mountHeard()
    useHeardTitle(1)
    cy.get('@onApplyTitles').should('have.been.calledOnceWith', [{ clientKey: 'ch-2', fromTitle: 'Black Ice - Part 03', toTitle: 'Chapter 3' }])
    cy.get('@onApply').should('not.have.been.called')
    // the row stays listed with its new title and no offer; the proposal stays open
    cy.get('[cy-id="snap-row"]').should('have.length', 3)
    cy.get('[cy-id="snap-row"]').eq(1).find('[cy-id="snap-row-title"]').should('have.text', 'Chapter 3')
    cy.get('[cy-id="snap-row"]').eq(1).find('[cy-id="snap-heard-badge"]').should('not.exist')
    cy.get('[cy-id="snap-heard-title"]').should('not.exist')
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-heard-badge"]').should('exist')
    cy.contains('button', 'Apply 2 changes').should('exist')
  })

  it('uses the heard titles for the checked rows', () => {
    mountHeard()
    // only the pre-checked moved row has a heard title so far
    cy.contains('button', 'Use heard title for 1 checked row').should('not.be.disabled')
    cy.get('[cy-id="snap-row"]').eq(1).find('input[type="checkbox"]').click()
    cy.contains('button', 'Use heard titles for 2 checked rows').click()
    cy.get('@onApplyTitles').should('have.been.calledOnceWith', [
      { clientKey: 'ch-1', fromTitle: 'Black Ice - Part 02', toTitle: 'Chapter 2' },
      { clientKey: 'ch-2', fromTitle: 'Black Ice - Part 03', toTitle: 'Chapter 3' }
    ])
    cy.get('[cy-id="snap-row-title"]').then(($titles) => {
      expect([...$titles].map((el) => el.textContent)).to.deep.equal(['Chapter 2', 'Chapter 3', 'Chapter Four'])
    })
    cy.get('[cy-id="snap-heard-badge"]').should('not.exist')
    cy.contains('button', /Use heard title/).should('not.exist')
    // the start changes are still there to apply
    cy.contains('button', 'Apply 2 changes').click()
    cy.get('@onApply').should('have.been.calledOnce')
  })

  it('disables the bulk action when no checked row has a heard title', () => {
    mountHeard()
    cy.get('[cy-id="snap-row"]').eq(0).find('input[type="checkbox"]').click()
    cy.contains('button', 'Use heard titles for checked rows').should('be.disabled')
  })

  it('keeps the offer when the editor skipped the title', () => {
    mountHeard(heardSession(), () => [])
    useHeardTitle(0)
    cy.get('@onApplyTitles').should('have.been.calledOnce')
    cy.get('[cy-id="snap-row"]').eq(0).find('[cy-id="snap-row-title"]').should('have.text', 'Black Ice - Part 02')
    cy.get('[cy-id="snap-heard-title"]').should('exist')
  })

  it('offers nothing when the server sends no heard title (stock or older servers)', () => {
    mountHeard(heardSession({}))
    // the unchanged row is still listed: its heading was not heard, so it is flagged
    cy.get('[cy-id="snap-row"]').should('have.length', 3)
    cy.get('[cy-id="snap-row"]').eq(1).should('have.attr', 'data-flag', 'no-heading')
    cy.get('[cy-id="snap-heard-badge"]').should('not.exist')
    cy.contains('button', /Use heard title/).should('not.exist')
  })

  it('offers nothing without an editor to take the titles', () => {
    mountPanel({ speechCheckAvailable: true, onSnap: cy.stub().resolves(heardSession()) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-heard-badge"]').should('not.exist')
    cy.contains('button', /Use heard title/).should('not.exist')
  })
})
