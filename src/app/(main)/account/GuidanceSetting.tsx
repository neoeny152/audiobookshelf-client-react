'use client'

import { useSeekIndexEnabled } from '@/components/widgets/seek-index/SeekIndexWarning'
import { useGuidancePreference } from '@/hooks/useGuidancePreference'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { setGuidancePreference } from '@/lib/itemHealth'
import SettingsToggleSwitch from '../settings/SettingsToggleSwitch'

/** Fork only: turns the guided fix hints and cover badges back on after "No guidance, no automation" (or off). */
export default function GuidanceSetting() {
  const t = useTypeSafeTranslations()
  const enabled = useSeekIndexEnabled()
  const preference = useGuidancePreference()
  if (!enabled) return null
  return (
    <SettingsToggleSwitch
      label={t('LabelGuidedFixGuidance')}
      tooltip={t('LabelGuidedFixGuidanceHelp')}
      value={preference !== 'off'}
      onChange={(on) => setGuidancePreference(on ? 'guide' : 'off')}
    />
  )
}
