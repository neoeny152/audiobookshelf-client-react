/**
 * Read-along data (`readalong.json`, version 1) built by the chapterbot sidecar next to an "EPUB from audio".
 *
 * The EPUB wraps every timed sentence in `<span id="sN">`; this file maps each id to its time on the book timeline
 * (the same timeline `LocalAudioPlayer.getCurrentTime()` reports). The file is bound to one EPUB build through the
 * OPF `dc:identifier` and `dcterms:modified`, so a rebuilt or re-saved EPUB turns the feature off instead of
 * highlighting the wrong text. Pure functions only (no DOM), so a future native client can mirror them.
 */

export const READ_ALONG_KIND = 'abs-readalong'
export const READ_ALONG_VERSION = 1
/** Highlight this much ahead of the audio so it feels in sync (the store only updates every 250 ms). */
export const READ_ALONG_LEAD_SEC = 0.15
/** Keep the previous sentence highlighted through pauses up to this long past its end. */
export const READ_ALONG_GRACE_SEC = 2
const MAX_SENTENCES = 200_000
const SENTENCE_ID_RE = /^s[1-9][0-9]{0,6}$/
const SECTION_HREF_RE = /^[\w./-]{1,256}$/

export interface ReadAlongSection {
  href: string
  title?: string
}

export interface ReadAlongMap {
  identifier: string
  modified: string
  audioDuration: number | null
  sections: ReadAlongSection[]
  ids: string[]
  starts: Float64Array
  ends: Float64Array
  sec: Int32Array
  /** Per-sentence word times (`[start, end]` per whitespace token), or null when the file has none for it. */
  w: Array<Array<[number, number]> | null>
  /** Sentence id → index */
  indexById: Map<string, number>
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseWords(value: unknown): Array<[number, number]> | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) throw new Error('bad w')
  return value.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2 || !isFiniteNumber(pair[0]) || !isFiniteNumber(pair[1])) throw new Error('bad w pair')
    return [pair[0], pair[1]] as [number, number]
  })
}

/** Validate a `readalong.json` payload. Anything unexpected (including `version > 1`) returns null: feature off. */
export function parseReadAlong(json: unknown): ReadAlongMap | null {
  try {
    if (!json || typeof json !== 'object') return null
    const obj = json as Record<string, unknown>
    if (obj.kind !== READ_ALONG_KIND || obj.version !== READ_ALONG_VERSION) return null
    if (typeof obj.identifier !== 'string' || typeof obj.modified !== 'string') return null
    if (obj.timeline !== undefined && obj.timeline !== 'book') return null
    if (!Array.isArray(obj.sections) || !Array.isArray(obj.sentences)) return null
    if (obj.sentences.length > MAX_SENTENCES) return null

    const sections: ReadAlongSection[] = obj.sections.map((section: unknown) => {
      const s = section as Record<string, unknown> | null
      if (!s || typeof s.href !== 'string' || !SECTION_HREF_RE.test(s.href)) throw new Error('bad section')
      return { href: s.href, title: typeof s.title === 'string' ? s.title : undefined }
    })

    const count = obj.sentences.length
    const ids: string[] = new Array(count)
    const starts = new Float64Array(count)
    const ends = new Float64Array(count)
    const sec = new Int32Array(count)
    const w: ReadAlongMap['w'] = new Array(count)
    const indexById = new Map<string, number>()

    obj.sentences.forEach((sentence: unknown, i: number) => {
      const s = sentence as Record<string, unknown> | null
      if (!s || typeof s.id !== 'string' || !SENTENCE_ID_RE.test(s.id) || indexById.has(s.id)) throw new Error('bad id')
      if (typeof s.sec !== 'number' || !Number.isInteger(s.sec) || s.sec < 0 || s.sec >= sections.length) throw new Error('bad sec')
      if (!isFiniteNumber(s.start) || !isFiniteNumber(s.end) || s.end < s.start) throw new Error('bad time')
      if (i > 0 && s.start < starts[i - 1]) throw new Error('unsorted')
      ids[i] = s.id
      starts[i] = s.start
      ends[i] = s.end
      sec[i] = s.sec
      w[i] = parseWords(s.w)
      indexById.set(s.id, i)
    })

    return {
      identifier: obj.identifier,
      modified: obj.modified,
      audioDuration: isFiniteNumber(obj.audioDuration) ? obj.audioDuration : null,
      sections,
      ids,
      starts,
      ends,
      sec,
      w,
      indexById
    }
  } catch {
    return null
  }
}

/**
 * The sentence being spoken at book time `t`, or -1 for none: before the first sentence, or more than `graceSec`
 * past the end of the last one that started (skipped credits, long silence). Through normal pauses the previous
 * sentence stays highlighted.
 */
export function findSentence(map: ReadAlongMap, t: number, graceSec = READ_ALONG_GRACE_SEC): number {
  const { starts, ends } = map
  if (!Number.isFinite(t) || starts.length === 0) return -1
  const target = t + READ_ALONG_LEAD_SEC
  // Last index with starts[i] <= target
  let lo = 0
  let hi = starts.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= target) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return -1
  if (t > ends[found] + graceSec) return -1
  return found
}

export interface ReadAlongBookMetadata {
  identifier?: unknown
  modified?: unknown
}

/** True only when the opened EPUB is the exact build the map was written for. */
export function matchesBook(map: ReadAlongMap, metadata: ReadAlongBookMetadata | null | undefined): boolean {
  if (!metadata) return false
  return metadata.identifier === map.identifier && metadata.modified === map.modified
}

/** Audio unchanged since the build: within max(2 s, 0.1 %). A map without a duration, or an unknown one, passes. */
export function durationMatches(map: ReadAlongMap, seconds: number | null | undefined): boolean {
  if (map.audioDuration === null || !isFiniteNumber(seconds) || seconds <= 0) return true
  const tolerance = Math.max(2, map.audioDuration * 0.001)
  return Math.abs(map.audioDuration - seconds) <= tolerance
}

/** Index of the word spoken at `t` inside sentence `i`, or -1 without word times. */
export function wordIndexAt(map: ReadAlongMap, i: number, t: number): number {
  const words = map.w[i]
  if (!words || words.length === 0) return -1
  const target = t + READ_ALONG_LEAD_SEC
  let found = 0
  for (let k = 0; k < words.length; k++) {
    if (words[k][0] <= target) found = k
    else break
  }
  return found
}

/** Fraction (0..1) of sentence `i` spoken at `t`, for estimating the reading position without word times. */
export function sentenceFraction(map: ReadAlongMap, i: number, t: number): number {
  const start = map.starts[i]
  const end = map.ends[i]
  if (end <= start) return 0
  return Math.min(1, Math.max(0, (t + READ_ALONG_LEAD_SEC - start) / (end - start)))
}
