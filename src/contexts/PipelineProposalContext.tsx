'use client'

import { createContext, useContext } from 'react'

export interface PipelineProposalTarget {
  /** The library item whose proposal the chapter editor should load. */
  itemId: string
  /**
   * The proposal was approved, kept or is gone: the item page stops asking for it, so reopening the chapters tab in the
   * same modal does not fetch it again (a 404) or put it back over the saved chapters.
   */
  onResolved: () => void
}

/**
 * The auto pipeline proposal the chapter editor should load (the item page sets it when opened with
 * `?edit=chapters&proposal=pipeline`). Null everywhere else, so the editor behaves as usual.
 */
export const PipelineProposalContext = createContext<PipelineProposalTarget | null>(null)

export function usePipelineProposalTarget(): PipelineProposalTarget | null {
  return useContext(PipelineProposalContext)
}
