import { num, obj, str } from '@/lib/autoPipeline'
import type { ItemHealth, ItemHealthIssue } from '@/types/api'
import type { TypeSafeTranslations } from '@/types/translations'

/**
 * Book health (fork only, `GET /api/items/:id/health`): what is likely wrong with a book's chapters and the step to take
 * first. The item page's guided fix is built on it.
 */

const ISSUES: readonly ItemHealthIssue[] = Object.freeze([
  'seek-index',
  'unmatched',
  'low-confidence',
  'chapters-from-files',
  'chapters-length',
  'chapters-count',
  'chapters-unverified'
])
const NEXT_STEPS: readonly NonNullable<ItemHealth['next']>[] = Object.freeze(['repair', 'match', 'chapters'])

export type GuideStepId = 'repair' | 'match' | 'lookup' | 'snap' | 'save'

/** The health response, or null when it is not one. Issues keep the server's order; unknown codes are dropped. */
export function toItemHealth(value: unknown): ItemHealth | null {
  const health = obj(value)
  if (!health || typeof health.libraryItemId !== 'string' || !health.libraryItemId) return null
  const duration = obj(health.duration)
  const seekIndex = obj(health.seekIndex)
  const match = obj(health.match)
  const chapters = obj(health.chapters)
  const audible = obj(chapters?.audible)
  const autoFix = obj(health.autoFix)
  const issues = Array.isArray(health.issues) ? health.issues : []
  return {
    libraryItemId: health.libraryItemId,
    duration: { stored: num(duration?.stored) ?? 0, drift: num(duration?.drift) ?? 0, unmeasured: num(duration?.unmeasured) ?? 0 },
    seekIndex: { needsRepairCount: num(seekIndex?.needsRepairCount) ?? 0, maxDrift: num(seekIndex?.maxDrift) ?? 0, processing: seekIndex?.processing === true },
    match: { asin: str(match?.asin), confidence: num(match?.confidence), reason: str(match?.reason) },
    chapters: {
      count: num(chapters?.count) ?? 0,
      kind: str(chapters?.kind),
      end: num(chapters?.end),
      audible: audible ? { count: num(audible.count) ?? 0, runtimeSec: num(audible.runtimeSec) ?? 0 } : null
    },
    issues: ISSUES.filter((issue) => issues.includes(issue)),
    next: NEXT_STEPS.find((step) => step === health.next) ?? null,
    autoFix: { available: autoFix?.available === true, autoRepair: autoFix?.autoRepair === true, minConfidence: num(autoFix?.minConfidence) ?? 90 }
  }
}

/** Guide me, in order: repair and match only when the book needs them, then lookup, snap and save. */
export function getGuideSteps(health: Pick<ItemHealth, 'issues'>): GuideStepId[] {
  const steps: GuideStepId[] = []
  if (health.issues.includes('seek-index')) steps.push('repair')
  if (health.issues.includes('unmatched') || health.issues.includes('low-confidence')) steps.push('match')
  return [...steps, 'lookup', 'snap', 'save']
}

/** "4.2 s" under a minute, "1 min 30 s" from a minute up; the sign is dropped (callers say "off by"). */
export function formatDrift(seconds: number, t: TypeSafeTranslations): string {
  const abs = Math.abs(seconds)
  if (abs < 60) return t('LabelDriftSeconds', { s: abs.toFixed(1) })
  const total = Math.round(abs)
  return t('LabelDriftMinutes', { m: Math.floor(total / 60), s: total % 60 })
}

/*
 * The item page card can be dismissed; it comes back when the set of issues changes. Kept per item in this browser.
 */

const DISMISS_PREFIX = 'guidedFix.dismissed.'

export function rememberGuidedFixDismissed(libraryItemId: string, issues: ItemHealthIssue[]): void {
  try {
    localStorage.setItem(`${DISMISS_PREFIX}${libraryItemId}`, issues.join(','))
  } catch {
    // Storage unavailable: the card shows again next time
  }
}

export function isGuidedFixDismissed(libraryItemId: string, issues: ItemHealthIssue[]): boolean {
  try {
    return localStorage.getItem(`${DISMISS_PREFIX}${libraryItemId}`) === issues.join(',')
  } catch {
    return false
  }
}
