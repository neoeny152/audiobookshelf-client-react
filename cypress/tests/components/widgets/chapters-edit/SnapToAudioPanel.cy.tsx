import SnapToAudioPanel, { type SnapToAudioPanelProps } from '@/components/widgets/chapters-edit/SnapToAudioPanel'
import { SNAP_DEFAULT_OPTIONS, type SnapRow, type SnapSession } from '@/lib/chapters/chapterSnap'
import type { SnapChapterProposal, SnapChaptersResponse } from '@/types/api'

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

function makeSession(chapters: SnapChapterProposal[], complete = true): SnapSession {
  const response: SnapChaptersResponse = {
    libraryItemId: 'li_1',
    duration: mediaDuration,
    complete,
    options: { ...SNAP_DEFAULT_OPTIONS, leadSec: 0.25, snapToFileStart: false },
    stats: { segments: 3, ffmpegCalls: 3, failedSegments: 0, analysedSec: 180, pausesFound: 12, elapsedMs: 6000, moved: 2, unchanged: 1, skipped: 0 },
    chapters,
    proposedChapters: chapters.map((c, i) => ({ id: i, title: c.title, start: c.proposedStart, end: chapters[i + 1]?.proposedStart ?? mediaDuration })),
    warnings: []
  }
  return { snapshot, response, options: { ...SNAP_DEFAULT_OPTIONS } }
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

  it('lists only the chapters that would move, with plain-word reasons', () => {
    cy.get('[cy-id="snap-row"]').should('have.length', 2)
    cy.get('[cy-id="snap-row"]').eq(0).should('contain.text', 'Chapter 2').and('contain.text', '01:40.0').and('contain.text', '01:36.7')
    cy.get('[cy-id="snap-row"]').eq(0).should('contain.text', '-3.25 s').and('contain.text', 'Moved before spoken heading').and('contain.text', 'High')
    cy.get('[cy-id="snap-row"]').eq(1).should('contain.text', '+20.3 s').and('contain.text', 'Moved to nearest pause').and('contain.text', 'Low')
  })

  it('pre-checks changed rows except low-confidence ones', () => {
    cy.get('[cy-id="snap-row"]').eq(0).find('input[type="checkbox"]').should('be.checked')
    cy.get('[cy-id="snap-row"]').eq(1).find('input[type="checkbox"]').should('not.be.checked')
    cy.contains('button', 'Apply 1 change').should('not.be.disabled')
  })

  it('reveals unchanged chapters on request', () => {
    cy.contains('label', 'Show unchanged').siblings('input[type="checkbox"]').click()
    cy.get('[cy-id="snap-row"]').should('have.length', 4)
    cy.get('[cy-id="snap-row"]').eq(3).should('contain.text', 'Already in a pause')
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

describe('<SnapToAudioPanel /> sub-second proposals', () => {
  it('shows the exact proposal inside a short pause, checked, with no rounding warning', () => {
    const session = makeSession([
      proposal({ index: 0, reason: 'first-chapter', confidence: 'high' }),
      proposal({ index: 1, proposedStart: 98.65, reason: 'nearest-longest-pause', confidence: 'medium', pause: pause(98.2, 98.9) }),
      proposal({ index: 2, reason: 'inside-pause', confidence: 'high', pause: pause(199, 201) }),
      proposal({ index: 3, reason: 'inside-pause', confidence: 'high', pause: pause(299, 301) })
    ])
    mountPanel({ onSnap: cy.stub().as('onSnap').resolves(session) })
    cy.contains('button', 'Snap to audio').click()
    cy.get('[cy-id="snap-row"]').should('have.length', 1)
    cy.get('[cy-id="snap-row"]').eq(0).should('contain.text', '01:38.6').and('contain.text', '-1.35 s')
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
