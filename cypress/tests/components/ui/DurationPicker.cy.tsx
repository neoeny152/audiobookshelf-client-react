import DurationPicker from '@/components/ui/DurationPicker'
import { useState } from 'react'

function Harness({ initial, external, onChange }: { initial: number; external: number; onChange: (value: number) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <DurationPicker
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <button type="button" onClick={() => setValue(external)}>
        set external
      </button>
      <output cy-id="value">{value}</output>
    </div>
  )
}

const inputs = () => cy.get('[cy-id="duration-picker-wrapper"] input')

describe('<DurationPicker /> fractional values', () => {
  it('shows whole seconds without emitting a rounded value', () => {
    const onChange = cy.spy().as('onChange')
    cy.mount(<Harness initial={16.09} external={16.2} onChange={onChange} />)

    inputs().eq(2).should('have.value', '16')
    cy.get('[cy-id="value"]').should('have.text', '16.09')
    cy.get('@onChange').should('not.have.been.called')
  })

  it('still emits the next edit after an external change that displays the same whole second', () => {
    const onChange = cy.spy().as('onChange')
    cy.mount(<Harness initial={16.09} external={16.2} onChange={onChange} />)

    cy.contains('button', 'set external').click()
    cy.get('[cy-id="value"]').should('have.text', '16.2')
    inputs().eq(2).should('have.value', '16')
    cy.get('@onChange').should('not.have.been.called')

    inputs().eq(2).focus().type('{uparrow}')
    cy.get('@onChange').should('have.been.calledOnceWith', 17)
    cy.get('[cy-id="value"]').should('have.text', '17')
  })
})
