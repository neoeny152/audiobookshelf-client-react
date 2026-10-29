import {
  buildFoliateUserStyles,
  DEFAULT_EREADER_SETTINGS,
  loadEreaderSettings,
  READ_ALONG_HIGHLIGHT,
  type EreaderSettings
} from '@/lib/ereader/ereaderSettings'

function stylesFor(patch: Partial<EreaderSettings> = {}) {
  return buildFoliateUserStyles({ ...DEFAULT_EREADER_SETTINGS, ...patch })
}

function lineHeightDeclaration(css: string) {
  const match = css.match(/line-height:\s*([^;]+);/)
  expect(match, 'expected a line-height declaration').to.not.equal(null)
  return match![1].trim()
}

describe('buildFoliateUserStyles', () => {
  it('uses a unitless line-height from the default spacing, not rem', () => {
    const css = stylesFor()
    expect(lineHeightDeclaration(css)).to.equal('1.15 !important')
    expect(css).to.not.include('rem')
    expect(css).to.include('font-size: 100%;')
  })

  it('keeps line-height independent of font scale', () => {
    const css = stylesFor({ fontScale: 200 })
    expect(css).to.include('font-size: 200%;')
    expect(lineHeightDeclaration(css)).to.equal('1.15 !important')
    expect(css).to.not.include('2.3rem')
  })

  it('scales line-height with the spacing setting regardless of font scale', () => {
    expect(lineHeightDeclaration(stylesFor({ lineSpacing: 150 }))).to.equal('1.5 !important')
    expect(lineHeightDeclaration(stylesFor({ lineSpacing: 150, fontScale: 200 }))).to.equal('1.5 !important')
    expect(lineHeightDeclaration(stylesFor({ lineSpacing: 150, fontScale: 300 }))).to.equal('1.5 !important')
  })
})

describe('read-along settings', () => {
  it('styles the active sentence with a background colour in every theme', () => {
    for (const theme of ['dark', 'light', 'sepia'] as const) {
      const css = stylesFor({ theme })
      const rule = css.match(/\.abs-ra-active\s*\{([^}]*)\}/)
      expect(rule, `highlight rule for ${theme}`).to.not.equal(null)
      expect(rule![1]).to.include(`background-color: ${READ_ALONG_HIGHLIGHT[theme]} !important`)
      expect(rule![1]).to.not.match(/(^|[^-])color:/)
    }
  })

  it('loads settings stored before read-along existed with the new defaults', () => {
    const stored = { theme: 'sepia', font: 'sans-serif', fontScale: 120, lineSpacing: 150, textStroke: 0, spread: 'none' }
    localStorage.setItem('ereaderSettings', JSON.stringify(stored))
    try {
      const settings = loadEreaderSettings()
      expect(settings.theme).to.equal('sepia')
      expect(settings.readAlong).to.equal(true)
      expect(settings.readAlongTapToSeek).to.equal(true)
    } finally {
      localStorage.removeItem('ereaderSettings')
    }
  })
})
