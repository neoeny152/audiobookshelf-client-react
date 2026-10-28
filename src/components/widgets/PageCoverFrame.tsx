import { mergeClasses } from '@/lib/merge-classes'
import type { ReactNode } from 'react'

interface PageCoverFrameProps {
  children: ReactNode
  className?: string
}

/**
 * Frames a large group cover on a detail page (collection, playlist) with the same rounded
 * corners and book shadow the shelf cards use, so it does not float flat on the page background.
 */
export default function PageCoverFrame({ children, className }: PageCoverFrameProps) {
  return (
    <div cy-id="page-cover-frame" className={mergeClasses('bg-primary box-shadow-book relative shrink-0 overflow-hidden rounded-sm', className)}>
      {children}
    </div>
  )
}
