import {
  AUTO_PIPELINE_DEFAULTS,
  buildPipelineProposalSession,
  canUndoPipelineChapters,
  countPipelineTabs,
  getDismissedPipelineItemId,
  getPipelineMatchPercent,
  getPipelineProposalChapters,
  getPipelineTab,
  getPipelineWorkerItemId,
  getPipelineWouldLines,
  hasPipelineChapterReview,
  hasPipelineMatchReview,
  isAudibleProvider,
  toPipelineItemState,
  upsertPipelineItem,
  withAutoPipelineDefaults
} from '@/lib/autoPipeline'
import type { PipelineItemState, PipelineProposal, SnapChaptersResponse } from '@/types/api'

const state = (partial: Partial<PipelineItemState> = {}): PipelineItemState => ({
  libraryItemId: 'li_1',
  libraryId: 'lib_1',
  title: 'Book',
  status: 'queued',
  step: null,
  reason: null,
  dryRun: false,
  queuedAt: 1,
  updatedAt: 1,
  attempts: 0,
  notBefore: null,
  match: null,
  chapters: null,
  epub: null,
  ...partial
})

describe('withAutoPipelineDefaults', () => {
  it('fills a missing or partial object with the server defaults', () => {
    expect(withAutoPipelineDefaults(undefined)).to.deep.equal(AUTO_PIPELINE_DEFAULTS)
    expect(withAutoPipelineDefaults({ mode: 'dryRun', autoEpub: true })).to.deep.equal({ ...AUTO_PIPELINE_DEFAULTS, mode: 'dryRun', autoEpub: true })
  })

  it('ignores invalid values and clamps numbers', () => {
    expect(withAutoPipelineDefaults({ mode: 'turbo', autoMatch: 'yes', autoMatchMinConfidence: 20, settleMinutes: 999, autoMatchProvider: '' })).to.deep.equal({
      ...AUTO_PIPELINE_DEFAULTS,
      autoMatchMinConfidence: 50,
      settleMinutes: 120
    })
  })
})

describe('isAudibleProvider', () => {
  it('accepts every Audible region and nothing else', () => {
    expect(isAudibleProvider('audible')).to.equal(true)
    expect(isAudibleProvider('audible.uk')).to.equal(true)
    expect(isAudibleProvider('google')).to.equal(false)
    expect(isAudibleProvider('audiblex')).to.equal(false)
    expect(isAudibleProvider('')).to.equal(false)
  })
})

describe('toPipelineItemState', () => {
  it('accepts a server state and normalises nested parts', () => {
    const parsed = toPipelineItemState({
      ...state({ status: 'needs-review', step: 'chapters' }),
      chapters: { result: 'needs-review', source: { type: 'aligned' }, diffSec: 2, applied: false, needsReview: [{ index: 3, why: 'late' }, { bad: true }] }
    })
    expect(parsed?.status).to.equal('needs-review')
    expect(parsed?.chapters?.source).to.equal('aligned')
    expect(parsed?.chapters?.needsReview).to.deep.equal([{ index: 3, why: 'late' }])
  })

  it('rejects anything that is not a state', () => {
    expect(toPipelineItemState(null)).to.equal(null)
    expect(toPipelineItemState({ libraryItemId: 'x', status: 'exploded' })).to.equal(null)
    expect(toPipelineItemState({ status: 'done' })).to.equal(null)
  })
})

describe('tabs and actions', () => {
  it('sorts statuses into tabs', () => {
    expect(getPipelineTab('waiting')).to.equal('queue')
    expect(getPipelineTab('epub')).to.equal('queue')
    expect(getPipelineTab('needs-review')).to.equal('review')
    expect(getPipelineTab('skipped')).to.equal('done')
    expect(getPipelineTab('failed')).to.equal('failed')
    expect(countPipelineTabs([state(), state({ status: 'done' }), state({ status: 'failed' })])).to.deep.equal({ queue: 1, review: 0, done: 1, failed: 1 })
  })

  it('tells chapter reviews from match reviews', () => {
    const chaptersReview = { result: 'needs-review', source: 'aligned', diffSec: 1, applied: false, needsReview: [], backup: null }
    const matchReview = { result: 'needs-review', confidence: 81, asin: null, candidates: [] }
    // A finished review has no step any more; the step results tell which one stopped
    expect(hasPipelineChapterReview(state({ status: 'needs-review', chapters: chaptersReview }))).to.equal(true)
    expect(hasPipelineMatchReview(state({ status: 'needs-review', chapters: chaptersReview, match: { ...matchReview, result: 'matched' } }))).to.equal(false)
    expect(hasPipelineMatchReview(state({ status: 'needs-review', match: matchReview, reason: 'match: low-confidence' }))).to.equal(true)
    expect(hasPipelineChapterReview(state({ status: 'needs-review', match: matchReview }))).to.equal(false)
    expect(hasPipelineMatchReview(state({ status: 'failed', step: 'matching' }))).to.equal(true)
    expect(hasPipelineChapterReview(state({ status: 'done', chapters: { ...chaptersReview, result: 'applied' } }))).to.equal(false)
  })

  it('recognises a dismissal event and the worker item', () => {
    expect(getDismissedPipelineItemId({ libraryItemId: 'li_1', libraryId: 'lib_1', status: 'dismissed' })).to.equal('li_1')
    expect(getDismissedPipelineItemId(state())).to.equal(null)
    expect(getPipelineWorkerItemId(state({ libraryItemId: 'li_9' }))).to.equal('li_9')
    expect(getPipelineWorkerItemId('li_8')).to.equal('li_8')
    expect(getPipelineWorkerItemId(null)).to.equal(null)
  })

  it('only offers undo for chapters that were applied for real', () => {
    const applied = { result: 'applied', source: 'aligned', diffSec: 0, applied: true, needsReview: [], backup: 'b' }
    expect(canUndoPipelineChapters(state({ status: 'done', chapters: applied }))).to.equal(true)
    expect(canUndoPipelineChapters(state({ status: 'done', dryRun: true, chapters: applied }))).to.equal(false)
    expect(canUndoPipelineChapters(state({ status: 'done' }))).to.equal(false)
    expect(canUndoPipelineChapters(state({ status: 'done', chapters: { ...applied, applied: false, result: 'approved' } }))).to.equal(true)
  })

  it('replaces an item in place and ignores other libraries', () => {
    const items = [state({ libraryItemId: 'a' }), state({ libraryItemId: 'b' })]
    const next = upsertPipelineItem(items, state({ libraryItemId: 'a', status: 'done' }), 'lib_1')
    expect(next.map((item) => [item.libraryItemId, item.status])).to.deep.equal([
      ['a', 'done'],
      ['b', 'queued']
    ])
    expect(upsertPipelineItem(items, state({ libraryItemId: 'c', libraryId: 'lib_2' }), 'lib_1')).to.equal(items)
    expect(upsertPipelineItem(items, state({ libraryItemId: 'c' }), 'lib_1')).to.have.length(3)
  })

  it('reports the match confidence as a percent', () => {
    expect(getPipelineMatchPercent(state({ match: { result: 'matched', confidence: 97, asin: 'B0', candidates: [] } }))).to.equal(97)
    expect(getPipelineMatchPercent(state({ match: { result: 'matched', confidence: 0.965, asin: 'B0', candidates: [] } }))).to.equal(97)
    expect(getPipelineMatchPercent(state())).to.equal(null)
  })

  it('lists dry-run results only for dry runs', () => {
    const wouldMatch = { result: 'matched', confidence: 97, asin: 'B0', candidates: [], would: 'would match B0 at 97 %' }
    expect(getPipelineWouldLines(state({ dryRun: true, match: wouldMatch }))).to.deep.equal(['would match B0 at 97 %'])
    expect(getPipelineWouldLines(state({ match: wouldMatch }))).to.deep.equal([])
    expect(getPipelineWouldLines(state({ dryRun: true, match: wouldMatch, would: 'would match B0 at 97 %; would apply 12 chapters' }))).to.deep.equal([
      'would match B0 at 97 %',
      'would apply 12 chapters'
    ])
  })
})

describe('pipeline proposal', () => {
  const snap = {
    libraryItemId: 'li_1',
    duration: 100,
    complete: true,
    options: { windowSec: 25, minSilenceSec: 0.7, noiseDb: -38, leadSec: 0.3, headingLookbackSec: 3, snapToFileStart: true, verify: true },
    stats: {},
    chapters: [
      { index: 0, id: 0, title: 'Opening', originalStart: 0, proposedStart: 0, delta: 0, changed: false, reason: 'first', confidence: 'none', speech: null },
      { index: 1, id: 1, title: 'Chapter 1', originalStart: 30, proposedStart: 31.5, delta: 1.5, changed: true, reason: 'snapped', confidence: 'high', speech: null }
    ],
    proposedChapters: [
      { id: 0, start: 0, end: 31.5, title: 'Opening' },
      { id: 1, start: 31.5, end: 100, title: 'Chapter 1' }
    ],
    warnings: []
  } as unknown as SnapChaptersResponse
  const proposal: PipelineProposal = { source: 'aligned', diffSec: 1, snap, failing: [{ index: 1, why: 'late' }] }

  it('takes the snap proposedChapters when the proposal has none of its own', () => {
    expect(getPipelineProposalChapters(proposal)).to.deep.equal(snap.proposedChapters)
    expect(getPipelineProposalChapters({ ...proposal, proposedChapters: [{ id: 0, start: 0, end: 100, title: 'All' }] })).to.have.length(1)
  })

  it('builds a snap panel session on the pre-snap starts with the editor row keys', () => {
    const session = buildPipelineProposalSession(proposal, [
      { clientKey: 'k0', title: 'Opening' },
      { clientKey: 'k1', title: 'Chapter 1' }
    ])
    expect(session?.snapshot).to.deep.equal([
      { clientKey: 'k0', start: 0, title: 'Opening' },
      { clientKey: 'k1', start: 30, title: 'Chapter 1' }
    ])
    expect(session?.options).to.deep.equal({ windowSec: 25, minSilenceSec: 0.7, noiseDb: -38, headingLookbackSec: 3, verify: true })
    expect(session?.response).to.equal(snap)
  })

  it('gives no session when the rows do not line up', () => {
    expect(buildPipelineProposalSession(proposal, [{ clientKey: 'k0' }])).to.equal(null)
  })
})
