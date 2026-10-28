import {
  canCancelEpubJob,
  canMakeEpubFromAudio,
  forgetEpubJob,
  getEpubJobPercent,
  getEpubRequestErrorToast,
  isEpubJobActive,
  parseEpubConflictJobId,
  recallEpubJob,
  rememberEpubJob,
  toEpubJob
} from '@/lib/epubFromAudio'
import type { EpubJob, LibraryItem } from '@/types/api'

const job = (partial: Partial<EpubJob> = {}): EpubJob => ({
  jobId: 'job-1',
  libraryItemId: 'li_1',
  status: 'running',
  stage: 'transcribing',
  progress: 0.25,
  chaptersDone: 3,
  chaptersTotal: 12,
  cancelRequested: false,
  error: null,
  fileName: null,
  createdAt: 1,
  finishedAt: null,
  ...partial
})

describe('EPUB job state', () => {
  it('is active until the server is done with it', () => {
    expect(isEpubJobActive(job({ status: 'queued' }))).to.equal(true)
    expect(isEpubJobActive(job({ status: 'running' }))).to.equal(true)
    expect(isEpubJobActive(job({ status: 'downloading' }))).to.equal(true)
    expect(isEpubJobActive(job({ status: 'done' }))).to.equal(false)
    expect(isEpubJobActive(job({ status: 'failed' }))).to.equal(false)
    expect(isEpubJobActive(job({ status: 'cancelled' }))).to.equal(false)
    expect(isEpubJobActive(null)).to.equal(false)
  })

  it('can be cancelled once, while queued or running', () => {
    expect(canCancelEpubJob(job({ status: 'queued' }))).to.equal(true)
    expect(canCancelEpubJob(job({ status: 'running' }))).to.equal(true)
    expect(canCancelEpubJob(job({ status: 'running', cancelRequested: true }))).to.equal(false)
    expect(canCancelEpubJob(job({ status: 'downloading' }))).to.equal(false)
  })

  it('reports progress as a clamped percentage', () => {
    expect(getEpubJobPercent(job({ progress: 0.254 }))).to.equal(25)
    expect(getEpubJobPercent(job({ progress: 3 }))).to.equal(100)
    expect(getEpubJobPercent(job({ progress: NaN }))).to.equal(0)
  })
})

describe('toEpubJob', () => {
  it('accepts a server job record', () => {
    expect(toEpubJob(job())).to.deep.equal(job())
  })

  it('rejects anything else', () => {
    expect(toEpubJob(null)).to.equal(null)
    expect(toEpubJob({ jobId: 'x' })).to.equal(null)
    expect(toEpubJob({ ...job(), status: 'exploded' })).to.equal(null)
    expect(toEpubJob({ ...job(), jobId: '' })).to.equal(null)
  })

  it('fills missing optional fields', () => {
    expect(toEpubJob({ jobId: 'j', libraryItemId: 'li', status: 'queued' })).to.deep.include({ progress: 0, stage: null, error: null, cancelRequested: false })
  })
})

describe('parseEpubConflictJobId', () => {
  it('reads the running job id from a 409 body', () => {
    expect(parseEpubConflictJobId('{"error":"An EPUB job is already running for this item","jobId":"job-7"}')).to.equal('job-7')
    expect(parseEpubConflictJobId('{"error":"busy"}')).to.equal(null)
    expect(parseEpubConflictJobId('Conflict')).to.equal(null)
  })
})

describe('canMakeEpubFromAudio', () => {
  const book = (partial: Record<string, unknown> = {}) =>
    ({
      id: 'li_1',
      mediaType: 'book',
      isFile: false,
      isMissing: false,
      media: { audioFiles: [{ index: 1 }], tracks: [{ index: 1 }], chapters: [] },
      ...partial
    }) as unknown as LibraryItem

  it('needs a book with audio in its own folder', () => {
    expect(canMakeEpubFromAudio(book())).to.equal(true)
    expect(canMakeEpubFromAudio(book({ isFile: true }))).to.equal(false)
    expect(canMakeEpubFromAudio(book({ isMissing: true }))).to.equal(false)
    expect(canMakeEpubFromAudio(book({ media: { audioFiles: [], tracks: [] } }))).to.equal(false)
    expect(canMakeEpubFromAudio(book({ mediaType: 'podcast' }))).to.equal(false)
  })
})

describe('getEpubRequestErrorToast', () => {
  it('explains forbidden, busy and server errors', () => {
    expect(getEpubRequestErrorToast({ ok: false, status: 403, error: 'Forbidden' }, 'start').key).to.equal('ToastEpubFromAudioForbidden')
    expect(getEpubRequestErrorToast({ ok: false, status: 429, error: 'x' }, 'start')).to.deep.equal({ key: 'ToastEpubFromAudioBusy', type: 'warning' })
    expect(getEpubRequestErrorToast({ ok: false, status: 400, error: 'Item is not a book with audio tracks' }, 'start')).to.deep.equal({
      key: 'ToastEpubFromAudioStartFailedWithError',
      values: { error: 'Item is not a book with audio tracks' },
      type: 'error'
    })
    expect(getEpubRequestErrorToast({ ok: false, status: 0, error: '' }, 'cancel')).to.deep.equal({ key: 'ToastEpubFromAudioCancelFailed', type: 'error' })
  })
})

describe('remembered EPUB jobs', () => {
  it('remembers, recalls and forgets the job id per item', () => {
    forgetEpubJob('li_test')
    expect(recallEpubJob('li_test')).to.equal(null)
    rememberEpubJob('li_test', 'job-9')
    expect(recallEpubJob('li_test')).to.equal('job-9')
    forgetEpubJob('li_test')
    expect(recallEpubJob('li_test')).to.equal(null)
  })
})
