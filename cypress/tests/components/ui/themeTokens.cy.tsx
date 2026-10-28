import Modal from '@/components/modals/Modal'
import Checkbox from '@/components/ui/Checkbox'
import Toast from '@/components/widgets/Toast'

const setTheme = (theme: string) => {
  cy.document().then((doc) => {
    doc.documentElement.className = `theme-${theme}`
  })
}

/** Normalizes any CSS color (oklch, oklab, hex, …) to [r, g, b, a] via a 1px canvas. */
const toRgba = (doc: Document, color: string): number[] => {
  const ctx = doc.createElement('canvas').getContext('2d')!
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  return Array.from(ctx.getImageData(0, 0, 1, 1).data)
}

const expectLightText = (selector: string) => {
  cy.document().then((doc) => {
    cy.get(selector).then(($el) => {
      const [r, g, b, a] = toRgba(doc, getComputedStyle($el[0]).color)
      // Rendered on its own the color must be near white: the close buttons sit on dark or saturated surfaces
      expect(Math.min(r, g, b), `${selector} color channels`).to.be.greaterThan(200)
      expect(a, `${selector} alpha`).to.be.greaterThan(150)
    })
  })
}

const rowTokens: Record<string, { stripe: string; hover: string }> = {
  dark: { stripe: 'rgba(255, 255, 255, 0.05)', hover: 'rgba(255, 255, 255, 0.1)' },
  light: { stripe: 'rgba(0, 0, 0, 0.04)', hover: 'rgba(0, 0, 0, 0.08)' },
  black: { stripe: 'rgba(255, 255, 255, 0.05)', hover: 'rgba(255, 255, 255, 0.1)' }
}

describe('theme tokens', () => {
  afterEach(() => {
    cy.document().then((doc) => {
      doc.documentElement.className = ''
    })
  })

  Object.entries(rowTokens).forEach(([theme, expected]) => {
    describe(`theme-${theme}`, () => {
      beforeEach(() => setTheme(theme))

      it('resolves the row stripe and row hover tokens', () => {
        cy.mount(
          <div>
            <div cy-id="stripe" className="bg-row-stripe h-4" />
            <div cy-id="hover" className="bg-row-hover h-4" />
          </div>
        )
        // Light rows darken and dark rows lighten, so the stripe stays visible on every theme
        cy.get('[cy-id="stripe"]').should('have.css', 'background-color', expected.stripe)
        cy.get('[cy-id="hover"]').should('have.css', 'background-color', expected.hover)
      })

      it('uses the success color for the checkbox check', () => {
        cy.mount(<Checkbox value={true} />)
        cy.get('svg').should('have.css', 'color', 'rgb(76, 175, 80)')
      })

      it('keeps the modal close button light on the dark top band', () => {
        cy.mount(
          <Modal isOpen onClose={() => {}}>
            <div className="p-4">Body</div>
          </Modal>
        )
        // The band behind the title and close button is a fixed gray-800/900 gradient in every theme
        cy.get('[cy-id="modal-wrapper"] > div').first().should('have.class', 'to-gray-800/70')
        cy.get('[cy-id="modal-close-button"]').should('have.class', 'text-gray-200')
        expectLightText('[cy-id="modal-close-button"]')
        cy.get('[cy-id="modal-close-button"]').should('not.have.class', 'text-button-foreground-muted')
      })

      it('keeps the toast close button white on the colored toast', () => {
        cy.mount(<Toast id="t" type="success" message="Saved" />)
        expectLightText('[cy-id="close-button"]')
      })
    })
  })
})
