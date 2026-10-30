import TranscriptView, { type TranscriptViewProps } from '@/components/widgets/transcripts/TranscriptView'
import type { TranscriptContent } from '@/lib/transcripts'
import { useState } from 'react'

const cues = Array.from({ length: 200 }, (_, i) => ({ start: i * 5, end: i * 5 + 4.5, text: `Line number ${i}`, ...(i === 0 ? { speaker: 'Host' } : {}) }))
const timed: TranscriptContent = { id: 'feed-0', source: 'feed', format: 'vtt', timed: true, cues }

function mountView(overrides: Partial<TranscriptViewProps> = {}) {
  const props: TranscriptViewProps = {
    content: timed,
    status: 'ready',
    currentTime: 0,
    onSeek: cy.stub().as('onSeek'),
    className: 'h-80',
    ...overrides
  }
  cy.mount(
    <div style={{ height: 320, display: 'flex', flexDirection: 'column' }}>
      <TranscriptView {...props} />
    </div>
  )
}

describe('<TranscriptView />', () => {
  it('highlights the cue being spoken, with the speaker', () => {
    mountView({ currentTime: 2 })
    cy.get('[data-cue-index="0"]').should('have.attr', 'data-active', 'true').and('have.attr', 'aria-current', 'true').and('contain.text', 'Host:')
    cy.get('[data-cue-index="1"]').should('have.attr', 'data-active', 'false')
    cy.get('[cy-id="transcript-cue"][data-active="true"]').should('have.length', 1)
  })

  it('moves the highlight as playback goes on and keeps it in view', () => {
    mountView({ currentTime: 600.2 })
    cy.get('[data-cue-index="120"]').should('have.attr', 'data-active', 'true')
    cy.get('[data-cue-index="0"]').should('have.attr', 'data-active', 'false')
    cy.get('[cy-id="transcript-cues"]').should(($list) => {
      const list = $list[0]
      const row = list.querySelector('[data-cue-index="120"]') as HTMLElement
      const listRect = list.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      expect(rowRect.top).to.be.at.least(listRect.top)
      expect(rowRect.bottom).to.be.at.most(listRect.bottom)
    })
  })

  it('follows a playing position from one cue to the next', () => {
    const Harness = () => {
      const [time, setTime] = useState(0)
      return (
        <div style={{ height: 320, display: 'flex', flexDirection: 'column' }}>
          <button type="button" cy-id="advance" onClick={() => setTime((value) => value + 5)}>
            advance
          </button>
          <TranscriptView content={timed} status="ready" currentTime={time} onSeek={() => {}} className="h-80" />
        </div>
      )
    }
    cy.mount(<Harness />)
    cy.get('[data-cue-index="0"]').should('have.attr', 'data-active', 'true')
    cy.get('[cy-id="advance"]').click()
    cy.get('[data-cue-index="1"]').should('have.attr', 'data-active', 'true')
    cy.get('[data-cue-index="0"]').should('have.attr', 'data-active', 'false').and('not.have.attr', 'aria-current')
  })

  it('keeps the previous cue during a pause and highlights nothing before the first one', () => {
    mountView({ currentTime: 4.8 })
    cy.get('[data-cue-index="0"]').should('have.attr', 'data-active', 'true')
    mountView({ content: { ...timed, cues: [{ start: 10, end: 12, text: 'Late start' }] }, currentTime: 3 })
    cy.get('[cy-id="transcript-cue"]').should('have.length', 1)
    cy.get('[cy-id="transcript-cue"][data-active="true"]').should('not.exist')
  })

  it('seeks when a cue is clicked', () => {
    mountView()
    cy.contains('[cy-id="transcript-cue"]', 'Line number 3').click()
    cy.get('@onSeek').should('have.been.calledOnceWith', 15)
  })

  it('pauses following when the user scrolls, and resumes on request', () => {
    mountView({ currentTime: 50 })
    cy.get('[cy-id="transcript-follow"]').should('not.exist')
    cy.get('[cy-id="transcript-cues"]').trigger('wheel', { deltaY: 300 })
    cy.get('[cy-id="transcript-follow"]').should('be.visible').click()
    cy.get('[cy-id="transcript-follow"]').should('not.exist')
  })

  it('shows an untimed transcript as text', () => {
    mountView({ content: { id: 'feed-1', source: 'feed', format: 'html', timed: false, text: 'Host: hello\nGuest: hi' } })
    cy.get('[cy-id="transcript-text"]').should('contain.text', 'No timings').and('contain.text', 'Guest: hi')
    cy.get('[cy-id="transcript-cue"]').should('not.exist')
  })

  it('reports a transcript that could not be loaded', () => {
    mountView({ content: null, status: 'error' })
    cy.get('[cy-id="transcript-error"]').should('contain.text', 'could not be loaded')
  })

  it('without onSeek the cues are not buttons', () => {
    mountView({ onSeek: undefined, currentTime: 7 })
    cy.get('[cy-id="transcript-cue"]').first().should('match', 'div')
    cy.get('[data-cue-index="1"]').should('have.attr', 'data-active', 'true')
  })
})
