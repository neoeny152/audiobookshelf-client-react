import type { LibraryFilterData } from '@/types/api'

/**
 * The Issues page lists missing/invalid items and possible duplicates (fork server feature duplicateItems).
 * It is left once there is nothing to list, except after duplicates were shown on this visit: dismissing the last
 * group must not navigate away, so the admin can still show dismissed groups and flag one again.
 */
export function shouldLeaveIssuesPage(filterData: Pick<LibraryFilterData, 'numIssues' | 'numDuplicateGroups'>, duplicatesShown: boolean): boolean {
  if ((filterData.numIssues ?? 0) > 0 || (filterData.numDuplicateGroups ?? 0) > 0) return false
  return !duplicatesShown
}
