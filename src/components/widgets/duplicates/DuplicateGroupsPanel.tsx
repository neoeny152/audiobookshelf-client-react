'use client'

import Btn from '@/components/ui/Btn'
import Checkbox from '@/components/ui/Checkbox'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { formatJsDate, secondsToTimestamp } from '@/lib/datefns'
import { mergeClasses } from '@/lib/merge-classes'
import { bytesPretty } from '@/lib/string'
import type { DuplicateGroup, DuplicateGroupItem, DuplicateMatchType } from '@/types/api'
import type { TranslationKey } from '@/types/translations'
import Link from 'next/link'
import { useState } from 'react'

export interface DuplicateGroupsPanelProps {
  libraryId: string
  groups: DuplicateGroup[]
  loading: boolean
  checking: boolean
  showDismissed: boolean
  /** Groups with a dismiss/restore request in flight */
  busyGroupIds: ReadonlySet<string>
  dateFormat: string
  lastCheckedAt: number | null
  error: string | null
  onCheck: () => void
  onShowDismissedChange: (value: boolean) => void
  onSetDismissed: (groupId: string, dismissed: boolean) => void
}

const MATCH_TYPE_LABELS: Record<DuplicateMatchType, TranslationKey> = {
  asin: 'LabelDuplicateMatchAsin',
  isbn: 'LabelDuplicateMatchIsbn',
  title: 'LabelDuplicateMatchTitle',
  feed: 'LabelDuplicateMatchFeed'
}

function DuplicateItemRow({ item, libraryId, dateFormat }: { item: DuplicateGroupItem; libraryId: string; dateFormat: string }) {
  const t = useTypeSafeTranslations()
  const details = [
    item.duration > 0 ? secondsToTimestamp(item.duration) : null,
    item.numAudioFiles > 0 ? t('LabelDuplicateNumAudioFiles', { count: item.numAudioFiles }) : null,
    item.numEpisodes !== undefined ? t('LabelDuplicateNumEpisodes', { count: item.numEpisodes }) : null,
    item.hasEbook ? t('LabelEbook') : null,
    item.size > 0 ? bytesPretty(item.size) : null,
    item.addedAt ? t('LabelAddedDate', { 0: formatJsDate(new Date(item.addedAt), dateFormat) }) : null
  ].filter(Boolean)

  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-2" cy-id="duplicate-item">
      <div className="flex min-w-0 items-baseline gap-2">
        <Link href={`/library/${libraryId}/item/${item.id}`} className="link-underline truncate font-semibold" cy-id="duplicate-item-link">
          {item.title || item.relPath}
        </Link>
        {item.author && <span className="text-foreground-muted truncate text-sm">{item.author}</span>}
      </div>
      {/* Full path: copies in different library folders often have the same relative path */}
      <p className="text-foreground-muted font-mono text-xs break-all" cy-id="duplicate-item-path">
        {item.path || item.relPath}
      </p>
      <p className="text-foreground-muted text-xs" cy-id="duplicate-item-details">
        {details.join(' · ')}
      </p>
    </li>
  )
}

/**
 * Possible duplicate items on the library Issues page (fork server feature duplicateItems).
 * Each group links to its items; an admin can mark a group as not a duplicate. Nothing is deleted from here.
 */
export default function DuplicateGroupsPanel({
  libraryId,
  groups,
  loading,
  checking,
  showDismissed,
  busyGroupIds,
  dateFormat,
  lastCheckedAt,
  error,
  onCheck,
  onShowDismissedChange,
  onSetDismissed
}: DuplicateGroupsPanelProps) {
  const t = useTypeSafeTranslations()
  const [collapsed, setCollapsed] = useState(false)
  const numActive = groups.filter((group) => !group.dismissed).length

  return (
    <section className="border-border flex min-h-0 flex-col gap-2 border-b px-4 py-3 sm:px-8" cy-id="duplicates-panel" aria-labelledby="duplicates-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-start"
          aria-expanded={!collapsed}
          aria-controls="duplicates-list"
          onClick={() => setCollapsed((value) => !value)}
          cy-id="duplicates-toggle"
        >
          <span className="material-symbols text-xl" aria-hidden="true">
            {collapsed ? 'expand_more' : 'expand_less'}
          </span>
          <h2 id="duplicates-heading" className="text-lg font-semibold">
            {t('HeaderPossibleDuplicates')}
          </h2>
          <span className="bg-foreground/15 rounded-full px-2 font-mono text-xs" cy-id="duplicates-count">
            {numActive}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            value={showDismissed}
            label={t('LabelShowNotDuplicates')}
            size="small"
            labelClass="text-sm"
            onChange={(value) => onShowDismissedChange(value)}
          />
          <Btn size="small" loading={checking} onClick={onCheck} className="h-8 px-3 text-xs">
            {t('ButtonCheckAgain')}
          </Btn>
        </div>
      </div>

      {!collapsed && (
        <div id="duplicates-list" className="flex max-h-[45vh] min-h-0 flex-col gap-2 overflow-y-auto">
          <p className="text-foreground-muted text-xs">
            {t('MessageDuplicatesHelp')}
            {lastCheckedAt ? ` ${t('MessageDuplicatesLastChecked', { 0: formatJsDate(new Date(lastCheckedAt), `${dateFormat} HH:mm`) })}` : ''}
          </p>

          {error && (
            <p className="text-error text-sm" cy-id="duplicates-error">
              {error}
            </p>
          )}

          {!loading && !error && groups.length === 0 && (
            <p className="text-foreground-muted py-2 text-sm" cy-id="duplicates-empty">
              {t('MessageNoDuplicates')}
            </p>
          )}

          {groups.map((group) => (
            <div
              key={group.id}
              className={mergeClasses('border-border rounded-md border px-3 py-1', group.dismissed ? 'opacity-60' : '')}
              cy-id="duplicate-group"
              data-group-id={group.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap gap-1.5" cy-id="duplicate-group-match">
                  {group.matchTypes.map((matchType) => (
                    <span key={matchType} className="bg-warning/20 rounded px-1.5 py-0.5 text-xs">
                      {t(MATCH_TYPE_LABELS[matchType] ?? 'LabelDuplicateMatchTitle')}
                    </span>
                  ))}
                  {group.dismissed && <span className="bg-foreground/15 rounded px-1.5 py-0.5 text-xs">{t('LabelNotADuplicate')}</span>}
                </div>
                <Btn
                  size="small"
                  className="h-7 px-2 text-xs"
                  loading={busyGroupIds.has(group.id)}
                  onClick={() => onSetDismissed(group.id, !group.dismissed)}
                  ariaLabel={group.dismissed ? t('ButtonRestoreDuplicateGroup') : t('ButtonNotADuplicate')}
                >
                  {group.dismissed ? t('ButtonRestoreDuplicateGroup') : t('ButtonNotADuplicate')}
                </Btn>
              </div>
              <ul className="divide-border flex flex-col divide-y">
                {group.items.map((item) => (
                  <DuplicateItemRow key={item.id} item={item} libraryId={libraryId} dateFormat={dateFormat} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
