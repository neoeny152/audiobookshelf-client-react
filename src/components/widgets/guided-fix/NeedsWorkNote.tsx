'use client'

import { TooltipCore } from '@/components/ui/Tooltip'
import { usePrimaryInputCanHover } from '@/hooks/useMediaQuery'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { getIssueReason } from '@/lib/itemHealth'
import type { NeedsWorkItem } from '@/types/api'

/**
 * "Needs processing" under a book card's title (fork only), with what is wrong in a tooltip that opens on hover, focus
 * or (without hover) a tap, like HelpTooltipIcon. A tap on it does not open the book.
 */
export default function NeedsWorkNote({ item }: { item: NeedsWorkItem }) {
  const t = useTypeSafeTranslations()
  const openOnClick = !usePrimaryInputCanHover()
  return (
    // Without hover a tap opens the tooltip; it stops here so the card does not open the book too
    <span
      onClick={(event) => {
        if (!openOnClick) return
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <TooltipCore
        inline
        lazy
        activateOnFocus
        openOnClick={openOnClick}
        position="bottom"
        maxWidth={280}
        tooltipClassName="text-start"
        text={
          <ul>
            {item.issues.map((issue) => (
              <li key={issue}>{getIssueReason(issue, item, t)}</li>
            ))}
          </ul>
        }
      >
        <button type="button" className="text-warning/80 max-w-full cursor-default truncate">
          {t('LabelNeedsProcessing')}
        </button>
      </TooltipCore>
    </span>
  )
}
