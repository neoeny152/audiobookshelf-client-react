'use client'

import type { GuideStepId } from '@/lib/itemHealth'
import { createContext, useContext } from 'react'

export interface GuidedFix {
  stepId: GuideStepId
  /** 0-based */
  stepIndex: number
  total: number
  /** The step's place (the edit modal) was closed; the item page card offers to continue */
  paused: boolean
  /** The current step is done: go to the next one, or finish after the last */
  advance: () => void
  /** Open the current step's place again after a pause */
  resume: () => void
  stop: () => void
}

/** Guide me on the item page: the step whose control pulses. Null when no guide runs, so targets render as usual. */
export const GuidedFixContext = createContext<GuidedFix | null>(null)

export function useGuidedFix(): GuidedFix | null {
  return useContext(GuidedFixContext)
}
