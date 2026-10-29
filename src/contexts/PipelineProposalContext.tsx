'use client'

import { createContext, useContext } from 'react'

/**
 * The library item whose auto pipeline proposal the chapter editor should load (the item page sets it when opened
 * with `?edit=chapters&proposal=pipeline`). Null everywhere else, so the editor behaves as usual.
 */
export const PipelineProposalContext = createContext<string | null>(null)

export function usePipelineProposalItemId(): string | null {
  return useContext(PipelineProposalContext)
}
