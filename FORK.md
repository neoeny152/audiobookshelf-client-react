# About this fork

This is an unofficial personal fork of [audiobookshelf/audiobookshelf-client-react](https://github.com/audiobookshelf/audiobookshelf-client-react), used for learning and experiments. It is not affiliated with or supported by the Audiobookshelf project. Please report problems with Audiobookshelf itself upstream, not here.

- **Upstream base:** `.upstream-base` holds the upstream `master` commit this branch is synced to (currently `9c30742f`).
- **Server:** it pairs with the server fork [neoeny152/audiobookshelf](https://github.com/neoeny152/audiobookshelf), which documents the server endpoints. Every fork feature is shown only when the server lists it in `serverFeatures` (`GET /status`), so this client still works with a stock server.

## Added

### Chapter editor
- **Snap to audio:** a proposal list, a per-row and whole-book speech check, heard-title suggestions, and labels for moved or predicted chapters.
- Millisecond chapter starts.
- MP3 seek index warning and repair, with backups, restore and resume.

### Ebooks
- **Make EPUB from audio** in the item Tools menu, with progress visible to anyone who opens the book.
- **Read-along:** highlight and follow in the e-reader for EPUBs made from audio.

### Transcripts
- A player panel, item and episode sections, and podcast settings.

### Library maintenance
- **Automatic processing:** settings, a Processing page, chapter review with approve and undo, and item status.
- **Guided fix** on the item page: book health card, Guide me, Fix automatically, and needs-work guidance.
- **Possible duplicates** on the library Issues page ([#5676](https://github.com/advplyr/audiobookshelf/issues/5676)).
- **Search** shows results matched by file name or path ([#5680](https://github.com/advplyr/audiobookshelf/issues/5680)).

### Editing and batch actions
- Server errors shown in toasts for library, media and API key changes.
- Changed fields highlighted in the details editors, with a guard against leaving with unsaved changes.
- **Batch edit:** a soft cap, progress and partial failures. It uses the server's batch episode endpoints and POST zip downloads (no 40-item cap) when the server advertises them.
- Faster bookshelf selection on large libraries.

### Playback
- Progress syncs on pause and after a paused seek, and another device's progress is not echoed back ([#5492](https://github.com/advplyr/audiobookshelf/issues/5492)).

### Other
- Theme tokens for checkboxes and queue rows, and an `IconBtn` variant.
- The components catalog pages were removed ([#296](https://github.com/audiobookshelf/audiobookshelf-client-react/pull/296)).

## Container image

`.github/workflows/fork-image.yml` builds `ghcr.io/neoeny152/abs-fork-react`: the server fork and this client in one image, multi-arch (amd64 and arm64), built natively per architecture. It runs like the official image: port 80, `/config`, `/metadata` and your library mounts.

The image is built from this repo's `Dockerfile`, with the server fork as the `abs-server` build context:

```
docker buildx build -f audiobookshelf-client-react/Dockerfile \
  --build-context abs-client=audiobookshelf-client-react \
  --build-context abs-server=audiobookshelf \
  -t abs-fork-react:local audiobookshelf
```

The server is built and Next runs inside the server process (`REACT_CLIENT_PATH=/app/client-react`).

Tags (every tag contains `fork`):
- `fork`: the latest build
- `fork-<version>`: from a `v<upstream version>-neo.<n>` git tag. Tag both repos with the same name; the build uses the server's tag of that name.
- `fork-sha-<commit>`

A manual run takes the server branch or tag as input (default `neo`).

## How this fork is maintained

- The owner's private branch is the source of truth. This public branch is replayed from it commit by commit, keeping the original authors and dates.
- `.github/workflows/upstream-check.yml` opens an issue each day that upstream has new commits. It never merges anything: syncing is done by hand on the private branch, then replayed here and recorded in `.upstream-base`.
- The code is written with AI assistance (Claude) and reviewed by the owner.
- GPL-3.0, like upstream.
