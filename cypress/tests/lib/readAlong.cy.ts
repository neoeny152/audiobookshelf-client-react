import {
  durationMatches,
  findSentence,
  matchesBook,
  parseReadAlong,
  READ_ALONG_LEAD_SEC,
  sentenceFraction,
  wordIndexAt,
  type ReadAlongMap
} from '@/lib/ereader/readAlong'
import fixture from '../../fixtures/readalong/readalong.json'

type Json = Record<string, unknown>

function clone(): Json {
  return JSON.parse(JSON.stringify(fixture)) as Json
}

function withSentences(sentences: unknown[]): Json {
  return { ...clone(), sentences }
}

function parsed(json: unknown = fixture): ReadAlongMap {
  const map = parseReadAlong(json)
  expect(map, 'expected the read-along data to parse').to.not.equal(null)
  return map!
}

describe('parseReadAlong', () => {
  it('parses the fixture into typed arrays', () => {
    const map = parsed()
    expect(map.identifier).to.equal('urn:uuid:5b1c0f2e-7d1a-5b8e-9a43-2f6c1d0e9b77')
    expect(map.modified).to.equal('2026-10-28T12:34:56Z')
    expect(map.audioDuration).to.equal(40)
    expect(map.sections.map((s) => s.href)).to.deep.equal(['OEBPS/ch001.xhtml', 'OEBPS/ch002.xhtml'])
    expect(map.ids).to.have.length(9)
    expect(map.starts).to.be.instanceOf(Float64Array)
    expect(map.starts[3]).to.equal(9)
    expect(map.ends[3]).to.equal(11)
    expect(Array.from(map.sec)).to.deep.equal([0, 0, 0, 0, 0, 0, 1, 1, 1])
    expect(map.w[0]).to.equal(null)
    expect(map.w[7]).to.have.length(5)
    expect(map.indexById.get('s8')).to.equal(7)
  })

  it('accepts data without the optional fields', () => {
    const json = clone()
    delete json.audioDuration
    delete json.model
    delete json.epubFile
    delete json.timeline
    expect(parsed(json).audioDuration).to.equal(null)
  })

  it('rejects other kinds, newer versions and non-objects', () => {
    expect(parseReadAlong(null)).to.equal(null)
    expect(parseReadAlong('x')).to.equal(null)
    expect(parseReadAlong({ ...clone(), kind: 'other' })).to.equal(null)
    expect(parseReadAlong({ ...clone(), version: 2 })).to.equal(null)
    expect(parseReadAlong({ ...clone(), identifier: 5 })).to.equal(null)
    expect(parseReadAlong({ ...clone(), modified: undefined })).to.equal(null)
    expect(parseReadAlong({ ...clone(), timeline: 'file' })).to.equal(null)
  })

  it('rejects bad sections', () => {
    expect(parseReadAlong({ ...clone(), sections: [{ href: '../../etc/passwd?x' }] })).to.equal(null)
    expect(parseReadAlong({ ...clone(), sections: 'OEBPS/ch001.xhtml' })).to.equal(null)
  })

  it('rejects bad or duplicate ids, sec out of range, bad times and unsorted starts', () => {
    expect(parseReadAlong(withSentences([{ id: 's0', sec: 0, start: 1, end: 2 }]))).to.equal(null)
    expect(parseReadAlong(withSentences([{ id: 'x1', sec: 0, start: 1, end: 2 }]))).to.equal(null)
    expect(
      parseReadAlong(
        withSentences([
          { id: 's1', sec: 0, start: 1, end: 2 },
          { id: 's1', sec: 0, start: 2, end: 3 }
        ])
      )
    ).to.equal(null)
    expect(parseReadAlong(withSentences([{ id: 's1', sec: 2, start: 1, end: 2 }]))).to.equal(null)
    expect(parseReadAlong(withSentences([{ id: 's1', sec: 0, start: 1, end: 0.5 }]))).to.equal(null)
    expect(parseReadAlong(withSentences([{ id: 's1', sec: 0, start: 'a', end: 2 }]))).to.equal(null)
    expect(
      parseReadAlong(
        withSentences([
          { id: 's1', sec: 0, start: 5, end: 6 },
          { id: 's2', sec: 0, start: 4, end: 6 }
        ])
      )
    ).to.equal(null)
    expect(parseReadAlong(withSentences([{ id: 's1', sec: 0, start: 1, end: 2, w: [[1, 'x']] }]))).to.equal(null)
  })

  it('rejects more than 200k sentences', () => {
    const sentences = Array.from({ length: 200_001 }, (_, i) => ({ id: `s${i + 1}`, sec: 0, start: i, end: i }))
    expect(parseReadAlong(withSentences(sentences))).to.equal(null)
  })
})

describe('findSentence', () => {
  const map = parsed()

  it('is -1 before the first sentence', () => {
    expect(findSentence(map, 0)).to.equal(-1)
    expect(findSentence(map, 1 - READ_ALONG_LEAD_SEC - 0.01)).to.equal(-1)
  })

  it('finds a sentence at its exact start and with the lead offset', () => {
    expect(findSentence(map, 1)).to.equal(0)
    expect(findSentence(map, 3.1)).to.equal(1)
    // 0.15 s before s2 starts already highlights s2
    expect(findSentence(map, 3.1 - READ_ALONG_LEAD_SEC)).to.equal(1)
    expect(findSentence(map, 3.1 - READ_ALONG_LEAD_SEC - 0.02)).to.equal(0)
  })

  it('keeps the previous sentence through a pause', () => {
    // s3 ends at 7, s4 starts at 9
    expect(findSentence(map, 8)).to.equal(2)
    expect(findSentence(map, 8.8)).to.equal(2)
  })

  it('is -1 past the end plus grace when the next sentence has not started', () => {
    // s6 ends at 15, s7 starts at 20
    expect(findSentence(map, 16.9)).to.equal(5)
    expect(findSentence(map, 17.1)).to.equal(-1)
    expect(findSentence(map, 19)).to.equal(-1)
    expect(findSentence(map, 20)).to.equal(6)
    expect(findSentence(map, 30)).to.equal(-1)
    expect(findSentence(map, 17.1, 5)).to.equal(5)
  })

  it('handles a single sentence and duplicate starts', () => {
    const single = parsed(withSentences([{ id: 's1', sec: 0, start: 2, end: 4 }]))
    expect(findSentence(single, 1)).to.equal(-1)
    expect(findSentence(single, 3)).to.equal(0)
    expect(findSentence(single, 7)).to.equal(-1)

    const dup = parsed(
      withSentences([
        { id: 's1', sec: 0, start: 2, end: 2 },
        { id: 's2', sec: 0, start: 2, end: 4 },
        { id: 's3', sec: 0, start: 5, end: 6 }
      ])
    )
    // the last of equal starts wins
    expect(findSentence(dup, 2)).to.equal(1)
    expect(findSentence(dup, 3)).to.equal(1)
  })

  it('is -1 for non-finite times or an empty map', () => {
    expect(findSentence(map, Number.NaN)).to.equal(-1)
    expect(findSentence(parsed(withSentences([])), 3)).to.equal(-1)
  })
})

describe('matchesBook / durationMatches', () => {
  const map = parsed()

  it('matches only the exact build', () => {
    expect(matchesBook(map, { identifier: map.identifier, modified: map.modified })).to.equal(true)
    expect(matchesBook(map, { identifier: map.identifier, modified: '2026-10-29T00:00:00Z' })).to.equal(false)
    expect(matchesBook(map, { identifier: 'urn:uuid:other', modified: map.modified })).to.equal(false)
    expect(matchesBook(map, {})).to.equal(false)
    expect(matchesBook(map, undefined)).to.equal(false)
  })

  it('allows max(2 s, 0.1 %) of duration drift', () => {
    expect(durationMatches(map, 40)).to.equal(true)
    expect(durationMatches(map, 41.9)).to.equal(true)
    expect(durationMatches(map, 42.5)).to.equal(false)
    const long = parsed({ ...clone(), audioDuration: 36000 })
    expect(durationMatches(long, 36035)).to.equal(true)
    expect(durationMatches(long, 36037)).to.equal(false)
  })

  it('passes when either duration is unknown', () => {
    expect(durationMatches(map, null)).to.equal(true)
    expect(durationMatches(map, 0)).to.equal(true)
    const json = clone()
    delete json.audioDuration
    expect(durationMatches(parsed(json), 99)).to.equal(true)
  })
})

describe('wordIndexAt / sentenceFraction', () => {
  const map = parsed()

  it('finds the word being spoken', () => {
    expect(wordIndexAt(map, 7, 22.1)).to.equal(0)
    expect(wordIndexAt(map, 7, 22.5)).to.equal(1)
    expect(wordIndexAt(map, 7, 23.4)).to.equal(4)
    expect(wordIndexAt(map, 7, 30)).to.equal(4)
    expect(wordIndexAt(map, 0, 2)).to.equal(-1)
  })

  it('estimates the spoken share of a sentence', () => {
    expect(sentenceFraction(map, 0, 0)).to.equal(0)
    expect(sentenceFraction(map, 0, 2 - READ_ALONG_LEAD_SEC)).to.be.closeTo(0.5, 1e-9)
    expect(sentenceFraction(map, 0, 9)).to.equal(1)
  })
})
