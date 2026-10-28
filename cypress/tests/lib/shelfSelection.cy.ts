import { getShelfSelectionIndex, nextSelectedItems } from '@/lib/batchSelection/shelfSelectionIndex'
import type { SelectedMediaItem } from '@/lib/selectedMediaItem'
import { applyShiftClickSelection } from '@/lib/shiftClickSelection'
import type { LibraryItem, PlaylistItem, PodcastEpisode } from '@/types/api'

function book(id: string, partial: Record<string, unknown> = {}): LibraryItem {
  return {
    id,
    libraryId: 'lib_1',
    mediaType: 'book',
    isMissing: false,
    isInvalid: false,
    media: { metadata: { title: `Title ${id}` }, audioFiles: [], tracks: [], chapters: [] },
    ...partial
  } as unknown as LibraryItem
}

function episode(id: string): PodcastEpisode {
  return { id, title: id, audioFile: { ino: `ino_${id}` } } as unknown as PodcastEpisode
}

/** A virtualized shelf: 10 slots, page 1 (indexes 3-6) not loaded yet. */
function sparseShelf(): (LibraryItem | null)[] {
  const shelf: (LibraryItem | null)[] = new Array(10)
  for (const i of [0, 1, 2, 7, 8, 9]) shelf[i] = book(`li_${i}`)
  return shelf
}

/** One click the way BookshelfSelectionContext.selectItem runs it. */
function click(
  shelf: readonly (LibraryItem | PlaylistItem | null)[],
  state: { items: SelectedMediaItem[]; anchor: string | null },
  index: number,
  shiftKey = false
) {
  const shelfIndex = getShelfSelectionIndex(shelf)
  const clickedKey = shelfIndex.keys[index]!
  const prevKeys = new Set(state.items.map((item) => item.selectionKey))
  const { nextSelected, anchorKey } = applyShiftClickSelection({
    prevSelected: prevKeys,
    clickedKey,
    clickedIndex: index,
    shiftKey,
    anchorKey: state.anchor,
    orderedKeys: shelfIndex.keys,
    indexOfKey: shelfIndex.indexOfKey,
    selectClicked: !prevKeys.has(clickedKey)
  })
  return { items: nextSelectedItems(state.items, nextSelected, shelfIndex), anchor: anchorKey }
}

const keysOf = (items: readonly SelectedMediaItem[]) => items.map((item) => item.selectionKey)

describe('getShelfSelectionIndex', () => {
  it('keeps keys aligned with shelf positions, with null for unloaded slots', () => {
    const index = getShelfSelectionIndex(sparseShelf())
    expect(index.keys).to.deep.equal(['li:li_0', 'li:li_1', 'li:li_2', null, null, null, null, 'li:li_7', 'li:li_8', 'li:li_9'])
    expect(index.indexOfKey('li:li_8')).to.equal(8)
    expect(index.indexOfKey('li:missing')).to.equal(-1)
    expect(index.sourceOfKey('li:li_7')?.libraryItem.id).to.equal('li_7')
  })

  it('is built once per shelf array', () => {
    const shelf = sparseShelf()
    expect(getShelfSelectionIndex(shelf)).to.equal(getShelfSelectionIndex(shelf))
    expect(getShelfSelectionIndex([...shelf])).not.to.equal(getShelfSelectionIndex(shelf))
  })

  it('never selects collapsed series', () => {
    const index = getShelfSelectionIndex([book('a'), book('series', { collapsedSeries: { id: 's1', libraryItemIds: [] } }), book('b')])
    expect(index.keys).to.deep.equal(['li:a', null, 'li:b'])
  })

  it('uses episode keys on episode shelves and playlist rows', () => {
    const withEpisode = book('pod', { mediaType: 'podcast', recentEpisode: episode('ep_1') })
    expect(getShelfSelectionIndex([withEpisode, book('no-episode')], true).keys).to.deep.equal(['ep:ep_1', null])

    const playlist: PlaylistItem[] = [
      { libraryItemId: 'pod', libraryItem: withEpisode, episodeId: 'ep_2', episode: episode('ep_2') },
      { libraryItemId: 'b', libraryItem: book('b') }
    ]
    expect(getShelfSelectionIndex(playlist).keys).to.deep.equal(['ep:ep_2', 'li:b'])
  })

  it('falls back to library item keys when an episode shelf has no episodes', () => {
    expect(getShelfSelectionIndex([book('a'), book('b')], true).keys).to.deep.equal(['li:a', 'li:b'])
  })
})

describe('shift-click range selection over a virtualized shelf', () => {
  it('selects the loaded items of a range that crosses an unloaded page', () => {
    const shelf = sparseShelf()
    let state = click(shelf, { items: [], anchor: null }, 1)
    expect(keysOf(state.items)).to.deep.equal(['li:li_1'])

    state = click(shelf, state, 8, true)
    expect(keysOf(state.items)).to.deep.equal(['li:li_1', 'li:li_2', 'li:li_7', 'li:li_8'])
    expect(state.anchor).to.equal('li:li_8')
  })

  it('uses the card position, not the position among loaded items', () => {
    // Before the shelf index, a card at shelf position 8 was looked up at position 8 of the loaded-only
    // key list, which is out of range here, so shift-click did nothing.
    const shelf = sparseShelf()
    let state = click(shelf, { items: [], anchor: null }, 9)
    state = click(shelf, state, 7, true)
    expect(keysOf(state.items)).to.deep.equal(['li:li_9', 'li:li_7', 'li:li_8'])
  })

  it('selects the newly loaded items once the missing page arrives', () => {
    const shelf = sparseShelf()
    let state = click(shelf, { items: [], anchor: null }, 0)
    state = click(shelf, state, 9, true)
    expect(state.items).to.have.length(6)

    // The page loads: the shelf gets a new array, and a range over it now includes the new items
    const loaded = [...shelf]
    for (const i of [3, 4, 5, 6]) loaded[i] = book(`li_${i}`)
    state = click(loaded, { items: state.items, anchor: 'li:li_0' }, 6, true)
    expect(keysOf(state.items)).to.include.members(['li:li_3', 'li:li_4', 'li:li_5', 'li:li_6'])
    expect(state.items).to.have.length(10)
  })

  it('deselects a fully selected range and keeps the rest of the selection', () => {
    const shelf = sparseShelf()
    let state = click(shelf, { items: [], anchor: null }, 0)
    state = click(shelf, state, 9, true)
    state = click(shelf, state, 2, true) // anchor li_9, range 2..9 already selected → deselect
    expect(keysOf(state.items)).to.deep.equal(['li:li_0', 'li:li_1'])
    expect(state.anchor).to.equal(null)
  })

  it('keeps existing entries as-is and converts only new keys', () => {
    const shelf = sparseShelf()
    const first = click(shelf, { items: [], anchor: null }, 0)
    const second = click(shelf, first, 2, true)
    expect(second.items[0]).to.equal(first.items[0])
    expect(second.items[2]).to.deep.include({ selectionKey: 'li:li_2', libraryItemId: 'li_2', title: 'Title li_2' })
  })
})
