import { getPlayerProgress, subscribePlayerProgress } from '@/lib/player/playerProgressStore'
import { durationMatches, findSentence, matchesBook, sentenceFraction, wordIndexAt, type ReadAlongMap } from '@/lib/ereader/readAlong'

/** Class put on the sentence being spoken (styled by buildFoliateUserStyles). */
export const READ_ALONG_ACTIVE_CLASS = 'abs-ra-active'
/** More than this share of a section's sentence ids missing from its DOM turns read-along off for the session. */
const MISSING_IDS_LIMIT = 0.5
/**
 * In scrolled mode foliate reports a scroll it made itself a second time, from its debounced (250 ms) container
 * 'scroll' listener, after the navigation promise settled. A 'scroll' relocate this soon after our own move is ours.
 */
const OWN_SCROLL_SETTLE_MS = 500

/**
 * - none: no map
 * - pending: map loaded, waiting for the book to open
 * - ready: map matches the opened EPUB (and the playing audio, when it plays)
 * - mismatch: map was made for another build of this EPUB, or the ids are not in its documents
 * - audioChanged: the playing audio's duration differs from the build's
 */
export type ReadAlongStatus = 'none' | 'pending' | 'ready' | 'mismatch' | 'audioChanged'

/** The parts of foliate's `<foliate-view>` the controller uses (a fake in tests). */
export interface ReadAlongView {
  book?: {
    metadata?: { identifier?: unknown; modified?: unknown }
    sections?: Array<{ id?: unknown }>
    resolveHref?: (href: string) => { index: number } | null
  }
  goTo: (target: string) => unknown
  renderer: EventTarget & {
    getContents?: () => Array<{ doc?: Document | null; index?: number }>
    next?: () => unknown
    scrollToAnchor?: (anchor: Range | Element) => unknown
  }
}

export interface ReadAlongRelocate {
  range?: Range | null
  reason?: string
}

export interface ReadAlongTimeSource {
  subscribe: (listener: () => void) => () => void
  getTime: () => number
}

export interface ReadAlongControllerOptions {
  /** Defaults to the player progress store (book time, updated every 250 ms while playing, and on seek/pause). */
  timeSource?: ReadAlongTimeSource
  onFollowChange?: (following: boolean) => void
  onSentenceTap?: (start: number) => void
  onStatusChange?: (status: ReadAlongStatus) => void
  /** Clock in ms (tests). Defaults to performance.now. */
  now?: () => number
}

const playerTimeSource: ReadAlongTimeSource = {
  subscribe: subscribePlayerProgress,
  getTime: () => getPlayerProgress().currentTime
}

function hasClosest(target: EventTarget | null): target is Element {
  return !!target && typeof (target as Element).closest === 'function'
}

/**
 * Drives the sentence highlight and page follow for one open reader. A plain class so 250 ms time ticks never
 * re-render React: it subscribes to the player time itself and only touches the DOM when the sentence changes.
 */
export class ReadAlongController {
  private readonly timeSource: ReadAlongTimeSource
  private readonly options: ReadAlongControllerOptions
  private view: ReadAlongView | null = null
  private map: ReadAlongMap | null = null
  private enabled = true
  private tapToSeek = true
  private streaming = false
  private audioDuration: number | null = null
  private following = true
  private missingIds = false
  private status: ReadAlongStatus = 'none'
  /** map section index → foliate spine index */
  private spineBySec: number[] = []
  /** map section index → sentence indexes */
  private sentencesBySec: number[][] = []
  private readonly docs = new Map<number, Document>()
  private readonly docListeners = new Map<Document, (event: MouseEvent) => void>()
  private activeIndex = -1
  private activeEl: WeakRef<Element> | null = null
  private visibleRange: Range | null = null
  /** Last sentence whose spoken position was on screen: a page run-off from it turns the page instead of jumping */
  private lastVisibleIndex = -1
  private programmatic = 0
  /** When the last programmatic move settled (see OWN_SCROLL_SETTLE_MS) */
  private programmaticSettledAt = -Infinity
  private rendererReason: string | null = null
  private unsubscribeTime: (() => void) | null = null
  private readonly onRendererRelocate = (event: Event) => {
    this.rendererReason = (event as CustomEvent<{ reason?: string }>).detail?.reason ?? null
  }

  constructor(options: ReadAlongControllerOptions = {}) {
    this.options = options
    this.timeSource = options.timeSource ?? playerTimeSource
  }

  // ---- wiring ----

  attach(view: ReadAlongView): void {
    if (this.view) this.detach()
    this.view = view
    // Capture at the target runs before foliate-view's own listener re-emits the event without `reason`.
    view.renderer.addEventListener('relocate', this.onRendererRelocate, true)
    this.unsubscribeTime = this.timeSource.subscribe(() => this.tick())
    this.indexSections()
    for (const { doc, index } of view.renderer.getContents?.() ?? []) {
      if (doc && typeof index === 'number') this.onDocLoad(doc, index)
    }
    this.updateStatus()
  }

  detach(): void {
    this.clearHighlight()
    this.view?.renderer.removeEventListener('relocate', this.onRendererRelocate, true)
    this.unsubscribeTime?.()
    this.unsubscribeTime = null
    for (const [doc, listener] of this.docListeners) doc.removeEventListener('click', listener)
    this.docListeners.clear()
    this.docs.clear()
    this.view = null
    this.visibleRange = null
    this.lastVisibleIndex = -1
    this.programmatic = 0
    this.programmaticSettledAt = -Infinity
    this.updateStatus()
  }

  setMap(map: ReadAlongMap | null): void {
    if (map === this.map) return
    this.clearHighlight()
    this.map = map
    this.missingIds = false
    this.sentencesBySec = []
    if (map) {
      this.sentencesBySec = map.sections.map(() => [])
      for (let i = 0; i < map.ids.length; i++) this.sentencesBySec[map.sec[i]].push(i)
    }
    this.indexSections()
    for (const [index, doc] of this.docs) this.checkIds(doc, index)
    this.updateStatus()
    this.tick()
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (!enabled) this.clearHighlight()
    this.tick()
  }

  setTapToSeek(enabled: boolean): void {
    this.tapToSeek = enabled
  }

  /** Whether this item is the one streaming, and its audio duration (to detect audio changed after the build). */
  setPlayback(streaming: boolean, audioDuration: number | null = null): void {
    if (streaming === this.streaming && audioDuration === this.audioDuration) return
    this.streaming = streaming
    this.audioDuration = audioDuration
    this.updateStatus()
    this.tick()
  }

  /** Turn follow on or off. Turning it on jumps to the sentence being spoken. */
  setFollow(following: boolean): void {
    this.setFollowing(following)
    if (following) {
      this.lastVisibleIndex = -1
      this.tick()
    }
  }

  getStatus(): ReadAlongStatus {
    return this.status
  }

  isFollowing(): boolean {
    return this.following
  }

  isActive(): boolean {
    return !!this.view && !!this.map && this.enabled && this.streaming && this.status === 'ready'
  }

  // ---- foliate events ----

  onDocLoad(doc: Document, index: number): void {
    this.forgetUnloadedDocs(doc)
    this.docs.set(index, doc)
    if (!this.docListeners.has(doc)) {
      const listener = (event: MouseEvent) => this.onDocClick(doc, event)
      doc.addEventListener('click', listener)
      this.docListeners.set(doc, listener)
    }
    this.checkIds(doc, index)
    if (this.activeIndex >= 0 && this.map && this.spineBySec[this.map.sec[this.activeIndex]] === index) {
      this.applyHighlight(this.activeIndex)
    }
  }

  onRelocate(detail: ReadAlongRelocate): void {
    const reason = detail.reason ?? this.rendererReason
    this.rendererReason = null
    const isFirst = !this.visibleRange
    this.visibleRange = detail.range ?? null
    // Our own moves, the initial display and re-layouts (resize, style change) are not the user navigating.
    if (this.programmatic > 0 || reason === 'anchor') return
    if (reason === 'scroll' && this.now() - this.programmaticSettledAt < OWN_SCROLL_SETTLE_MS) return
    if (isFirst) {
      // Opened while paused, no time tick comes: bring the spoken sentence into view now.
      this.tick()
      return
    }
    if (!this.isActive() || this.activeIndex < 0) return
    // The user moved: follow pauses unless they landed where the narration is (which also resumes it).
    const visible = this.isPointVisible(this.activeIndex, this.timeSource.getTime())
    this.lastVisibleIndex = visible ? this.activeIndex : -1
    this.setFollowing(visible)
  }

  /** Player time tick (book seconds). Normally driven by the time source. */
  onTime(t: number): void {
    if (!this.isActive() || !this.map) {
      this.clearHighlight()
      return
    }
    const index = findSentence(this.map, t)
    if (index !== this.activeIndex) this.applyHighlight(index)
    if (this.following && index >= 0) this.keepInView(index, t)
  }

  // ---- internals ----

  private now(): number {
    return this.options.now?.() ?? performance.now()
  }

  /** foliate keeps one section loaded: drop the documents it unloaded (and their click listeners). */
  private forgetUnloadedDocs(loaded: Document): void {
    const live = new Set<Document>([loaded])
    for (const { doc } of this.view?.renderer.getContents?.() ?? []) if (doc) live.add(doc)
    for (const [index, doc] of this.docs) {
      if (!doc.defaultView || !live.has(doc)) this.docs.delete(index)
    }
    for (const [doc, listener] of this.docListeners) {
      if (!doc.defaultView || !live.has(doc)) {
        doc.removeEventListener('click', listener)
        this.docListeners.delete(doc)
      }
    }
  }

  private tick(): void {
    this.onTime(this.timeSource.getTime())
  }

  private setFollowing(following: boolean): void {
    if (following === this.following) return
    this.following = following
    this.options.onFollowChange?.(following)
  }

  private updateStatus(): void {
    let status: ReadAlongStatus
    if (!this.map) status = 'none'
    else if (!this.view) status = 'pending'
    else if (!matchesBook(this.map, this.view.book?.metadata) || this.missingIds) status = 'mismatch'
    else if (this.streaming && !durationMatches(this.map, this.audioDuration)) status = 'audioChanged'
    else status = 'ready'
    if (status === this.status) return
    this.status = status
    if (status !== 'ready') this.clearHighlight()
    this.options.onStatusChange?.(status)
  }

  private indexSections(): void {
    const map = this.map
    const book = this.view?.book
    if (!map || !book) {
      this.spineBySec = []
      return
    }
    this.spineBySec = map.sections.map(({ href }) => {
      const byId = book.sections?.findIndex((section) => section.id === href) ?? -1
      if (byId >= 0) return byId
      try {
        return book.resolveHref?.(href)?.index ?? -1
      } catch {
        return -1
      }
    })
  }

  private checkIds(doc: Document, index: number): void {
    const map = this.map
    if (!map || this.missingIds) return
    const sec = this.spineBySec.indexOf(index)
    if (sec < 0) return
    const sentences = this.sentencesBySec[sec] ?? []
    if (sentences.length === 0) return
    let missing = 0
    for (const i of sentences) if (!doc.getElementById(map.ids[i])) missing++
    if (missing / sentences.length > MISSING_IDS_LIMIT) {
      console.warn(`[ReadAlong] ${missing} of ${sentences.length} sentence ids missing in ${map.sections[sec].href}, turning read-along off`)
      this.missingIds = true
      this.updateStatus()
    }
  }

  private docForSentence(i: number): Document | null {
    if (!this.map) return null
    const spine = this.spineBySec[this.map.sec[i]]
    return spine === undefined || spine < 0 ? null : (this.docs.get(spine) ?? null)
  }

  private elementFor(i: number): Element | null {
    const doc = this.docForSentence(i)
    return (doc && this.map && doc.getElementById(this.map.ids[i])) || null
  }

  private applyHighlight(i: number): void {
    this.activeEl?.deref()?.classList.remove(READ_ALONG_ACTIVE_CLASS)
    this.activeEl = null
    this.activeIndex = i
    if (i < 0) return
    const el = this.elementFor(i)
    if (!el) return
    el.classList.add(READ_ALONG_ACTIVE_CLASS)
    this.activeEl = new WeakRef(el)
  }

  private clearHighlight(): void {
    this.activeEl?.deref()?.classList.remove(READ_ALONG_ACTIVE_CLASS)
    this.activeEl = null
    this.activeIndex = -1
  }

  /** Collapsed range at the estimated spoken position in sentence `i`: the current word, or a linear estimate. */
  private pointRange(i: number, t: number): Range | null {
    const map = this.map
    const el = this.elementFor(i)
    if (!map || !el) return null
    const doc = el.ownerDocument
    const text = el.textContent ?? ''
    let offset: number
    const word = wordIndexAt(map, i, t)
    const tokens = text.trim().split(/\s+/).filter(Boolean)
    if (word >= 0 && map.w[i]?.length === tokens.length) {
      const re = /\S+/g
      let match: RegExpExecArray | null = null
      for (let k = 0; k <= word; k++) match = re.exec(text)
      offset = match?.index ?? 0
    } else {
      offset = Math.floor(sentenceFraction(map, i, t) * text.length)
    }
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    let last: Text | null = null
    while (node) {
      last = node
      if (offset <= node.length) break
      offset -= node.length
      node = walker.nextNode() as Text | null
    }
    const range = doc.createRange()
    if (node) range.setStart(node, Math.min(offset, node.length))
    else if (last) range.setStart(last, last.length)
    else range.setStart(el, 0)
    range.collapse(true)
    return range
  }

  /** -1 before the visible range, 0 inside it, 1 after it, null when it is not in the rendered section. */
  private comparePoint(point: Range): number | null {
    const visible = this.visibleRange
    if (!visible || visible.startContainer.ownerDocument !== point.startContainer.ownerDocument) return null
    try {
      return visible.comparePoint(point.startContainer, point.startOffset)
    } catch {
      return null
    }
  }

  private isPointVisible(i: number, t: number): boolean {
    const point = this.pointRange(i, t)
    return !!point && this.comparePoint(point) === 0
  }

  /** Move only when the spoken position left the view: next page when it just ran off, else jump to it. */
  private keepInView(i: number, t: number): void {
    const view = this.view
    const map = this.map
    if (!view || !map || this.programmatic > 0 || !this.visibleRange) return
    const doc = this.docForSentence(i)
    if (!doc || doc !== this.visibleRange.startContainer.ownerDocument) {
      // Not in the rendered section (or not loaded yet): go there; the highlight follows on its load event.
      const href = map.sections[map.sec[i]]?.href
      if (!href) return
      this.lastVisibleIndex = -1
      this.move(() => view.goTo(`${href}#${map.ids[i]}`))
      return
    }
    const point = this.pointRange(i, t)
    // A sentence whose id is missing from the document is skipped.
    const cmp = point ? this.comparePoint(point) : null
    if (!point || cmp === null) return
    if (cmp === 0) {
      this.lastVisibleIndex = i
      return
    }
    const runOff = cmp > 0 && this.lastVisibleIndex >= 0 && i - this.lastVisibleIndex <= 1
    this.lastVisibleIndex = -1
    if (runOff && view.renderer.next) this.move(() => view.renderer.next!())
    else if (view.renderer.scrollToAnchor) this.move(() => view.renderer.scrollToAnchor!(point))
  }

  private move(action: () => unknown): void {
    this.programmatic++
    let result: unknown
    try {
      result = action()
    } catch (error) {
      this.programmatic--
      console.warn('[ReadAlong] navigation failed', error)
      return
    }
    void Promise.resolve(result)
      .catch((error) => console.warn('[ReadAlong] navigation failed', error))
      .finally(() => {
        this.programmatic = Math.max(0, this.programmatic - 1)
        this.programmaticSettledAt = this.now()
      })
  }

  private onDocClick(doc: Document, event: MouseEvent): void {
    const map = this.map
    if (!map || !this.tapToSeek || !this.isActive() || event.defaultPrevented) return
    const selection = doc.getSelection()
    if (selection && !selection.isCollapsed) return
    const target = event.target
    if (!hasClosest(target) || target.closest('a')) return
    const span = target.closest('span[id^="s"]')
    const index = span ? map.indexById.get(span.id) : undefined
    if (index === undefined) return
    this.lastVisibleIndex = index
    this.setFollowing(true)
    this.options.onSentenceTap?.(map.starts[index])
  }
}
