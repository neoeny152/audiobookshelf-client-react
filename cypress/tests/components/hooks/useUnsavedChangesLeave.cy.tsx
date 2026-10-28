import { useUnsavedChangesLeave } from '@/hooks/useUnsavedChangesLeave'
import { useCallback, useRef } from 'react'

function LeaveProbe({ isDirty, log }: { isDirty: boolean; log: (entry: string) => void }) {
  const onBeforeLeave = useCallback(() => log('beforeLeave'), [log])
  const onDiscard = useCallback(() => log('discard'), [log])
  const { showLeaveConfirm, requestLeave, cancelLeave, discardAndLeave, completePendingLeave, captureLeave } = useUnsavedChangesLeave({
    isDirty,
    onBeforeLeave,
    onDiscard
  })
  const capturedRef = useRef<(() => void) | null>(null)

  return (
    <div>
      <span data-cy="confirm">{String(showLeaveConfirm)}</span>
      <button data-cy="request" onClick={() => requestLeave(() => log('leave'))}>
        request
      </button>
      <button data-cy="cancel" onClick={cancelLeave}>
        cancel
      </button>
      <button data-cy="discard" onClick={discardAndLeave}>
        discard
      </button>
      <button data-cy="complete" onClick={() => log(`completed:${completePendingLeave()}`)}>
        complete
      </button>
      <button data-cy="capture" onClick={() => (capturedRef.current = captureLeave())}>
        capture
      </button>
      <button data-cy="run-captured" onClick={() => capturedRef.current?.()}>
        run captured
      </button>
    </div>
  )
}

describe('useUnsavedChangesLeave', () => {
  it('leaves right away when clean', () => {
    const log = cy.stub().as('log')
    cy.mount(<LeaveProbe isDirty={false} log={log} />)
    cy.get('[data-cy="request"]').click()
    cy.get('[data-cy="confirm"]').should('have.text', 'false')
    cy.get('@log')
      .its('args')
      .should('deep.equal', [['beforeLeave'], ['leave']])
  })

  it('holds the leave while dirty and cancel drops it', () => {
    const log = cy.stub().as('log')
    cy.mount(<LeaveProbe isDirty log={log} />)
    cy.get('[data-cy="request"]').click()
    cy.get('[data-cy="confirm"]').should('have.text', 'true')
    cy.get('@log').should('not.have.been.called')
    cy.get('[data-cy="cancel"]').click()
    cy.get('[data-cy="confirm"]').should('have.text', 'false')
    cy.get('[data-cy="complete"]').click()
    cy.get('@log')
      .its('args')
      .should('deep.equal', [['completed:false']])
  })

  it('discard runs onDiscard, onBeforeLeave, then the leave', () => {
    const log = cy.stub().as('log')
    cy.mount(<LeaveProbe isDirty log={log} />)
    cy.get('[data-cy="request"]').click()
    cy.get('[data-cy="discard"]').click()
    cy.get('[data-cy="confirm"]').should('have.text', 'false')
    cy.get('@log')
      .its('args')
      .should('deep.equal', [['discard'], ['beforeLeave'], ['leave']])
  })

  it('completes a held leave after a save', () => {
    const log = cy.stub().as('log')
    cy.mount(<LeaveProbe isDirty log={log} />)
    cy.get('[data-cy="request"]').click()
    cy.get('[data-cy="complete"]').click()
    cy.get('[data-cy="confirm"]').should('have.text', 'false')
    cy.get('@log')
      .its('args')
      .should('deep.equal', [['beforeLeave'], ['leave'], ['completed:true']])
  })

  it('a captured leave still runs after the held leave is cleared', () => {
    const log = cy.stub().as('log')
    cy.mount(<LeaveProbe isDirty log={log} />)
    cy.get('[data-cy="request"]').click()
    cy.get('[data-cy="capture"]').click()
    cy.get('[data-cy="cancel"]').click()
    cy.get('[data-cy="run-captured"]').click()
    cy.get('@log')
      .its('args')
      .should('deep.equal', [['beforeLeave'], ['leave']])
  })
})
