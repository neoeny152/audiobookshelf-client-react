import { num, obj, str } from '@/lib/autoPipeline'
import type { ItemHealth, ItemHealthIssue, NeedsWorkItem } from '@/types/api'
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

export type GuideStepId = 'repair' | 'match' | 'lookup' | 'snap' | 'save' | 'epub'

/**
 * What the guide's EPUB step offers: `create` a read-along EPUB from the audio for a book without an EPUB. Adding
 * highlighting to a book's existing EPUB joins it once the server can align one.
 */
export type EpubOffer = 'create'

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

/** The needs-work response's books (see toItemHealth); entries that are not one are dropped. */
export function toNeedsWorkItems(value: unknown): NeedsWorkItem[] {
  const items = obj(value)?.items
  if (!Array.isArray(items)) return []
  return items.flatMap((entry) => {
    const health = toItemHealth(entry)
    if (!health) return []
    const { libraryItemId, issues, next, duration, match, chapters } = health
    return [{ libraryItemId, title: str(obj(entry)?.title) ?? '', issues, next, duration, match, chapters }]
  })
}

/** Why the issue matters, in one sentence ('' for `chapters-unverified`, which is never shown). */
export function getIssueReason(issue: ItemHealthIssue, health: Pick<ItemHealth, 'duration' | 'match' | 'chapters'>, t: TypeSafeTranslations): string {
  switch (issue) {
    case 'seek-index':
      return t('MessageGuidedFixReasonSeekIndex', { drift: formatDrift(health.duration.drift, t) })
    case 'unmatched':
      return t('MessageGuidedFixReasonUnmatched')
    case 'low-confidence':
      return t('MessageGuidedFixReasonLowConfidence', { confidence: health.match.confidence ?? 0 })
    case 'chapters-from-files':
      return t('MessageGuidedFixReasonFromFiles')
    case 'chapters-length':
      return t('MessageGuidedFixReasonLength', { diff: formatDrift((health.chapters.end ?? 0) - health.duration.stored - health.duration.drift, t) })
    case 'chapters-count':
      return t('MessageGuidedFixReasonCount', { count: health.chapters.count, audible: health.chapters.audible?.count ?? 0 })
    default:
      return ''
  }
}

/**
 * Guide me, in order: repair and match only when the book needs them, then lookup, snap and save, and last the optional
 * EPUB step when `epub` (there is an EpubOffer for the book).
 */
export function getGuideSteps(health: Pick<ItemHealth, 'issues'>, { epub = false }: { epub?: boolean } = {}): GuideStepId[] {
  const steps: GuideStepId[] = []
  if (health.issues.includes('seek-index')) steps.push('repair')
  if (health.issues.includes('unmatched') || health.issues.includes('low-confidence')) steps.push('match')
  steps.push('lookup', 'snap', 'save')
  if (epub) steps.push('epub')
  return steps
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

/*
 * What to do about books that need work, chosen at the end of a guide and changed on the account page; kept in this
 * browser. Unset: ask at the end of the next guide. `off`: no hint, no cover badges, no guide.
 */

export type GuidancePreference = 'auto' | 'guide' | 'off'

const GUIDANCE_KEY = 'guidedFix.guidance'
const GUIDANCE_EVENT = 'guidedfixguidance'
const GUIDANCE_VALUES: readonly GuidancePreference[] = ['auto', 'guide', 'off']

export function getGuidancePreference(): GuidancePreference | null {
  try {
    return GUIDANCE_VALUES.find((value) => value === localStorage.getItem(GUIDANCE_KEY)) ?? null
  } catch {
    return null
  }
}

export function setGuidancePreference(value: GuidancePreference): void {
  try {
    localStorage.setItem(GUIDANCE_KEY, value)
  } catch {
    // Storage unavailable: asked again next time
  }
  window.dispatchEvent(new Event(GUIDANCE_EVENT))
}

/** For useSyncExternalStore: other tabs report through `storage`, this one through its own event */
export function subscribeGuidancePreference(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(GUIDANCE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(GUIDANCE_EVENT, onChange)
  }
}
