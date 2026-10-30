import { findCueIndex, parseTranscriptContent, pickDefaultTranscript, transcriptUrl, type TranscriptInfo } from '@/lib/transcripts'

describe('lib/transcripts', () => {
  const cues = [
    { start: 1, end: 2, text: 'a' },
    { start: 3, end: 4, text: 'b' },
    { start: 10, end: 11, text: 'c' }
  ]

  it('finds the cue being spoken (the previous one during a pause)', () => {
    expect(findCueIndex(cues, 0)).to.equal(-1)
    expect(findCueIndex(cues, 1)).to.equal(0)
    expect(findCueIndex(cues, 2.5)).to.equal(0)
    expect(findCueIndex(cues, 3.5)).to.equal(1)
    expect(findCueIndex(cues, 9)).to.equal(1)
    expect(findCueIndex(cues, 1000)).to.equal(2)
    expect(findCueIndex([], 5)).to.equal(-1)
  })

  it('parses the json format and drops malformed cues', () => {
    const parsed = parseTranscriptContent({
      id: 'generated',
      source: 'generated',
      format: 'vtt',
      timed: true,
      cues: [{ start: 5, end: 6, text: 'z' }, { start: 'x' }, { start: 1, end: 2, text: 'y', speaker: 'S' }]
    })
    expect(parsed).to.deep.equal({
      id: 'generated',
      source: 'generated',
      format: 'vtt',
      timed: true,
      cues: [
        { start: 1, end: 2, text: 'y', speaker: 'S' },
        { start: 5, end: 6, text: 'z' }
      ]
    })
    expect(parseTranscriptContent({ id: 'feed-0', source: 'feed', format: 'html', timed: false, text: 'hi' })).to.deep.equal({
      id: 'feed-0',
      source: 'feed',
      format: 'html',
      timed: false,
      text: 'hi'
    })
    expect(parseTranscriptContent(null)).to.equal(null)
    expect(parseTranscriptContent({ id: 'x', timed: true })).to.equal(null)
  })

  it('builds proxy URLs and picks the default transcript', () => {
    expect(transcriptUrl('li 1', 'feed-0', 'ep/1', 'vtt')).to.match(/\/internal-api\/items\/li%201\/transcripts\/feed-0\?episodeId=ep%2F1&format=vtt$/)
    const info = (id: string, timed: boolean): TranscriptInfo => ({
      id,
      timed,
      source: 'feed',
      format: timed ? 'vtt' : 'html',
      mimeType: '',
      language: null,
      rel: null,
      url: null,
      downloaded: false,
      updatedAt: null,
      model: null
    })
    const base = { libraryItemId: 'li', episodeId: null, canGenerate: false, job: null }
    expect(pickDefaultTranscript({ ...base, transcripts: [info('a', false), info('b', true)], preferredId: 'b' })?.id).to.equal('b')
    expect(pickDefaultTranscript({ ...base, transcripts: [info('a', false), info('b', true)], preferredId: null })?.id).to.equal('b')
    expect(pickDefaultTranscript({ ...base, transcripts: [], preferredId: null })).to.equal(null)
  })
})
