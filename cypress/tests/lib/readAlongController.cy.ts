import { parseReadAlong, type ReadAlongMap } from '@/lib/ereader/readAlong'
import { READ_ALONG_ACTIVE_CLASS, ReadAlongController, type ReadAlongStatus, type ReadAlongView } from '@/lib/ereader/readAlongController'
import fixture from '../../fixtures/readalong/readalong.json'

const METADATA = { identifier: fixture.identifier, modified: fixture.modified }
// A cover before the chapters, so map section N is spine index N + 1.
const SPINE = ['OEBPS/cover.xhtml', 'OEBPS/ch001.xhtml', 'OEBPS/ch002.xhtml']

/** Player time stand-in: set() pushes a tick like the progress store does. */
function fakeTime() {
  let time = 0
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getTime: () => time,
    set(value: number) {
      time = value
      listeners.forEach((listener) => listener())
    },
    listenerCount: () => listeners.size
  }
}

/** foliate-view stand-in recording navigation. Only the section in `current` is "rendered". */
function fakeView(docs: Record<number, Document>, metadata: { identifier?: string; modified?: string } = METADATA) {
  const calls: string[] = []
  const anchors: Array<Range | Element> = []
  const renderer = new EventTarget() as ReadAlongView['renderer']
  const state = { current: 1 }
  Object.assign(renderer, {
    getContents: () => [{ doc: docs[state.current], index: state.current }],
    next: () => {
      calls.push('next')
      return Promise.resolve()
    },
    scrollToAnchor: (anchor: Range | Element) => {
      calls.push('scrollToAnchor')
      anchors.push(anchor)
      return Promise.resolve()
    }
  })
  const view: ReadAlongView = {
    book: { metadata, sections: SPINE.map((id) => ({ id })) },
    goTo: (target: string) => {
      calls.push(`goTo:${target}`)
      return Promise.resolve()
    },
    renderer
  }
  return { view, calls, anchors, state }
}

function loadDoc(xhtml: string): Promise<Document> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.style.width = '600px'
    iframe.style.height = '400px'
    iframe.addEventListener('load', () => resolve(iframe.contentDocument!), { once: true })
    iframe.srcdoc = xhtml.replace(/<\?xml[^>]*\?>\s*/, '')
    document.body.appendChild(iframe)
  })
}

/** A "page" showing exactly the given paragraph. */
function pageRange(doc: Document, paragraphId: string): Range {
  const range = doc.createRange()
  range.selectNodeContents(doc.getElementById(paragraphId)!)
  return range
}

function active(doc: Document): string[] {
  return Array.from(doc.querySelectorAll(`.${READ_ALONG_ACTIVE_CLASS}`)).map((el) => el.id)
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('ReadAlongController', () => {
  let ch1: Document
  let ch2: Document
  let map: ReadAlongMap

  beforeEach(() => {
    map = parseReadAlong(fixture)!
    cy.fixture('readalong/ch001.xhtml').then(async (xhtml: string) => {
      ch1 = await loadDoc(xhtml)
    })
    cy.fixture('readalong/ch002.xhtml').then(async (xhtml: string) => {
      ch2 = await loadDoc(xhtml)
    })
  })

  afterEach(() => {
    document.querySelectorAll('iframe[srcdoc]').forEach((iframe) => iframe.remove())
  })

  /** Controller attached to a view showing chapter 1, its first page (p1) visible, this book streaming. */
  function setup(options: { metadata?: { identifier?: string; modified?: string }; streaming?: boolean; duration?: number | null } = {}) {
    const time = fakeTime()
    const follow: boolean[] = []
    const taps: number[] = []
    const statuses: ReadAlongStatus[] = []
    const fake = fakeView({ 1: ch1, 2: ch2 }, options.metadata)
    const clock = { ms: 0 }
    const controller = new ReadAlongController({
      timeSource: time,
      now: () => clock.ms,
      onFollowChange: (value) => follow.push(value),
      onSentenceTap: (start) => taps.push(start),
      onStatusChange: (status) => statuses.push(status)
    })
    controller.setMap(map)
    controller.attach(fake.view)
    // foliate's initial display
    controller.onRelocate({ range: pageRange(ch1, 'p1'), reason: 'navigation' })
    controller.setPlayback(options.streaming ?? true, options.duration ?? 40)
    return { controller, time, follow, taps, statuses, clock, ...fake }
  }

  it('highlights one sentence at a time, moving with the time', () => {
    const { time } = setup()
    time.set(0.5)
    expect(active(ch1)).to.deep.equal([])
    time.set(1.2)
    expect(active(ch1)).to.deep.equal(['s1'])
    time.set(3.5)
    expect(active(ch1)).to.deep.equal(['s2'])
    time.set(8) // pause between s3 and s4 keeps s3
    expect(active(ch1)).to.deep.equal(['s3'])
    time.set(17.5) // long gap after s6
    expect(active(ch1)).to.deep.equal([])
  })

  it('clears the highlight when disabled, detached, or another item streams', () => {
    const { controller, time } = setup()
    time.set(1.2)
    expect(active(ch1)).to.deep.equal(['s1'])

    controller.setEnabled(false)
    expect(active(ch1)).to.deep.equal([])
    time.set(3.5)
    expect(active(ch1)).to.deep.equal([])
    controller.setEnabled(true)
    expect(active(ch1)).to.deep.equal(['s2'])

    controller.setPlayback(false)
    expect(active(ch1)).to.deep.equal([])
    expect(controller.isActive()).to.equal(false)
    time.set(5.5)
    expect(active(ch1)).to.deep.equal([])
    controller.setPlayback(true, 40)
    expect(active(ch1)).to.deep.equal(['s3'])

    controller.detach()
    expect(active(ch1)).to.deep.equal([])
    time.set(1.2)
    expect(active(ch1)).to.deep.equal([])
  })

  it('unsubscribes from the time source on detach', () => {
    const { controller, time } = setup()
    expect(time.listenerCount()).to.equal(1)
    controller.detach()
    expect(time.listenerCount()).to.equal(0)
  })

  it('does not navigate while the spoken sentence is visible', () => {
    const { time, calls } = setup()
    time.set(1.2)
    time.set(3.5)
    time.set(6)
    expect(calls).to.deep.equal([])
  })

  it('turns the page when the narration runs off the visible end', async () => {
    const { controller, time, calls } = setup()
    time.set(6) // s3, visible
    time.set(9.2) // s4 is on the next "page" (p2)
    expect(calls).to.deep.equal(['next'])
    await flush()
    controller.onRelocate({ range: pageRange(ch1, 'p2'), reason: 'page' })
    time.set(11.5)
    expect(calls).to.deep.equal(['next'])
  })

  it('jumps (instead of paging) after a seek far ahead in the section', () => {
    const { time, calls, anchors } = setup()
    time.set(1.2) // s1 visible
    time.set(13.5) // seek to s6 on p2
    expect(calls).to.deep.equal(['scrollToAnchor'])
    const anchor = anchors[0] as Range
    expect(anchor.collapsed).to.equal(true)
    expect(doc(anchor)).to.equal(ch1)
    expect((anchor.startContainer.parentElement as Element).closest('#s6')).to.not.equal(null)
  })

  it('goes to the sentence in another section by href and id', () => {
    const { time, calls } = setup()
    time.set(1.2)
    time.set(20.5)
    expect(calls).to.deep.equal(['goTo:OEBPS/ch002.xhtml#s7'])
  })

  it('highlights a sentence once its section loads', async () => {
    const { controller, time, state } = setup()
    time.set(20.5)
    expect(active(ch2)).to.deep.equal([])
    await flush()
    state.current = 2
    controller.onDocLoad(ch2, 2)
    expect(active(ch2)).to.deep.equal(['s7'])
    expect(active(ch1)).to.deep.equal([])
  })

  it('pauses follow on user navigation, resumes on request or when the user comes back', async () => {
    const { controller, time, calls, follow } = setup()
    time.set(6) // s3 visible on p1

    // the user pages forward: s3 is no longer on screen
    controller.onRelocate({ range: pageRange(ch1, 'p2'), reason: 'page' })
    expect(follow).to.deep.equal([false])
    expect(controller.isFollowing()).to.equal(false)
    time.set(6.5)
    expect(calls).to.deep.equal([])
    expect(active(ch1)).to.deep.equal(['s3']) // the highlight keeps updating

    // the user pages back to where the narration is: follow resumes by itself
    controller.onRelocate({ range: pageRange(ch1, 'p1'), reason: 'page' })
    expect(follow).to.deep.equal([false, true])

    // pause again, then "Follow narration" jumps back
    controller.onRelocate({ range: pageRange(ch1, 'p2'), reason: 'page' })
    expect(follow).to.deep.equal([false, true, false])
    controller.setFollow(true)
    expect(follow).to.deep.equal([false, true, false, true])
    expect(calls).to.deep.equal(['scrollToAnchor'])
    await flush()
  })

  it('does not treat its own moves or re-layouts as user navigation', async () => {
    const { controller, time, follow, calls } = setup()
    time.set(6)
    time.set(9.2) // next() in flight
    expect(calls).to.deep.equal(['next'])
    controller.onRelocate({ range: pageRange(ch1, 'p2'), reason: 'page' })
    await flush()
    // resize / style change
    controller.onRelocate({ range: pageRange(ch1, 'p1'), reason: 'anchor' })
    expect(follow).to.deep.equal([])
  })

  it("ignores foliate's late scroll report of its own move in scrolled mode", async () => {
    const { controller, time, follow, calls, clock } = setup()
    time.set(6)
    time.set(9.2) // next() scrolls; foliate reports it right away (reason null)...
    expect(calls).to.deep.equal(['next'])
    controller.onRelocate({ range: pageRange(ch1, 'p2') })
    await flush()
    // ...and again from its debounced container 'scroll' listener 250 ms later, after next() settled
    clock.ms += 250
    controller.onRelocate({ range: pageRange(ch1, 'p1'), reason: 'scroll' })
    expect(follow).to.deep.equal([])
    // a real user scroll later still pauses follow
    clock.ms += 2000
    controller.onRelocate({ range: pageRange(ch1, 'p1'), reason: 'scroll' })
    expect(follow).to.deep.equal([false])
  })

  it('brings the spoken sentence into view when the book opens while paused', () => {
    const time = fakeTime()
    const fake = fakeView({ 1: ch1, 2: ch2 })
    const controller = new ReadAlongController({ timeSource: time })
    time.set(13.5) // paused in s6, on p2: no more ticks come
    controller.setMap(map)
    controller.attach(fake.view)
    controller.setPlayback(true, 40)
    expect(active(ch1)).to.deep.equal(['s6'])
    expect(fake.calls).to.deep.equal([])
    // foliate's initial display shows p1 (the saved reading position)
    controller.onRelocate({ range: pageRange(ch1, 'p1'), reason: 'navigation' })
    expect(fake.calls).to.deep.equal(['scrollToAnchor'])
    controller.detach()
  })

  it('forgets section documents foliate unloaded, removing their click listener', () => {
    const { controller, state, taps } = setup()
    const removeListener = cy.spy(ch1, 'removeEventListener')
    state.current = 2
    Array.from(document.querySelectorAll('iframe')).find((iframe) => iframe.contentDocument === ch1)?.remove()
    controller.onDocLoad(ch2, 2)
    expect(removeListener).to.have.been.calledWith('click')
    // the new section still has its listener
    controller.setPlayback(true, 40)
    const MouseEventCtor = ch2.defaultView!.MouseEvent
    ch2.getElementById('s7')!.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }))
    expect(taps).to.have.length(1)
  })

  it('takes the relocate reason from the renderer event when foliate-view drops it', () => {
    const { controller, view, time, follow } = setup()
    time.set(6)
    view.renderer.dispatchEvent(new CustomEvent('relocate', { detail: { reason: 'anchor' } }))
    controller.onRelocate({ range: pageRange(ch1, 'p2') })
    expect(follow).to.deep.equal([])
    view.renderer.dispatchEvent(new CustomEvent('relocate', { detail: { reason: 'page' } }))
    controller.onRelocate({ range: pageRange(ch1, 'p2') })
    expect(follow).to.deep.equal([false])
  })

  it('stays off when the EPUB is another build or the audio changed', () => {
    const other = setup({ metadata: { identifier: fixture.identifier, modified: '2026-10-29T00:00:00Z' } })
    other.time.set(1.2)
    expect(other.controller.getStatus()).to.equal('mismatch')
    expect(active(ch1)).to.deep.equal([])
    other.controller.detach()

    const changed = setup({ duration: 55 })
    changed.time.set(1.2)
    expect(changed.controller.getStatus()).to.equal('audioChanged')
    expect(active(ch1)).to.deep.equal([])
    changed.controller.setPlayback(true, 40.5)
    expect(changed.controller.getStatus()).to.equal('ready')
    expect(active(ch1)).to.deep.equal(['s1'])
  })

  it('turns off when most sentence ids are missing from a section', () => {
    ch1.querySelectorAll('span[id^="s"]').forEach((span, i) => {
      if (i < 4) span.removeAttribute('id')
    })
    const consoleWarn = cy.stub(console, 'warn')
    const { controller, statuses, time } = setup()
    time.set(11.5)
    expect(controller.getStatus()).to.equal('mismatch')
    expect(statuses).to.include('mismatch')
    expect(consoleWarn.called).to.equal(true)
    expect(active(ch1)).to.deep.equal([])
  })

  it('skips a few missing ids without turning off', () => {
    ch1.getElementById('s2')!.removeAttribute('id')
    const { controller, time } = setup()
    time.set(3.5)
    expect(controller.getStatus()).to.equal('ready')
    expect(active(ch1)).to.deep.equal([])
    time.set(6)
    expect(active(ch1)).to.deep.equal(['s3'])
  })

  describe('tap to seek', () => {
    function click(target: Element) {
      const MouseEventCtor = target.ownerDocument.defaultView!.MouseEvent
      target.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }))
    }

    it('seeks to the start of the tapped sentence', () => {
      const { taps, follow, controller, time } = setup()
      time.set(6)
      controller.onRelocate({ range: pageRange(ch1, 'p2'), reason: 'page' })
      expect(follow).to.deep.equal([false])
      click(ch1.getElementById('s5')!)
      expect(taps).to.deep.equal([11.1])
      // tapping resumes follow
      expect(follow).to.deep.equal([false, true])
    })

    it('ignores taps with a selection, on links, on untimed text, or when not streaming', () => {
      const { taps, controller } = setup()
      ch1.getSelection()!.selectAllChildren(ch1.getElementById('s4')!)
      click(ch1.getElementById('s4')!)
      ch1.getSelection()!.removeAllRanges()
      click(ch1.querySelector('#s6 a')!)
      click(ch1.getElementById('p2')!)
      controller.setTapToSeek(false)
      click(ch1.getElementById('s4')!)
      controller.setTapToSeek(true)
      controller.setPlayback(false)
      click(ch1.getElementById('s4')!)
      expect(taps).to.deep.equal([])
    })
  })
})

function doc(range: Range): Document | null {
  return range.startContainer.ownerDocument
}
