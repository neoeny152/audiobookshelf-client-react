import { applySnapProposals, type EditableChapter } from '@/lib/chapters/chapterEditorUtils'
import {
  buildSnapPayload,
  buildSnapRetryPayload,
  buildSnapRows,
  clampSnapOption,
  formatSnapStart,
  getDefaultSnapChecked,
  getSnapErrorToast,
  mergeSnapRetry,
  SNAP_DEFAULT_OPTIONS,
  type SnapSession
} from '@/lib/chapters/chapterSnap'
import type { SnapChapterProposal, SnapChaptersResponse } from '@/types/api'

const mediaDuration = 1000

function rows(starts: number[]): EditableChapter[] {
  return starts.map((start, i) => ({
    id: i,
    start,
    end: starts[i + 1] ?? mediaDuration,
    title: `Chapter ${i + 1}`,
    error: null,
    clientKey: `ch-${i}`
  }))
}

function proposal(partial: Partial<SnapChapterProposal> & Pick<SnapChapterProposal, 'index' | 'originalStart'>): SnapChapterProposal {
  const proposedStart = partial.proposedStart ?? partial.originalStart
  const delta = Math.round((proposedStart - partial.originalStart) * 1000) / 1000
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
    proposedStart
  }
}

function response(chapters: SnapChapterProposal[], complete = true): SnapChaptersResponse {
  return {
    libraryItemId: 'li_1',
    duration: mediaDuration,
    complete,
    options: { ...SNAP_DEFAULT_OPTIONS, leadSec: 0.25, snapToFileStart: false },
    stats: { segments: 1, ffmpegCalls: 1, failedSegments: 0, analysedSec: 60, pausesFound: 3, elapsedMs: 4000, moved: 0, unchanged: 0, skipped: 0 },
    chapters,
    proposedChapters: chapters.map((c, i) => ({ id: i, title: c.title, start: c.proposedStart, end: chapters[i + 1]?.proposedStart ?? mediaDuration })),
    warnings: []
  }
}

const pause = (start: number, end: number) => ({ start, end, duration: end - start, startClipped: false, endClipped: false, crossesFileBoundary: false })

describe('applySnapProposals', () => {
  it('changes only the picked starts and keeps titles, order and keys', () => {
    const chapters = rows([0, 100, 200, 300])
    const result = applySnapProposals(
      chapters,
      [
        { clientKey: 'ch-1', fromStart: 100, toStart: 97 },
        { clientKey: 'ch-3', fromStart: 300, toStart: 302 }
      ],
      mediaDuration
    )

    expect(result.applied).to.equal(2)
    expect(result.skipped).to.equal(0)
    expect(result.chapters.map((c) => c.start)).to.deep.equal([0, 97, 200, 302])
    expect(result.chapters.map((c) => c.title)).to.deep.equal(chapters.map((c) => c.title))
    expect(result.chapters.map((c) => c.clientKey)).to.deep.equal(chapters.map((c) => c.clientKey))
    expect(result.chapters[2].end).to.equal(302)
    expect(result.chapters[1].end).to.equal(200)
  })

  it('recomputes ends of the moved row and the row before it', () => {
    const result = applySnapProposals(rows([0, 100, 200]), [{ clientKey: 'ch-1', fromStart: 100, toStart: 97 }], mediaDuration)
    expect(result.chapters[0].end).to.equal(97)
    expect(result.chapters[1].end).to.equal(200)
  })

  it('skips rows that were edited or removed since the snap', () => {
    const chapters = rows([0, 105, 200])
    const result = applySnapProposals(
      chapters,
      [
        { clientKey: 'ch-1', fromStart: 100, toStart: 97 },
        { clientKey: 'gone', fromStart: 300, toStart: 298 },
        { clientKey: 'ch-2', fromStart: 200, toStart: 198 }
      ],
      mediaDuration
    )
    expect(result.applied).to.equal(1)
    expect(result.skipped).to.equal(2)
    expect(result.chapters.map((c) => c.start)).to.deep.equal([0, 105, 198])
  })

  it('finds rows by key after an insert shifted indexes', () => {
    const chapters = rows([0, 100, 200])
    const inserted: EditableChapter[] = [chapters[0], { ...chapters[1], clientKey: 'new', start: 50 }, { ...chapters[1], id: 2 }, { ...chapters[2], id: 3 }]
    const result = applySnapProposals(inserted, [{ clientKey: 'ch-2', fromStart: 200, toStart: 196 }], mediaDuration)
    expect(result.chapters.map((c) => c.start)).to.deep.equal([0, 50, 100, 196])
  })

  it('never moves the first chapter or past the end of the book', () => {
    const result = applySnapProposals(
      rows([0, 100]),
      [
        { clientKey: 'ch-0', fromStart: 0, toStart: 2 },
        { clientKey: 'ch-1', fromStart: 100, toStart: mediaDuration }
      ],
      mediaDuration
    )
    expect(result.applied).to.equal(0)
    expect(result.skipped).to.equal(2)
  })

  it('reverts a move that would cross an unmoved neighbour', () => {
    const chapters = rows([0, 100, 102, 300])
    const result = applySnapProposals(chapters, [{ clientKey: 'ch-2', fromStart: 102, toStart: 99 }], mediaDuration)
    expect(result.applied).to.equal(0)
    expect(result.skipped).to.equal(1)
    expect(result.chapters).to.equal(chapters)
  })

  it('applies a proposal at its exact fractional start and matches fractional editor starts', () => {
    const chapters = rows([0, 100.6, 200.4, 300])
    const result = applySnapProposals(chapters, [{ clientKey: 'ch-1', fromStart: 100.6, toStart: 96.75 }], mediaDuration)
    expect(result.applied).to.equal(1)
    expect(result.skipped).to.equal(0)
    expect(result.chapters.map((c) => c.start)).to.deep.equal([0, 96.75, 200.4, 300])
    expect(result.chapters[0].end).to.equal(96.75)
  })

  it('skips a row whose start was edited by less than a second since the snap', () => {
    const chapters = rows([0, 100.6, 200])
    const result = applySnapProposals(chapters, [{ clientKey: 'ch-1', fromStart: 101, toStart: 96.75 }], mediaDuration)
    expect(result.applied).to.equal(0)
    expect(result.skipped).to.equal(1)
  })

  it('ignores float noise when comparing the pick against the editor start', () => {
    const chapters = rows([0, 0.1 + 0.2 + 100, 200])
    const result = applySnapProposals(chapters, [{ clientKey: 'ch-1', fromStart: 100.3, toStart: 99.4567 }], mediaDuration)
    expect(result.applied).to.equal(1)
    expect(result.chapters[1].start).to.equal(99.457)
  })

  it('keeps a move that lands just after a fractional neighbour in the same second', () => {
    const chapters = rows([0, 96.6, 120, 300])
    const result = applySnapProposals(chapters, [{ clientKey: 'ch-2', fromStart: 120, toStart: 96.9 }], mediaDuration)
    expect(result.applied).to.equal(1)
    expect(result.chapters.map((c) => c.start)).to.deep.equal([0, 96.6, 96.9, 300])
  })

  it('reverts a move that would land on or before a fractional neighbour', () => {
    const chapters = rows([0, 96.6, 120, 300])
    const result = applySnapProposals(chapters, [{ clientKey: 'ch-2', fromStart: 120, toStart: 96.6 }], mediaDuration)
    expect(result.applied).to.equal(0)
    expect(result.skipped).to.equal(1)
  })

  it('returns the same array when nothing is picked', () => {
    const chapters = rows([0, 100])
    expect(applySnapProposals(chapters, [], mediaDuration).chapters).to.equal(chapters)
  })
})

describe('formatSnapStart', () => {
  it('shows tenths and truncates like the editor start column', () => {
    expect(formatSnapStart(96.75)).to.equal('01:36.7')
    expect(formatSnapStart(100)).to.equal('01:40.0')
    expect(formatSnapStart(59.99)).to.equal('00:59.9')
    expect(formatSnapStart(3600.3)).to.equal('01:00:00.3')
    expect(formatSnapStart(0.1 + 0.2)).to.equal('00:00.3')
  })
})

describe('buildSnapPayload', () => {
  it('sends the editor starts and titles, without indexes when nothing is selected', () => {
    const { payload, snapshot } = buildSnapPayload(rows([0, 100, 200]), new Set(), SNAP_DEFAULT_OPTIONS)
    expect(payload.chapters).to.deep.equal([
      { id: 0, title: 'Chapter 1', start: 0 },
      { id: 1, title: 'Chapter 2', start: 100 },
      { id: 2, title: 'Chapter 3', start: 200 }
    ])
    expect(payload).not.to.have.property('indexes')
    expect(payload.options).to.deep.equal(SNAP_DEFAULT_OPTIONS)
    expect(snapshot.map((s) => s.clientKey)).to.deep.equal(['ch-0', 'ch-1', 'ch-2'])
  })

  it('sends fractional starts at millisecond precision', () => {
    const { payload, snapshot } = buildSnapPayload(rows([0, 100.6, 200.4567]), new Set(), SNAP_DEFAULT_OPTIONS)
    expect(payload.chapters?.map((c) => c.start)).to.deep.equal([0, 100.6, 200.457])
    expect(snapshot.map((s) => s.start)).to.deep.equal([0, 100.6, 200.457])
  })

  it('sends indexes for the selected rows only and omits empty titles', () => {
    const chapters = rows([0, 100, 200])
    chapters[1] = { ...chapters[1], title: '  ' }
    const { payload } = buildSnapPayload(chapters, new Set(['ch-2', 'ch-1']), SNAP_DEFAULT_OPTIONS)
    expect(payload.indexes).to.deep.equal([1, 2])
    expect(payload.chapters?.[1]).to.deep.equal({ id: 1, start: 100 })
  })
})

describe('clampSnapOption', () => {
  it('clamps to the server ranges and falls back to defaults', () => {
    expect(clampSnapOption('windowSec', 999)).to.equal(60)
    expect(clampSnapOption('noiseDb', -200)).to.equal(-80)
    expect(clampSnapOption('headingLookbackSec', -1)).to.equal(0)
    expect(clampSnapOption('minSilenceSec', NaN)).to.equal(0.7)
  })
})

describe('snap rows and retry', () => {
  const snapshot = [0, 100, 200, 300].map((start, i) => ({ clientKey: `ch-${i}`, start, title: `Chapter ${i + 1}` }))

  function session(chapters: SnapChapterProposal[], complete = true): SnapSession {
    return { snapshot, response: response(chapters, complete), options: { ...SNAP_DEFAULT_OPTIONS } }
  }

  it('builds rows at the exact proposed start and pre-checks changed rows except low confidence', () => {
    const result = buildSnapRows(
      session([
        proposal({ index: 0, originalStart: 0, reason: 'first-chapter', confidence: 'high' }),
        proposal({ index: 1, originalStart: 100, proposedStart: 96.75, reason: 'heading-lookback', confidence: 'high', pause: pause(95, 97) }),
        proposal({ index: 2, originalStart: 200, proposedStart: 220.3, reason: 'nearest-longest-pause', confidence: 'low', pause: pause(219, 220.55) }),
        proposal({ index: 3, originalStart: 300, proposedStart: 300.2, reason: 'nearest-longest-pause', confidence: 'medium', pause: pause(299.5, 300.45) })
      ])
    )

    expect(result.map((r) => r.newStart)).to.deep.equal([0, 96.75, 220.3, 300.2])
    expect(result.map((r) => r.delta)).to.deep.equal([0, -3.25, 20.3, 0.2])
    expect(result.map((r) => r.changed)).to.deep.equal([false, true, true, true])
    expect([...getDefaultSnapChecked(result)]).to.deep.equal([1, 3])
  })

  it('reports millisecond deltas for chapters loaded with fractional starts', () => {
    const { snapshot: fractionalSnapshot } = buildSnapPayload(rows([0, 100.6, 200.4, 300]), new Set(), SNAP_DEFAULT_OPTIONS)
    const result = buildSnapRows({
      snapshot: fractionalSnapshot,
      response: response(
        [
          proposal({ index: 0, originalStart: 0, reason: 'first-chapter', confidence: 'high' }),
          proposal({ index: 1, originalStart: 100.6, proposedStart: 96.75, reason: 'nearest-longest-pause', confidence: 'high', pause: pause(95, 97) }),
          proposal({ index: 2, originalStart: 200.4, proposedStart: 200.45, reason: 'nearest-longest-pause', confidence: 'high', pause: pause(199.5, 200.7) }),
          proposal({ index: 3, originalStart: 300, reason: 'inside-pause', confidence: 'high', pause: pause(299, 301) })
        ],
        true
      ),
      options: { ...SNAP_DEFAULT_OPTIONS }
    })

    expect(result.map((r) => r.originalStart)).to.deep.equal([0, 100.6, 200.4, 300])
    expect(result.map((r) => r.newStart)).to.deep.equal([0, 96.75, 200.45, 300])
    expect(result.map((r) => r.delta)).to.deep.equal([0, -3.85, 0.05, 0])
    expect(result.map((r) => r.changed)).to.deep.equal([false, true, true, false])
  })

  it('keeps a proposal inside a pause shorter than a second', () => {
    const result = buildSnapRows(
      session([
        proposal({ index: 0, originalStart: 0, reason: 'first-chapter', confidence: 'high' }),
        proposal({ index: 1, originalStart: 100, proposedStart: 98.65, reason: 'nearest-longest-pause', confidence: 'medium', pause: pause(98.2, 98.9) }),
        proposal({ index: 2, originalStart: 200, reason: 'inside-pause', confidence: 'high', pause: pause(199, 201) }),
        proposal({ index: 3, originalStart: 300, reason: 'inside-pause', confidence: 'high', pause: pause(299, 301) })
      ])
    )

    expect(result[1].newStart).to.equal(98.65)
    expect(result[1].newStart).to.be.within(98.2, 98.9)
    expect([...getDefaultSnapChecked(result)]).to.deep.equal([1])
  })

  it('applies built rows so the editor and the save payload keep the proposal', () => {
    const editor = rows([0, 100, 200, 300])
    const { snapshot: editorSnapshot } = buildSnapPayload(editor, new Set(), SNAP_DEFAULT_OPTIONS)
    const built = buildSnapRows({
      snapshot: editorSnapshot,
      response: response([
        proposal({ index: 0, originalStart: 0, reason: 'first-chapter', confidence: 'high' }),
        proposal({ index: 1, originalStart: 100, proposedStart: 16.09 + 80, reason: 'heading-lookback', confidence: 'high', pause: pause(95, 97) }),
        proposal({ index: 2, originalStart: 200, reason: 'inside-pause', confidence: 'high', pause: pause(199, 201) }),
        proposal({ index: 3, originalStart: 300, reason: 'inside-pause', confidence: 'high', pause: pause(299, 301) })
      ]),
      options: { ...SNAP_DEFAULT_OPTIONS }
    })
    const picks = built.filter((row) => row.changed).map((row) => ({ clientKey: row.clientKey, fromStart: row.originalStart, toStart: row.newStart }))
    const result = applySnapProposals(editor, picks, mediaDuration)

    expect(result.applied).to.equal(1)
    expect(result.chapters.map((c) => c.start)).to.deep.equal([0, 96.09, 200, 300])
  })

  it('retries not-analysed rows with the proposed chapters and merges the result', () => {
    const first = response(
      [
        proposal({ index: 0, originalStart: 0, reason: 'first-chapter', confidence: 'high' }),
        proposal({ index: 1, originalStart: 100, proposedStart: 98.75, reason: 'nearest-longest-pause', confidence: 'high', pause: pause(97, 99) }),
        proposal({ index: 2, originalStart: 200, reason: 'not-analysed' }),
        proposal({ index: 3, originalStart: 300, reason: 'not-analysed' })
      ],
      false
    )

    const retryPayload = buildSnapRetryPayload(first, SNAP_DEFAULT_OPTIONS)
    expect(retryPayload?.indexes).to.deep.equal([2, 3])
    expect(retryPayload?.chapters?.map((c) => c.start)).to.deep.equal([0, 98.75, 200, 300])

    const retry = response([
      proposal({ index: 0, originalStart: 0, reason: 'first-chapter', confidence: 'high' }),
      proposal({ index: 1, originalStart: 98.75, reason: 'not-requested' }),
      proposal({ index: 2, originalStart: 200, proposedStart: 203.75, reason: 'nearest-longest-pause', confidence: 'high', pause: pause(202, 204) }),
      proposal({ index: 3, originalStart: 300, reason: 'inside-pause', confidence: 'high', pause: pause(299, 301) })
    ])

    const merged = mergeSnapRetry(first, retry, [2, 3])
    expect(merged.complete).to.equal(true)
    expect(merged.chapters[1].reason).to.equal('nearest-longest-pause')
    expect(merged.chapters[1].originalStart).to.equal(100)
    expect(merged.chapters[2].reason).to.equal('nearest-longest-pause')
    expect(merged.chapters[2].delta).to.equal(3.75)
    expect(merged.chapters[3].reason).to.equal('inside-pause')
    expect(buildSnapRetryPayload(merged, SNAP_DEFAULT_OPTIONS)).to.equal(null)
  })
})

describe('getSnapErrorToast', () => {
  it('explains each server status', () => {
    expect(getSnapErrorToast({ ok: false, status: 409, error: 'A chapter snap is already running for this item' })).to.deep.equal({
      key: 'ToastSnapChaptersAlreadyRunning',
      type: 'warning'
    })
    expect(getSnapErrorToast({ ok: false, status: 429, error: 'Too many chapter snaps running' })).to.deep.equal({
      key: 'ToastSnapChaptersBusy',
      type: 'warning'
    })
    expect(getSnapErrorToast({ ok: false, status: 403, error: 'Forbidden' })).to.deep.equal({ key: 'ToastSnapChaptersForbidden', type: 'error' })
    expect(getSnapErrorToast({ ok: false, status: 400, error: 'Invalid request body' })).to.deep.equal({
      key: 'ToastSnapChaptersInvalidWithError',
      values: { error: 'Invalid request body' },
      type: 'error'
    })
    expect(getSnapErrorToast({ ok: false, status: 500, error: 'Silence detection failed' })).to.deep.equal({
      key: 'ToastSnapChaptersFailedWithError',
      values: { error: 'Silence detection failed' },
      type: 'error'
    })
  })

  it('falls back to a plain failure without a server message or when the server was unreachable', () => {
    expect(getSnapErrorToast({ ok: false, status: 400, error: '' })).to.deep.equal({ key: 'ToastSnapChaptersFailed', type: 'error' })
    expect(getSnapErrorToast({ ok: false, status: 0, error: '' })).to.deep.equal({ key: 'ToastSnapChaptersFailed', type: 'error' })
  })
})
