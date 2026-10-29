import EpubFromAudio, { type EpubFromAudioActions, type EpubFromAudioProps } from '@/components/widgets/EpubFromAudio'
import { recallEpubJob, rememberEpubJob } from '@/lib/epubFromAudio'
import type { EpubJob } from '@/types/api'
import { useState } from 'react'

const ITEM_ID = 'li_epub'

const job = (partial: Partial<EpubJob> = {}): EpubJob => ({
  jobId: 'job-1',
  libraryItemId: ITEM_ID,
  status: 'queued',
  stage: null,
  progress: 0,
  chaptersDone: 0,
  chaptersTotal: 12,
  cancelRequested: false,
  error: null,
  fileName: null,
  createdAt: 1,
  finishedAt: null,
  ...partial
})

type HarnessProps = Omit<EpubFromAudioProps, 'confirmOpen' | 'onConfirmClose' | 'jobEvent'> & { pushEvent?: EpubJob }

/** Hosts the component like the item page does: a menu button opens the dialog, socket events arrive as props. */
function Harness({ pushEvent, ...props }: HarnessProps) {
  const [open, setOpen] = useState(false)
  const [event, setEvent] = useState<EpubJob | null>(null)
  return (
    <div>
      <button type="button" cy-id="open-epub" onClick={() => setOpen(true)}>
        open
      </button>
      {pushEvent && (
        <button type="button" cy-id="push-event" onClick={() => setEvent({ ...pushEvent })}>
          event
        </button>
      )}
      <EpubFromAudio {...props} confirmOpen={open} onConfirmClose={() => setOpen(false)} jobEvent={event} />
    </div>
  )
}

type MountOptions = {
  actions?: Partial<EpubFromAudioActions>
  pushEvent?: EpubJob
} & Partial<Pick<EpubFromAudioProps, 'currentJobAvailable' | 'canUpdate' | 'readyEbook' | 'onReadEbook'>>

function mountEpub({ actions = {}, pushEvent, ...rest }: MountOptions = {}) {
  const fullActions: EpubFromAudioActions = {
    start:
      actions.start ??
      cy
        .stub()
        .as('start')
        .resolves({ ok: true, data: { job: job({ status: 'running', progress: 0.25, chaptersDone: 3 }), alreadyRunning: false } }),
    get:
      actions.get ??
      cy
        .stub()
        .as('get')
        .resolves({ ok: true, data: job({ status: 'running', progress: 0.25, chaptersDone: 3 }) }),
    cancel:
      actions.cancel ??
      cy
        .stub()
        .as('cancel')
        .resolves({ ok: true, data: job({ status: 'cancelled' }) }),
    ...(actions.getCurrent ? { getCurrent: actions.getCurrent } : {})
  }
  cy.mount(
    <Harness
      libraryItemId={ITEM_ID}
      bookTitle="The Long Road"
      actions={fullActions}
      notify={cy.stub().as('notify')}
      onFinished={cy.stub().as('onFinished')}
      pollIntervalMs={50}
      pushEvent={pushEvent}
      {...rest}
    />
  )
}

function startJob() {
  cy.get('[cy-id="open-epub"]').click()
  cy.get('[role="dialog"]').contains('button', 'Make EPUB').click()
}

describe('<EpubFromAudio />', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('shows nothing until asked', () => {
    mountEpub()
    cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
    cy.get('[role="dialog"]').should('not.exist')
  })

  it('explains that it takes hours and adds an EPUB to the book folder', () => {
    mountEpub()
    cy.get('[cy-id="open-epub"]').click()
    cy.get('[role="dialog"]').should('contain.text', 'The Long Road').and('contain.text', 'hours').and('contain.text', "book's folder")
    cy.get('[role="dialog"]').contains('button', 'Cancel').click()
    cy.get('[role="dialog"]').should('not.exist')
    cy.get('@start').should('not.have.been.called')
  })

  it('starts the job and shows its progress', () => {
    mountEpub()
    startJob()
    cy.get('@start').should('have.been.calledOnceWith', ITEM_ID)
    cy.get('@notify').should('have.been.calledWith', 'EPUB from audio started. This takes hours.', 'info')
    cy.get('[cy-id="epub-from-audio-progress"]').should('contain.text', 'Making EPUB from audio').and('contain.text', '25%')
    cy.get('[cy-id="epub-from-audio-chapters"]').should('contain.text', '3 of 12 chapters')
    cy.then(() => expect(recallEpubJob(ITEM_ID)).to.equal('job-1'))
  })

  it('polls until done, then toasts, refreshes the item and clears the progress', () => {
    const get = cy.stub().as('get')
    get.onCall(0).resolves({ ok: true, data: job({ status: 'running', progress: 0.6, chaptersDone: 7 }) })
    get.onCall(1).resolves({ ok: true, data: job({ status: 'downloading', progress: 1, chaptersDone: 12 }) })
    get.resolves({ ok: true, data: job({ status: 'done', progress: 1, chaptersDone: 12, fileName: 'The Long Road (from audio).epub' }) })
    mountEpub({ actions: { get } })
    startJob()
    cy.get('[cy-id="epub-from-audio-progress"]').should('contain.text', '60%')
    cy.get('[cy-id="epub-from-audio-progress"]').should('have.attr', 'data-status', 'downloading').and('contain.text', 'Saving the EPUB')
    cy.get('[cy-id="epub-from-audio-progress"]').contains('button', 'Cancel').should('exist')
    cy.get('@notify').should('have.been.calledWith', 'EPUB created: The Long Road (from audio).epub', 'success')
    cy.get('@onFinished').should('have.been.calledOnce')
    cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
    cy.then(() => expect(recallEpubJob(ITEM_ID)).to.equal(null))
  })

  it('cancels a running job', () => {
    mountEpub({
      actions: {
        get: cy
          .stub()
          .as('get')
          .resolves({ ok: true, data: job({ status: 'running', progress: 0.25 }) })
      }
    })
    startJob()
    cy.get('[cy-id="epub-from-audio-progress"]').contains('button', 'Cancel').click()
    cy.get('@cancel').should('have.been.calledOnceWith', ITEM_ID, 'job-1')
    cy.get('@notify').should('have.been.calledWith', 'EPUB from audio cancelled', 'info')
    cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
    cy.get('@onFinished').should('not.have.been.called')
  })

  it('waits for a running job to stop after cancel is requested', () => {
    const running = job({ status: 'running', progress: 0.25, cancelRequested: true })
    mountEpub({
      actions: {
        cancel: cy.stub().as('cancel').resolves({ ok: true, data: running }),
        get: cy
          .stub()
          .as('get')
          .resolves({ ok: true, data: job({ status: 'running', progress: 0.25 }) })
      }
    })
    startJob()
    cy.get('[cy-id="epub-from-audio-progress"]').contains('button', 'Cancel').click()
    cy.get('[cy-id="epub-from-audio-progress"]').should('contain.text', 'Cancelling')
    cy.get('[cy-id="epub-from-audio-progress"]').contains('button', 'Cancel').should('be.disabled')
  })

  it('reports a failure pushed by the server', () => {
    mountEpub({
      actions: { get: cy.stub().resolves({ ok: true, data: job({ status: 'running' }) }) },
      pushEvent: job({ status: 'failed', error: 'Chapterbot: out of disk space' })
    })
    startJob()
    cy.get('[cy-id="epub-from-audio-progress"]').should('exist')
    cy.get('[cy-id="push-event"]').click()
    cy.get('@notify').should('have.been.calledWith', 'Making the EPUB failed: Chapterbot: out of disk space', 'error')
    cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
  })

  it('ignores server events for another job', () => {
    mountEpub({
      actions: { get: cy.stub().resolves({ ok: true, data: job({ status: 'running' }) }) },
      pushEvent: job({ jobId: 'other-job', status: 'done', fileName: 'x.epub' })
    })
    startJob()
    cy.get('[cy-id="push-event"]').click()
    cy.get('[cy-id="epub-from-audio-progress"]').should('exist')
    cy.get('@onFinished').should('not.have.been.called')
  })

  it('follows the job that is already running', () => {
    mountEpub({
      actions: {
        start: cy
          .stub()
          .as('start')
          .resolves({ ok: true, data: { job: job({ jobId: 'job-7', status: 'running', progress: 0.4 }), alreadyRunning: true } })
      }
    })
    startJob()
    cy.get('@notify').should('have.been.calledWith', 'An EPUB is already being made for this book', 'info')
    cy.get('[cy-id="epub-from-audio-progress"]').should('exist')
  })

  it('explains a failed start and shows no progress', () => {
    mountEpub({ actions: { start: cy.stub().as('start').resolves({ ok: false, status: 429, error: 'too many' }) } })
    startJob()
    cy.get('@notify').should('have.been.calledWith', 'The server already has too many EPUBs queued. Try again later.', 'warning')
    cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
  })

  it('picks up a job started earlier in this browser', () => {
    rememberEpubJob(ITEM_ID, 'job-3')
    mountEpub({
      actions: {
        get: cy
          .stub()
          .as('get')
          .resolves({ ok: true, data: job({ jobId: 'job-3', status: 'running', progress: 0.8 }) })
      }
    })
    cy.get('@get').should('have.been.calledWith', ITEM_ID, 'job-3')
    cy.get('[cy-id="epub-from-audio-progress"]').should('contain.text', '80%')
  })

  it('forgets a remembered job the server no longer has', () => {
    rememberEpubJob(ITEM_ID, 'job-3')
    mountEpub({ actions: { get: cy.stub().as('get').resolves({ ok: false, status: 404, error: 'No such EPUB job' }) } })
    cy.get('@get').should('have.been.called')
    cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
    cy.then(() => expect(recallEpubJob(ITEM_ID)).to.equal(null))
  })

  describe('current job from the server (chapterbotEpubCurrent)', () => {
    it('shows the job on a device that never started it (no localStorage)', () => {
      const getCurrent = cy
        .stub()
        .as('getCurrent')
        .resolves({ ok: true, data: job({ jobId: 'job-9', status: 'running', progress: 0.42, chaptersDone: 5, origin: 'pipeline' }) })
      mountEpub({ actions: { getCurrent }, currentJobAvailable: true })
      cy.get('@getCurrent').should('have.been.calledOnceWith', ITEM_ID)
      cy.get('[cy-id="epub-from-audio-progress"]').should('contain.text', '42%')
      cy.get('[cy-id="epub-from-audio-chapters"]').should('contain.text', '5 of 12 chapters')
      cy.get('@get').should('not.have.been.called')
    })

    it('shows the progress without a Cancel button to viewers who cannot update', () => {
      mountEpub({
        actions: { getCurrent: cy.stub().resolves({ ok: true, data: job({ status: 'running', progress: 0.1 }) }) },
        currentJobAvailable: true,
        canUpdate: false
      })
      cy.get('[cy-id="epub-from-audio-progress"]').should('contain.text', '10%')
      cy.get('[cy-id="epub-from-audio-progress"]').find('button').should('not.exist')
    })

    it('polls the current job and reports when it is done', () => {
      const getCurrent = cy.stub().as('getCurrent')
      getCurrent.onCall(0).resolves({ ok: true, data: job({ status: 'running', progress: 0.5 }) })
      getCurrent.resolves({ ok: true, data: job({ status: 'done', progress: 1, fileName: 'The Long Road (from audio).epub' }) })
      mountEpub({ actions: { getCurrent }, currentJobAvailable: true })
      cy.get('@notify').should('have.been.calledWith', 'EPUB created: The Long Road (from audio).epub', 'success')
      cy.get('@onFinished').should('have.been.calledOnce')
      cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
      cy.get('[cy-id="epub-from-audio-ready"]').should('contain.text', 'EPUB ready').and('contain.text', 'The Long Road (from audio).epub')
      cy.get('@get').should('not.have.been.called')
    })

    it('falls back to the job remembered in this browser when the server has none', () => {
      rememberEpubJob(ITEM_ID, 'job-3')
      mountEpub({
        actions: {
          getCurrent: cy.stub().as('getCurrent').resolves({ ok: false, status: 404, error: 'No EPUB job' }),
          get: cy
            .stub()
            .as('get')
            .resolves({ ok: true, data: job({ jobId: 'job-3', status: 'running', progress: 0.3 }) })
        },
        currentJobAvailable: true
      })
      cy.get('@getCurrent').should('have.been.called')
      cy.get('@get').should('have.been.calledWith', ITEM_ID, 'job-3')
      cy.get('[cy-id="epub-from-audio-progress"]').should('contain.text', '30%')
    })

    it('shows nothing when the latest job already ended', () => {
      mountEpub({
        actions: { getCurrent: cy.stub().as('getCurrent').resolves({ ok: true, data: job({ status: 'failed', error: 'x' }) }) },
        currentJobAvailable: true
      })
      cy.get('@getCurrent').should('have.been.called')
      cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
      cy.get('@notify').should('not.have.been.called')
    })
  })

  it('picks up a job someone else started from a progress broadcast', () => {
    mountEpub({ pushEvent: job({ jobId: 'job-5', status: 'running', progress: 0.7 }), canUpdate: false })
    cy.get('[cy-id="epub-from-audio-progress"]').should('not.exist')
    cy.get('[cy-id="push-event"]').click()
    cy.get('[cy-id="epub-from-audio-progress"]').should('contain.text', '70%')
  })

  it('shows "EPUB ready" with a Read button when the book has an EPUB from audio', () => {
    mountEpub({ readyEbook: { fileName: 'The Long Road (from audio).epub' }, onReadEbook: cy.stub().as('read') })
    cy.get('[cy-id="epub-from-audio-ready"]').should('contain.text', 'EPUB ready').contains('button', 'Read').click()
    cy.get('@read').should('have.been.calledOnce')
  })
})
