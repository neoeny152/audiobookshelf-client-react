import TextInput from '@/components/ui/TextInput'
import { EREADER_THEME_SEARCH_INPUT } from '@/lib/ereader/ereaderSettings'

const READER_COLORS = {
  light: { color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)' },
  sepia: { color: 'rgb(91, 70, 54)', background: 'rgb(244, 236, 216)' },
  dark: { color: 'rgb(255, 255, 255)', background: 'rgb(35, 35, 35)' }
} as const

describe('<TextInput />', () => {
  afterEach(() => {
    cy.document().then((doc) => {
      doc.documentElement.className = ''
    })
  })

  it('clears the value with the clear button', () => {
    const onChange = cy.stub().as('onChange')
    const onClear = cy.stub().as('onClear')
    cy.mount(<TextInput value="query" clearable onChange={onChange} onClear={onClear} />)
    cy.get('[cy-id="text-input-clear"]').click()
    cy.get('@onChange').should('have.been.calledWith', '')
    cy.get('@onClear').should('have.been.calledOnce')
  })

  // The ereader clear button follows the reader theme, not the app theme, so its override must win over the
  // IconBtn/ButtonBase hover and focus colors (which use the app --foreground tokens)
  ;(['light', 'sepia', 'dark'] as const).forEach((readerTheme) => {
    const appTheme = readerTheme === 'dark' ? 'light' : 'dark'

    it(`ereader ${readerTheme} clear button inherits the reader color on hover and focus in the ${appTheme} app theme`, () => {
      cy.document().then((doc) => {
        doc.documentElement.className = `theme-${appTheme}`
      })
      const classes = EREADER_THEME_SEARCH_INPUT[readerTheme]
      const { color, background } = READER_COLORS[readerTheme]
      cy.mount(
        <div cy-id="reader" style={{ color, background, padding: 16 }}>
          <TextInput
            value="query"
            clearable
            type="search"
            wrapperClassName={classes.wrapperClassName}
            customInputClass={classes.customInputClass}
            clearButtonClassName={classes.clearButtonClassName}
          />
        </div>
      )

      cy.get('[cy-id="text-input-clear"]').should('have.css', 'color', color)

      cy.get('[cy-id="text-input-clear"]').realHover()
      cy.get('[cy-id="text-input-clear"]').should('have.css', 'color', color)

      // Keyboard focus triggers :focus-visible
      cy.get('[cy-id="text-input-field"]').focus()
      cy.realPress('Tab')
      cy.focused().should('have.attr', 'cy-id', 'text-input-clear')
      cy.get('[cy-id="text-input-clear"]').should('have.css', 'color', color)
    })
  })
})
