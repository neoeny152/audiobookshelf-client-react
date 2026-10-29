import type { FoliateRelocateDetail, FoliateViewElement } from '@/components/ereader/foliate'
import { applyEreaderSettingsToView, DEFAULT_EREADER_SETTINGS, READ_ALONG_HIGHLIGHT } from '@/lib/ereader/ereaderSettings'
import { parseReadAlong } from '@/lib/ereader/readAlong'
import { READ_ALONG_ACTIVE_CLASS, ReadAlongController } from '@/lib/ereader/readAlongController'
import fixture from '../../../fixtures/readalong/readalong.json'

/**
 * End to end through foliate-js: the fixture EPUB (built from cypress/fixtures/readalong/ch00N.xhtml, with sentence
 * span ids and the same OPF identifier/modified as readalong.json) opens in a real <foliate-view>, wired the way
 * FoliateView wires it (attach after open, load → onDocLoad, relocate → onRelocate, styles from the settings), and a
 * fake player clock drives the highlight, follow across chapters and tap-to-seek. (FoliateView itself imports a server
 * action, which the component bundler cannot load.)
 */
function openReader(controller: ReadAlongController) {
  cy.fixture('readalong/book.epub', null).then(async (epub: ArrayBuffer) => {
    await import('foliate-js/view.js')
    const container = document.createElement('div')
    container.style.width = '700px'
    container.style.height = '500px'
    document.body.appendChild(container)
    const view = document.createElement('foliate-view') as FoliateViewElement
    view.style.display = 'block'
    view.style.width = '100%'
    view.style.height = '100%'
    container.appendChild(view)
    view.addEventListener('load', (event) => {
      const { doc, index } = (event as CustomEvent<{ doc: Document; index: number }>).detail
      controller.onDocLoad(doc, index)
    })
    await view.open(new File([epub], 'book.epub', { type: 'application/epub+zip' }))
    controller.attach(view)
    view.addEventListener('relocate', (event) => controller.onRelocate((event as CustomEvent<FoliateRelocateDetail>).detail))
    await view.init({ showTextStart: true })
    applyEreaderSettingsToView(view, DEFAULT_EREADER_SETTINGS, 'epub')
  })
}

describe('foliate-view read-along', () => {
  afterEach(() => {
    document.querySelectorAll('foliate-view').forEach((view) => {
      ;(view as FoliateViewElement).close()
      view.parentElement?.remove()
    })
  })

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
      }
    }
  }

  function currentContents(): Cypress.Chainable<{ doc: Document; index: number }> {
    return cy
      .get('foliate-view', { timeout: 10000 })
      .should(($view) => {
        const contents = ($view[0] as FoliateViewElement).renderer?.getContents?.() ?? []
        expect(!!contents[0]?.doc, 'rendered section').to.equal(true)
      })
      .then(($view) => {
        const [{ doc, index }] = ($view[0] as FoliateViewElement).renderer.getContents!()
        return { doc: doc!, index: index! }
      })
  }

  it('highlights the spoken sentence, follows into the next chapter and seeks on tap', () => {
    const time = fakeTime()
    const taps: number[] = []
    const controller = new ReadAlongController({ timeSource: time, onSentenceTap: (start) => taps.push(start) })
    controller.setMap(parseReadAlong(fixture))
    controller.setPlayback(true, 40)

    openReader(controller)

    // foliate exposes the OPF identifier and dcterms:modified, which match the read-along data
    currentContents().then(({ doc }) => {
      expect(doc.getElementById('s1')).to.not.equal(null)
    })
    cy.wrap(controller).invoke('getStatus').should('equal', 'ready')

    cy.then(() => time.set(1.2))
    currentContents().then(({ doc }) => {
      const s1 = doc.getElementById('s1')!
      expect(s1.classList.contains(READ_ALONG_ACTIVE_CLASS)).to.equal(true)
      expect(doc.querySelectorAll(`.${READ_ALONG_ACTIVE_CLASS}`)).to.have.length(1)
      // the theme stylesheet colours it with the background, not the text colour
      const expected = READ_ALONG_HIGHLIGHT[DEFAULT_EREADER_SETTINGS.theme].replace(/\s/g, '')
      expect(getComputedStyle(s1).backgroundColor.replace(/\s/g, '')).to.equal(expected)
    })

    // narration reaches chapter 2: follow goes there and the sentence lights up once it loads
    cy.then(() => time.set(20.5))
    cy.get('foliate-view').should(($view) => {
      const [contents] = ($view[0] as FoliateViewElement).renderer.getContents!()
      expect(contents?.doc?.getElementById('s7')?.classList.contains(READ_ALONG_ACTIVE_CLASS)).to.equal(true)
    })

    currentContents().then(({ doc }) => {
      const s8 = doc.getElementById('s8')!
      s8.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }))
      expect(taps).to.deep.equal([22.1])
    })
  })

  it('stays off for an EPUB build the data was not made for', () => {
    const time = fakeTime()
    const controller = new ReadAlongController({ timeSource: time })
    controller.setMap(parseReadAlong({ ...fixture, modified: '2026-10-29T00:00:00Z' }))
    controller.setPlayback(true, 40)

    openReader(controller)

    currentContents()
    cy.wrap(controller).invoke('getStatus').should('equal', 'mismatch')
    cy.then(() => time.set(1.2))
    currentContents().then(({ doc }) => {
      expect(doc.querySelectorAll(`.${READ_ALONG_ACTIVE_CLASS}`)).to.have.length(0)
    })
  })
})
