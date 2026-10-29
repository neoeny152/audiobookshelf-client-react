import AutoPipelineSettingsSection, {
  type AutoPipelineFeatures,
  type AutoPipelineSettingsSectionProps
} from '@/app/(main)/settings/libraries/AutoPipelineSettingsSection'
import { AUTO_PIPELINE_DEFAULTS } from '@/lib/autoPipeline'
import type { AutoPipelineSettings } from '@/types/api'
import { useState } from 'react'

const ALL_FEATURES: AutoPipelineFeatures = { autoPipeline: true, chapterbotEpub: true, chapterbotVerify: true }

/** Hosts the section like LibrarySettingsTab: the value round-trips through state. */
function Harness({ initial, onChangeSpy, ...props }: Omit<AutoPipelineSettingsSectionProps, 'value' | 'onChange'> & {
  initial?: AutoPipelineSettings
  onChangeSpy: (next: AutoPipelineSettings) => void
}) {
  const [value, setValue] = useState<AutoPipelineSettings | undefined>(initial)
  return (
    <AutoPipelineSettingsSection
      {...props}
      value={value}
      onChange={(next) => {
        onChangeSpy(next)
        setValue(next)
      }}
    />
  )
}

function mountSection({
  features = ALL_FEATURES,
  libraryProvider = 'audible',
  initial
}: { features?: AutoPipelineFeatures; libraryProvider?: string; initial?: AutoPipelineSettings } = {}) {
  cy.mount(
    <Harness
      initial={initial}
      features={features}
      libraryProvider={libraryProvider}
      audibleProviders={[
        { text: 'Audible.com', value: 'audible' },
        { text: 'Audible.co.uk', value: 'audible.uk' },
        { text: 'Google Books', value: 'google' }
      ]}
      onChangeSpy={cy.stub().as('onChange')}
    />
  )
}

describe('<AutoPipelineSettingsSection />', () => {
  it('is hidden when the server does not advertise autoPipeline', () => {
    mountSection({ features: { ...ALL_FEATURES, autoPipeline: false } })
    cy.get('[cy-id="auto-pipeline-settings"]').should('not.exist')
  })

  it('shows the defaults for a library without stored settings, with the steps off until a mode is chosen', () => {
    mountSection()
    cy.get('[cy-id="auto-pipeline-settings"]').should('contain.text', 'Automatic processing')
    cy.get('[cy-id="auto-pipeline-min-confidence"] input').should('have.value', '95')
    cy.get('[cy-id="auto-pipeline-settle"] input').should('have.value', '5')
    cy.get('[cy-id="auto-pipeline-provider-warning"]').should('not.exist')
    cy.get('[cy-id="auto-pipeline-settings"] [role="switch"]').should('have.length', 3).each((toggle) => {
      cy.wrap(toggle).should('be.disabled')
    })
  })

  it('turns on dry run and edits a step', () => {
    mountSection()
    cy.get('[cy-id="auto-pipeline-settings"]').contains('button', 'Off').click()
    cy.contains('Dry run (change nothing)').click()
    cy.get('@onChange').should('have.been.calledWithMatch', { mode: 'dryRun' })
    cy.get('[cy-id="auto-pipeline-dry-run-note"]').should('exist')
    cy.get('[cy-id="auto-pipeline-settings"] [role="switch"]').first().should('not.be.disabled').click()
    cy.get('@onChange').its('lastCall.args.0').should('deep.include', { mode: 'dryRun', autoMatch: false })
  })

  it('keeps the saved value when a number field is left empty or too small, and clamps one too large', () => {
    mountSection({ initial: { ...AUTO_PIPELINE_DEFAULTS, mode: 'on' } })
    cy.get('[cy-id="auto-pipeline-min-confidence"] input').clear().blur()
    cy.get('[cy-id="auto-pipeline-min-confidence"] input').should('have.value', '95')
    cy.get('[cy-id="auto-pipeline-min-confidence"] input').clear().type('9').blur()
    cy.get('[cy-id="auto-pipeline-min-confidence"] input').should('have.value', '95')
    cy.get('[cy-id="auto-pipeline-settle"] input').clear().type('{enter}')
    cy.get('[cy-id="auto-pipeline-settle"] input').should('have.value', '5')
    cy.get('@onChange').should('not.have.been.called')
    cy.get('[cy-id="auto-pipeline-low-confidence"]').should('not.exist')
    cy.get('[cy-id="auto-pipeline-settle"] input').clear().type('500{enter}')
    cy.get('@onChange').its('lastCall.args.0.settleMinutes').should('equal', 120)
  })

  it('warns when the minimum confidence is set below 90', () => {
    mountSection({ initial: { ...AUTO_PIPELINE_DEFAULTS, mode: 'on' } })
    cy.get('[cy-id="auto-pipeline-min-confidence"] input').clear().type('70').blur()
    cy.get('@onChange').its('lastCall.args.0.autoMatchMinConfidence').should('equal', 70)
    cy.get('[cy-id="auto-pipeline-low-confidence"]').should('contain.text', '70 %')
  })

  it('warns that matching and chapters are skipped with a non-Audible provider', () => {
    mountSection({ libraryProvider: 'google' })
    cy.get('[cy-id="auto-pipeline-provider-warning"]').should('contain.text', 'Audible')
  })

  it('disables the EPUB step without chapterbotEpub and notes a missing speech check', () => {
    mountSection({ features: { autoPipeline: true, chapterbotEpub: false, chapterbotVerify: false }, initial: { ...AUTO_PIPELINE_DEFAULTS, mode: 'on', autoEpub: true } })
    cy.get('[cy-id="auto-pipeline-no-verify"]').should('exist')
    cy.get('[cy-id="auto-pipeline-settings"] [role="switch"]').last().should('be.disabled').and('have.attr', 'aria-checked', 'false')
  })
})
