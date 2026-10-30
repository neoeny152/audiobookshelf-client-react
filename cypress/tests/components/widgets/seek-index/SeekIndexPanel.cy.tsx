import SeekIndexPanel, { type SeekIndexPanelProps } from '@/components/widgets/seek-index/SeekIndexPanel'
import type { SeekIndexFileStatus, SeekIndexRepairResult, SeekIndexStatus } from '@/types/api'

// Red Rising: stored (estimated) vs real durations
const parts: SeekIndexFileStatus[] = [
  { index: 1, ino: 'i1', filename: 'Part  I  Slave.mp3', duration: 7571.36475, mp3SeekIndex: 'none', needsRepair: true },
  { index: 2, ino: 'i2', filename: 'Part  II  Reborn.mp3', duration: 13280.172938, mp3SeekIndex: 'none', needsRepair: true },
  { index: 3, ino: 'i3', filename: 'Part  III  Gold.mp3', duration: 18416.831063, mp3SeekIndex: 'xing', needsRepair: false }
]

function status(files: SeekIndexFileStatus[] = parts): SeekIndexStatus {
  return { files, needsRepairCount: files.filter((f) => f.needsRepair).length, processing: false, lastResult: null }
}

const result: SeekIndexRepairResult = {
  libraryItemId: 'li_1',
  finishedAt: 1,
  files: [
    { filename: 'Part  I  Slave.mp3', ino: 'i1', status: 'repaired', oldDuration: 7571.36475, newDuration: 7588.78 },
    { filename: 'Part  II  Reborn.mp3', ino: 'i2', status: 'repaired', oldDuration: 13280.172938, newDuration: 13310.72 }
  ],
  oldTotalDuration: 39268.37,
  newTotalDuration: 39315.69,
  chapters: { count: 12, mode: 'keep', shifted: false, maxShift: 47.96 }
}

function mountPanel(overrides: Partial<SeekIndexPanelProps> = {}) {
  const props: SeekIndexPanelProps = {
    status: status(),
    chapterCount: 12,
    running: false,
    progress: '0%',
    measuring: false,
    starting: false,
    error: null,
    result: null,
    taskError: null,
    onMeasure: cy.stub().as('onMeasure'),
    onRepair: cy.stub().as('onRepair'),
    onDismissResult: cy.stub().as('onDismissResult'),
    ...overrides
  }
  cy.mount(<SeekIndexPanel {...props} />)
}

describe('<SeekIndexPanel />', () => {
  it('renders nothing when every MP3 has a seek index', () => {
    mountPanel({ status: status([{ ...parts[2] }]) })
    cy.get('[cy-id="seek-index-panel"]').should('not.exist')
  })

  it('warns about the files without a seek index and measures on request', () => {
    mountPanel()
    cy.get('[cy-id="seek-index-warning"]').should('contain.text', '2 MP3 files have no seek index')
    cy.get('[cy-id="seek-index-measured"]').should('not.exist')
    cy.contains('button', 'Measure drift').click()
    cy.get('@onMeasure').should('have.been.calledOnce')
  })

  it('lists the measured drift per file, and no drift for a file whose estimate was right', () => {
    const measured = [
      { ...parts[0], measuredDuration: 7588.78, durationError: 17.415 },
      { ...parts[1], measuredDuration: 13280.2, durationError: 0.027 }
    ]
    mountPanel({ status: status(measured) })
    cy.get('[cy-id="seek-index-measured"]').should('have.length', 2)
    cy.get('[cy-id="seek-index-measured"]').eq(0).should('have.text', 'Part  I  Slave.mp3: 02:06:11 → 02:06:28 (+17.4 s)')
    cy.get('[cy-id="seek-index-measured"]').eq(1).should('have.text', 'Part  II  Reborn.mp3: no drift')
  })

  it('confirms before repairing and keeps chapters by default', () => {
    mountPanel()
    cy.contains('button', 'Repair').click()
    cy.get('[cy-id="seek-index-confirm"]').should('contain.text', 'Rewrite 2 MP3 files with a seek index?').and('contain.text', 'not re-encoded')
    cy.get('[cy-id="seek-index-confirm"]').should('contain.text', 'Shift the 12 saved chapters with the files')
    cy.get('@onRepair').should('not.have.been.called')
    cy.get('[role="dialog"]').contains('button', 'Repair').click()
    cy.get('@onRepair').should('have.been.calledOnceWith', { chapters: 'keep' })
  })

  it('sends chapters: shift when the option is ticked', () => {
    mountPanel()
    cy.contains('button', 'Repair').click()
    cy.get('[cy-id="seek-index-confirm"] input[type="checkbox"]').click()
    cy.get('[role="dialog"]').contains('button', 'Repair').click()
    cy.get('@onRepair').should('have.been.calledOnceWith', { chapters: 'shift' })
  })

  it('does not offer the chapter shift without saved chapters', () => {
    mountPanel({ chapterCount: 0 })
    cy.contains('button', 'Repair').click()
    cy.get('[cy-id="seek-index-confirm"]').should('not.contain.text', 'saved chapters')
    cy.get('[role="dialog"]').contains('button', 'Repair').click()
    cy.get('@onRepair').should('have.been.calledOnceWith', { chapters: 'keep' })
  })

  it('shows progress instead of the warning while the repair runs', () => {
    mountPanel({ running: true, progress: '42%' })
    cy.get('[cy-id="seek-index-progress"]').should('contain.text', '42%')
    cy.get('[cy-id="seek-index-warning"]').should('not.exist')
  })

  it('shows old vs new durations and the chapter note after the repair', () => {
    mountPanel({ status: status(parts.map((p) => ({ ...p, mp3SeekIndex: 'xing', needsRepair: false }))), result })
    cy.get('[cy-id="seek-index-warning"]').should('not.exist')
    cy.get('[cy-id="seek-index-result"]').should('contain.text', 'Seek index added to 2 files. Total duration 10:54:28 → 10:55:15 (+47.3 s).')
    cy.get('[cy-id="seek-index-result-file"]').eq(0).should('have.text', 'Part  I  Slave.mp3: 02:06:11 → 02:06:28 (+17.4 s)')
    cy.get('[cy-id="seek-index-result-file"]').eq(1).should('have.text', 'Part  II  Reborn.mp3: 03:41:20 → 03:41:50 (+30.5 s)')
    cy.get('[cy-id="seek-index-result-chapters"]').should('contain.text', 're-run chapter lookup or snap')
    cy.get('button[aria-label="Close"]').click()
    cy.get('@onDismissResult').should('have.been.calledOnce')
  })

  it('reports shifted chapters and failed files', () => {
    const mixed: SeekIndexRepairResult = {
      ...result,
      files: [result.files[0], { filename: 'Part  II  Reborn.mp3', ino: 'i2', status: 'failed', oldDuration: 13280.17, newDuration: null, error: 'Verification failed: Audio frame count changed (10 -> 9)' }],
      chapters: { count: 12, mode: 'shift', shifted: true, maxShift: 17.42 }
    }
    mountPanel({ result: mixed, taskError: 'Failed to repair "Part  II  Reborn.mp3"' })
    cy.get('[cy-id="seek-index-result"]').should('contain.text', 'Seek index repair failed')
    cy.get('[cy-id="seek-index-result-file"]').eq(1).should('contain.text', 'Audio frame count changed')
    cy.get('[cy-id="seek-index-result-chapters"]').should('have.text', 'Saved chapter times were shifted by up to 17.4 s.')
  })
})
