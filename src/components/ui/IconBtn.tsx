'use client'

import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { mergeClasses } from '@/lib/merge-classes'
import React, { memo } from 'react'
import ButtonBase from './ButtonBase'

export type IconBtnVariant = 'default' | 'muted' | 'danger' | 'success'

/**
 * Icon color per variant. `default` keeps the ButtonBase colors; the others start muted and
 * light up on hover / keyboard focus. Classes passed through `className` still win.
 */
const VARIANT_CLASSES: Record<IconBtnVariant, string> = {
  default: '',
  muted: 'text-foreground-muted hover:not-disabled:text-foreground focus-visible:text-foreground',
  danger: 'text-foreground-muted hover:not-disabled:text-error focus-visible:text-error',
  success: 'text-foreground-muted hover:not-disabled:text-success focus-visible:text-success'
}

interface IconBtnProps {
  children: React.ReactNode
  disabled?: boolean
  outlined?: boolean
  borderless?: boolean
  loading?: boolean
  size?: 'small' | 'medium' | 'large' | 'auto' | 'custom'
  variant?: IconBtnVariant
  iconClass?: string
  ariaLabel?: string
  to?: string
  onClick?: (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void
  onMouseDown?: (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement | HTMLAnchorElement>) => void
  'aria-pressed'?: boolean
  className?: string
  ref?: React.Ref<HTMLButtonElement>
  tabIndex?: number
  [key: string]: unknown
}

// Memoized LoadingSpinner component to prevent unnecessary re-renders
const LoadingSpinner = memo(() => (
  <div
    cy-id="icon-btn-loading-spinner"
    className="text-foreground/100 absolute inset-s-0 top-0 flex h-full w-full items-center justify-center"
    aria-hidden="true"
  >
    <svg className="animate-spin" style={{ width: '24px', height: '24px' }} viewBox="0 0 24 24">
      <path fill="currentColor" d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z" />
    </svg>
  </div>
))

LoadingSpinner.displayName = 'LoadingSpinner'

export default function IconBtn({
  children,
  disabled = false,
  outlined = true,
  borderless = false,
  loading = false,
  size = 'medium',
  variant = 'default',
  iconClass,
  ariaLabel,
  to,
  onClick,
  onMouseDown,
  onKeyDown,
  'aria-pressed': ariaPressed,
  className = '',
  ref,
  tabIndex,
  ...props
}: IconBtnProps) {
  const t = useTypeSafeTranslations()
  const isDisabled = disabled || loading

  // Icon button specific styling based on size
  const sizeClass = size === 'small' ? 'w-9 text-lg' : size === 'large' ? 'w-11 text-2xl' : size === 'medium' ? 'w-10 text-xl' : size === 'auto' ? 'w-auto' : ''
  const classList = mergeClasses(sizeClass, VARIANT_CLASSES[variant], className)

  const handleClick = (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    if (isDisabled) {
      e.preventDefault()
      return
    }
    onClick?.(e)
  }

  return (
    <ButtonBase
      ref={ref}
      size={size}
      disabled={isDisabled}
      borderless={borderless}
      to={to}
      onClick={handleClick}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      className={classList}
      ariaLabel={ariaLabel}
      aria-pressed={ariaPressed}
      tabIndex={tabIndex}
      {...props}
    >
      {loading && <LoadingSpinner />}
      {loading && (
        <span cy-id="icon-btn-loading" className="sr-only">
          {t('LabelLoadingIndicator')}
        </span>
      )}
      {!loading && (
        <span cy-id="icon-btn-icon" className={mergeClasses(outlined ? 'material-symbols' : 'material-symbols fill', iconClass)} aria-hidden="true">
          {children}
        </span>
      )}
    </ButtonBase>
  )
}
