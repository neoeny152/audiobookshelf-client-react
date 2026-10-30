import SeekIndexPanel, { type SeekIndexPanelProps } from '@/components/widgets/seek-index/SeekIndexPanel'
import type { SeekIndexBackup, SeekIndexFileStatus, SeekIndexRepairResult, SeekIndexStatus } from '@/types/api'

// Red Rising: stored (estimated) vs measured durations; Part III has a header, Part IV is CBR without drift
const parts: SeekIndexFileStatus[] = [
  {
    index: 1,
    ino: 'i1',
    filename: 'Part  I  Slave.mp3',
    duration: 7571.36475,
    mp3SeekIndex: 'none',
    needsRepair: true,
    measuredDuration: 7588.78,
    durationError: 17.415
  },
  {
    index: 2,
    ino: 'i2',
    filename: 'Part  II  Reborn.mp3',
    duration: 13280.172938,
    mp3SeekIndex: 'none',
    needsRepair: true,
    measuredDuration: 13310.72,
    durationError: 30.547
  },
  { index: 3, ino: 'i3', filename: 'Part  III  Gold.mp3', duration: 18459.193, mp3SeekIndex: 'xing', needsRepair: false },
  {
    index: 4,
    ino: 'i4',
    filename: 'Part  IV  Reaper.mp3',
    duration: 18902.6,
    mp3SeekIndex: 'none',
    needsRepair: false,
    measuredDuration: 18902.62,
    durationError: 0.02
  }
]

const backup: SeekIndexBackup = {
  id: '20261030T154012Z',
  libraryItemId: 'li_1',
  title: 'Red Rising',
  createdAt: Date.parse('2026-10-30T15:40:12Z'),
  files: [
    { relPath: 'Part  I  Slave.mp3', filename: 'Part  I  Slave.mp3', size: 121141836, oldDuration: 7571.36475, newDuration: 7588.78 },
    { relPath: 'Part  II  Reborn.mp3', filename: 'Part  II  Reborn.mp3', size: 212482767, oldDuration: 13280.172938, newDuration: 13310.72 }
  ],
  size: 333624603
}

function status(files: SeekIndexFileStatus[] = parts, backups: SeekIndexBackup[] = []): SeekIndexStatus {
  const flagged = files.filter((f) => f.needsRepair)
  return {
    files,
    needsRepairCount: flagged.length,
    maxDrift: Math.max(0, ...flagged.map((f) => Math.abs(f.durationError ?? 0))),
    processing: false,
    lastResult: null,
    backups,
    backupsTotalSize: backups.reduce((sum, b) => sum + b.size, 0)
  }
}

const result: SeekIndexRepairResult = {
  type: 'repair',
  libraryItemId: 'li_1',
  finishedAt: 1,
  files: [
    { filename: 'Part  I  Slave.mp3', ino: 'i1', status: 'repaired', oldDuration: 7571.36475, newDuration: 7588.78 },
    { filename: 'Part  II  Reborn.mp3', ino: 'i2', status: 'repaired', oldDuration: 13280.172938, newDuration: 13310.72 }
  ],
  oldTotalDuration: 39268.37,
  newTotalDuration: 39315.69,
  chapters: { count: 12, mode: 'keep', shifted: false, maxShift: 47.96 },
  backupId: backup.id
}

const repaired = () => status(parts.map((p) => ({ ...p, mp3SeekIndex: p.needsRepair ? 'xing' : p.mp3SeekIndex, needsRepair: false })))

function mountPanel(overrides: Partial<SeekIndexPanelProps> = {}) {
  const props: SeekIndexPanelProps = {
    status: status(),
    chapterCount: 12,
    running: false,
    progress: '0%',
    starting: false,
    error: null,
    result: null,
    taskError: null,
    onRepair: cy.stub().as('onRepair'),
    onRestore: cy.stub().as('onRestore'),
    onDeleteBackup: cy.stub().as('onDeleteBackup'),
    onDismissResult: cy.stub().as('onDismissResult'),
    ...overrides
  }
  cy.mount(<SeekIndexPanel {...props} />)
}

describe('<SeekIndexPanel />', () => {
  it('renders nothing when no MP3 drifts and there are no backups', () => {
    mountPanel({ status: status([parts[2], parts[3]]) })
    cy.get('[cy-id="seek-index-panel"]').should('not.exist')
  })

  it('warns about the drifting files only, with their measured drift', () => {
    mountPanel()
    cy.get('[cy-id="seek-index-warning"]').should('contain.text', '2 MP3 files are missing a seek index').and('contain.text', 'by up to 30.5 s')
    cy.get('[cy-id="seek-index-measured"]').should('have.length', 2)
    cy.get('[cy-id="seek-index-measured"]').eq(0).should('have.text', 'Part  I  Slave.mp3: 02:06:11 → 02:06:28 (+17.4 s)')
    cy.get('[cy-id="seek-index-warning"]').should('not.contain.text', 'Reaper')
  })

  it('confirms before repairing, mentions the backup and keeps chapter times by default', () => {
    mountPanel()
    cy.contains('button', 'Repair').click()
    cy.get('[cy-id="seek-index-confirm"]')
      .should('contain.text', 'Rewrite 2 MP3 files with a seek index?')
      .and('contain.text', 'no re-encoding')
      .and('contain.text', 'kept as a backup you can restore')
    cy.get('@onRepair').should('not.have.been.called')
    cy.get('[role="dialog"]').contains('button', 'Repair').click()
    cy.get('@onRepair').should('have.been.calledOnceWith', { chapters: 'keep' })
  })

  it('shifts saved chapters when the option is ticked', () => {
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

  it('offers Resume for a repair that a restart cut short, keeping its chapter choice', () => {
    const files = parts.map((p, i) => (i === 0 ? { ...p, mp3SeekIndex: 'xing' as const, needsRepair: false } : p))
    mountPanel({
      status: { ...status(files, [backup]), interrupted: { backupId: backup.id, pendingCount: 1, files: ['Part  II  Reborn.mp3'], mode: 'shift' } }
    })
    cy.get('[cy-id="seek-index-interrupted"]').should('have.text', 'Repair was interrupted: 1 files still need repair.')
    cy.contains('button', 'Resume').click()
    cy.get('[role="dialog"]').should('not.exist')
    cy.get('@onRepair').should('have.been.calledOnceWith', { chapters: 'shift' })
  })

  it('shows progress instead of the warning while a task runs', () => {
    mountPanel({ running: true, progress: '42%', status: status(parts, [backup]) })
    cy.get('[cy-id="seek-index-progress"]').should('contain.text', '42%')
    cy.get('[cy-id="seek-index-warning"]').should('not.exist')
    cy.get('[cy-id="seek-index-backups"]').should('not.exist')
  })

  it('shows old vs new durations, the chapter note and the backup after the repair', () => {
    mountPanel({ status: status(repaired().files, [backup]), result })
    cy.get('[cy-id="seek-index-warning"]').should('not.exist')
    cy.get('[cy-id="seek-index-result"]').should('contain.text', 'Seek index added to 2 files. Total duration 10:54:28 → 10:55:15 (+47.3 s).')
    cy.get('[cy-id="seek-index-result-file"]').eq(1).should('have.text', 'Part  II  Reborn.mp3: 03:41:20 → 03:41:50 (+30.5 s)')
    cy.get('[cy-id="seek-index-result-chapters"]').should('contain.text', 're-run chapter lookup or snap')
    cy.get('[cy-id="seek-index-result-backup"]').should('contain.text', 'Backup kept (333.62 MB)')
    cy.get('button[aria-label="Close"]').click()
    cy.get('@onDismissResult').should('have.been.calledOnce')
  })

  it('reports shifted chapters, a moved last end and failed files', () => {
    mountPanel({ result: { ...result, chapters: { ...result.chapters, endExtended: true } } })
    cy.get('[cy-id="seek-index-result-chapters"]').should('contain.text', 'the last chapter now runs to the new end')
    const mixed: SeekIndexRepairResult = {
      ...result,
      files: [
        result.files[0],
        {
          filename: 'Part  II  Reborn.mp3',
          ino: 'i2',
          status: 'failed',
          oldDuration: 13280.17,
          newDuration: null,
          error: 'Verification failed: Audio frame count changed (10 -> 9)'
        }
      ],
      chapters: { count: 12, mode: 'shift', shifted: true, maxShift: 17.42 }
    }
    mountPanel({ result: mixed, taskError: 'Failed to repair "Part  II  Reborn.mp3"' })
    cy.get('[cy-id="seek-index-result"]').should('contain.text', 'Seek index repair failed')
    cy.get('[cy-id="seek-index-result-file"]').eq(1).should('contain.text', 'Audio frame count changed')
    cy.get('[cy-id="seek-index-result-chapters"]').should('have.text', 'Saved chapter times were shifted by up to 17.4 s.')
  })

  it('lists backups with their size and the total, and restores after a confirm', () => {
    mountPanel({ status: status(repaired().files, [backup]) })
    cy.get('[cy-id="seek-index-backup"]').should('have.length', 1).and('contain.text', '2 files').and('contain.text', '333.62 MB')
    cy.get('[cy-id="seek-index-backups-total"]').should('contain.text', '333.62 MB')
    cy.contains('button', 'Restore originals').click()
    cy.get('[cy-id="seek-index-confirm"]')
      .should('contain.text', 'Put the 2 original MP3 files')
      .and('contain.text', 'go back to how they were before the repair')
    cy.get('[role="dialog"]').contains('button', 'Restore originals').click()
    cy.get('@onRestore').should('have.been.calledOnceWith', backup.id)
  })

  it('deletes a backup after a confirm, and cancel does nothing', () => {
    mountPanel({ status: status(repaired().files, [backup]) })
    cy.contains('button', 'Delete backup').click()
    cy.get('[role="dialog"]').contains('button', 'Cancel').click()
    cy.get('@onDeleteBackup').should('not.have.been.called')
    cy.contains('button', 'Delete backup').click()
    cy.get('[cy-id="seek-index-confirm"]').should('contain.text', 'cannot be undone')
    cy.get('[role="dialog"]').contains('button', 'Delete backup').click()
    cy.get('@onDeleteBackup').should('have.been.calledOnceWith', backup.id)
  })

  it('shows the restore result', () => {
    const restored: SeekIndexRepairResult = {
      ...result,
      type: 'restore',
      files: result.files.map((f) => ({ ...f, status: 'restored', oldDuration: f.newDuration ?? 0, newDuration: f.oldDuration })),
      oldTotalDuration: 39315.69,
      newTotalDuration: 39268.37,
      chapters: { count: 12, mode: 'keep', shifted: false, restored: true, maxShift: 0 },
      backupId: null
    }
    mountPanel({ result: restored })
    cy.get('[cy-id="seek-index-result"]').should('contain.text', 'Originals put back for 2 files').and('contain.text', '(−47.3 s)')
    cy.get('[cy-id="seek-index-result-chapters"]').should('have.text', 'Saved chapters were put back as they were before the repair.')
  })
})
