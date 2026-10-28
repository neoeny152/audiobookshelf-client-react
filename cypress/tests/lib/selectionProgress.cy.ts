import { areAllSelectedItemsFinished, buildSelectionProgressLookup, findProgressForSelectedItem } from '@/lib/batchSelection/selectionProgress'
import type { SelectedMediaItem } from '@/lib/selectedMediaItem'
import type { MediaProgress } from '@/types/api'

function progress(overrides: Partial<MediaProgress> & Pick<MediaProgress, 'id' | 'libraryItemId'>): MediaProgress {
  return {
    displayTitle: '',
    duration: 100,
    progress: 0,
    currentTime: 0,
    isFinished: false,
    ebookProgress: 0,
    lastUpdate: 0,
    ...overrides
  }
}

function book(libraryItemId: string): SelectedMediaItem {
  return { selectionKey: libraryItemId, libraryItemId, hasTracks: true }
}

function episode(libraryItemId: string, episodeId: string): SelectedMediaItem {
  return { selectionKey: `${libraryItemId}-${episodeId}`, libraryItemId, episodeId, hasTracks: true }
}

describe('selectionProgress', () => {
  it('finds book progress by libraryItemId and ignores episode progress on the same item', () => {
    const list = [
      progress({ id: 'p1', libraryItemId: 'li-podcast', episodeId: 'ep-1', isFinished: true }),
      progress({ id: 'p2', libraryItemId: 'li-book', mediaItemId: 'book-1', isFinished: true })
    ]
    const lookup = buildSelectionProgressLookup(list)

    expect(findProgressForSelectedItem(book('li-book'), lookup)?.id).to.equal('p2')
    expect(findProgressForSelectedItem(book('li-podcast'), lookup)).to.equal(undefined)
  })

  it('finds episode progress by mediaItemId, falling back to episodeId', () => {
    const list = [
      progress({ id: 'p1', libraryItemId: 'li-1', episodeId: 'ep-legacy' }),
      progress({ id: 'p2', libraryItemId: 'li-1', episodeId: 'ep-old', mediaItemId: 'ep-2' })
    ]
    const lookup = buildSelectionProgressLookup(list)

    expect(findProgressForSelectedItem(episode('li-1', 'ep-legacy'), lookup)?.id).to.equal('p1')
    expect(findProgressForSelectedItem(episode('li-1', 'ep-2'), lookup)?.id).to.equal('p2')
    // mediaItemId wins over episodeId, the same as the old linear lookup
    expect(findProgressForSelectedItem(episode('li-1', 'ep-old'), lookup)).to.equal(undefined)
  })

  it('keeps the first match when keys repeat', () => {
    const list = [progress({ id: 'first', libraryItemId: 'li-1', isFinished: false }), progress({ id: 'second', libraryItemId: 'li-1', isFinished: true })]
    const lookup = buildSelectionProgressLookup(list)

    expect(findProgressForSelectedItem(book('li-1'), lookup)?.id).to.equal('first')
  })

  it('reports allFinished only when every selected item is finished', () => {
    const list = [
      progress({ id: 'p1', libraryItemId: 'li-1', isFinished: true }),
      progress({ id: 'p2', libraryItemId: 'li-2', isFinished: false }),
      progress({ id: 'p3', libraryItemId: 'li-3', episodeId: 'ep-1', mediaItemId: 'ep-1', isFinished: true })
    ]

    expect(areAllSelectedItemsFinished([], list)).to.equal(false)
    expect(areAllSelectedItemsFinished([book('li-1'), episode('li-3', 'ep-1')], list)).to.equal(true)
    expect(areAllSelectedItemsFinished([book('li-1'), book('li-2')], list)).to.equal(false)
    expect(areAllSelectedItemsFinished([book('li-1'), book('li-missing')], list)).to.equal(false)
  })

  it('handles large selections', () => {
    const count = 5000
    const list: MediaProgress[] = []
    const selected: SelectedMediaItem[] = []
    for (let i = 0; i < count; i++) {
      list.push(progress({ id: `p${i}`, libraryItemId: `li-${i}`, isFinished: true }))
      selected.push(book(`li-${i}`))
    }

    expect(areAllSelectedItemsFinished(selected, list)).to.equal(true)
  })
})
