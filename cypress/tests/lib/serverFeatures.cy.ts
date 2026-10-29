import { hasServerFeature, OPTIONAL_SERVER_FEATURES, parseServerFeatures } from '@/lib/serverFeatures'

describe('parseServerFeatures', () => {
  it('reads the advertised features', () => {
    expect(parseServerFeatures(['batchEpisodes', 'chapterbotVerify', 'chapterbotEpub'])).to.deep.equal(['batchEpisodes', 'chapterbotVerify', 'chapterbotEpub'])
  })

  it('treats a stock server (no serverFeatures) as having none', () => {
    expect(parseServerFeatures(undefined)).to.deep.equal([])
    expect(parseServerFeatures(null)).to.deep.equal([])
  })

  it('ignores anything that is not a list of names', () => {
    expect(parseServerFeatures('chapterbotEpub')).to.deep.equal([])
    expect(parseServerFeatures({ chapterbotEpub: true })).to.deep.equal([])
    expect(parseServerFeatures(['chapterbotEpub', 1, null, { x: 1 }])).to.deep.equal(['chapterbotEpub'])
  })
})

describe('hasServerFeature', () => {
  it('is true only for listed features', () => {
    expect(hasServerFeature(['chapterbotVerify'], 'chapterbotVerify')).to.equal(true)
    expect(hasServerFeature(['chapterbotVerify'], 'chapterbotEpub')).to.equal(false)
    expect(hasServerFeature([], 'chapterbotEpub')).to.equal(false)
    expect(hasServerFeature(undefined, 'chapterbotEpub')).to.equal(false)
  })
})

describe('readAlong feature', () => {
  it('is detected from /status and is not tied to the sidecar', () => {
    expect(hasServerFeature(parseServerFeatures(['batchEpisodes', 'readAlong']), 'readAlong')).to.equal(true)
    expect(hasServerFeature(parseServerFeatures(undefined), 'readAlong')).to.equal(false)
    expect(OPTIONAL_SERVER_FEATURES).to.not.include('readAlong')
  })
})
