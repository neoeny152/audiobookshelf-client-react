import { toPlaylistMembershipSummary } from '@/lib/playlistItems'
import type { LibraryItem, Playlist } from '@/types/api'

describe('toPlaylistMembershipSummary', () => {
  it('drops book files, tracks and chapters but keeps membership and cover fields', () => {
    const bookItem = {
      id: 'li_book',
      updatedAt: 5,
      mediaType: 'book',
      libraryFiles: [{ ino: '1' }],
      media: { coverPath: '/c.jpg', metadata: { title: 'Book' }, audioFiles: [{ ino: '1' }], tracks: [{ index: 1 }], chapters: [{ id: 0 }] }
    } as unknown as LibraryItem
    const podcastItem = { id: 'li_pod', mediaType: 'podcast', media: { metadata: { title: 'Pod' } } } as unknown as LibraryItem
    const playlist: Playlist = {
      id: 'pl_1',
      name: 'List',
      libraryId: 'lib_1',
      userId: 'u_1',
      items: [
        { libraryItemId: 'li_book', libraryItem: bookItem },
        { libraryItemId: 'li_pod', libraryItem: podcastItem, episodeId: 'ep_1', episode: { id: 'ep_1' } as never }
      ]
    }

    const summary = toPlaylistMembershipSummary(playlist)
    const book = summary.items![0].libraryItem as unknown as Record<string, unknown> & { media: Record<string, unknown> }
    expect(book.libraryFiles).to.equal(undefined)
    expect(book.media.audioFiles).to.equal(undefined)
    expect(book.media.tracks).to.equal(undefined)
    expect(book.media.chapters).to.equal(undefined)
    expect(book.media.coverPath).to.equal('/c.jpg')
    expect(book.updatedAt).to.equal(5)
    expect(summary.items![1]).to.equal(playlist.items![1])
    // The original is not modified
    expect((bookItem.media as unknown as Record<string, unknown>).tracks).to.have.length(1)
  })

  it('passes through a playlist without items', () => {
    const playlist: Playlist = { id: 'pl_1', name: 'List', libraryId: 'lib_1', userId: 'u_1' }
    expect(toPlaylistMembershipSummary(playlist)).to.equal(playlist)
  })
})
