import TranscriptPanel, { type TranscriptPanelProps } from '@/components/widgets/transcripts/TranscriptPanel'
import type { TranscriptInfo, TranscriptJob, TranscriptList } from '@/lib/transcripts'

const feed: TranscriptInfo = {
  id: 'feed-0',
  source: 'feed',
  format: 'vtt',
  mimeType: 'text/vtt',
  timed: true,
  language: 'en',
  rel: 'captions',
  url: 'https://example.com/ep1.vtt',
  downloaded: false,
  updatedAt: null,
  model: null
}
const generated: TranscriptInfo = {
  id: 'generated',
  source: 'generated',
  format: 'vtt',
  mimeType: 'text/vtt',
  timed: true,
  language: null,
  rel: 'captions',
  url: null,
  downloaded: true,
  updatedAt: 1,
  model: 'small.en',
  generatedFrom: 'transcribe'
}

function job(overrides: Partial<TranscriptJob>): TranscriptJob {
  return {
    libraryItemId: 'li_1',
    episodeId: null,
    origin: 'user',
    method: 'auto',
    status: 'running',
    progress: 0,
    error: null,
    generatedFrom: null,
    createdAt: 1,
    startedAt: 2,
    finishedAt: null,
    ...overrides
  }
}

function list(transcripts: TranscriptInfo[], extra: Partial<TranscriptList> = {}): TranscriptList {
  return { libraryItemId: 'li_1', episodeId: null, transcripts, preferredId: transcripts[0]?.id ?? null, canGenerate: true, job: null, ...extra }
}

function mountPanel(overrides: Partial<TranscriptPanelProps> = {}) {
  const props: TranscriptPanelProps = {
    libraryItemId: 'li_1',
    episodeId: null,
    list: list([]),
    status: 'ready',
    isPodcast: false,
    isAdmin: true,
    generateAvailable: true,
    onGenerate: cy.stub().as('onGenerate'),
    onCancel: cy.stub().as('onCancel'),
    onDelete: cy.stub().as('onDelete'),
    onRefreshFeed: cy.stub().as('onRefreshFeed'),
    onView: cy.stub().as('onView'),
    ...overrides
  }
  cy.mount(<TranscriptPanel {...props} />)
}

describe('<TranscriptPanel />', () => {
  it('says there is none yet and offers Generate to admins', () => {
    mountPanel()
    cy.get('[cy-id="transcript-empty"]').should('contain.text', 'No transcript yet')
    cy.contains('button', 'Generate transcript').click()
    cy.get('@onGenerate').should('have.been.calledOnce')
    cy.contains('button', 'Delete generated transcript').should('not.exist')
    cy.contains('button', 'Check feed').should('not.exist')
  })

  it('lists creator and generated transcripts with downloads, and Generate again / Delete', () => {
    mountPanel({ list: list([feed, generated]), isPodcast: true, episodeId: 'ep_1' })
    cy.get('[cy-id="transcript-row-feed-0"]').should('contain.text', 'From the creator').and('contain.text', 'VTT').and('contain.text', 'en')
    cy.get('[cy-id="transcript-row-generated"]').should('contain.text', 'Generated').and('contain.text', 'Model small.en')
    cy.get('[cy-id="transcript-row-feed-0"] [cy-id="transcript-download"]')
      .should('have.attr', 'href')
      .and('include', '/internal-api/items/li_1/transcripts/feed-0?episodeId=ep_1&format=original')
    cy.get('[cy-id="transcript-row-generated"]').contains('button', 'Open').click()
    cy.get('@onView').should('have.been.calledWith', generated)
    cy.contains('button', 'Generate again').should('exist')
    cy.contains('button', 'Delete generated transcript').click()
    cy.get('@onDelete').should('have.been.calledOnce')
    cy.contains('button', 'Check feed for transcripts').click()
    cy.get('@onRefreshFeed').should('have.been.calledOnce')
  })

  it('labels a transcript made from the read-along EPUB', () => {
    mountPanel({ list: list([{ ...generated, generatedFrom: 'readalong' }]) })
    cy.get('[cy-id="transcript-row-generated"]').should('contain.text', 'From the EPUB made from the audio')
  })

  it('shows a running job with its progress and Cancel instead of Generate', () => {
    mountPanel({ job: job({ progress: 0.42 }) })
    cy.get('[cy-id="transcript-job"]').should('contain.text', 'Transcribing').and('contain.text', '42%')
    cy.contains('button', 'Generate').should('not.exist')
    cy.contains('button', 'Cancel').click()
    cy.get('@onCancel').should('have.been.calledOnce')
  })

  it('shows a queued job as waiting', () => {
    mountPanel({ list: list([], { job: job({ status: 'queued' }) }) })
    cy.get('[cy-id="transcript-job"]').should('contain.text', 'Waiting to transcribe')
  })

  it('shows why the last job failed', () => {
    mountPanel({ list: list([], { job: job({ status: 'failed', error: 'Chapterbot could not transcribe the audio (timeout)', finishedAt: 3 }) }) })
    cy.get('[cy-id="transcript-job-error"]').should('contain.text', 'Chapterbot could not transcribe the audio (timeout)')
    cy.contains('button', 'Generate transcript').should('exist')
  })

  it('offers no admin actions to listeners', () => {
    mountPanel({ list: list([feed]), isAdmin: false, isPodcast: true })
    cy.get('[cy-id="transcript-row-feed-0"]').should('exist')
    cy.contains('button', 'Generate').should('not.exist')
    cy.contains('button', 'Delete').should('not.exist')
    cy.contains('button', 'Check feed').should('not.exist')
  })

  it('offers no Generate when the server cannot generate', () => {
    mountPanel({ generateAvailable: false })
    cy.get('[cy-id="transcript-empty"]').should('exist')
    cy.contains('button', 'Generate').should('not.exist')
    mountPanel({ list: list([], { canGenerate: false }) })
    cy.contains('button', 'Generate').should('not.exist')
  })
})
