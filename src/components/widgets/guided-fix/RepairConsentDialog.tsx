'use client'

import Checkbox from '@/components/ui/Checkbox'
import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { useEffect, useState } from 'react'

interface RepairConsentDialogProps {
  isOpen: boolean
  /** MP3 files that would be rewritten */
  fileCount: number
  yesButtonText: string
  onClose: () => void
  /** `always`: the "Do this automatically from now on" box was ticked */
  onConfirm: (always: boolean) => void
}

/**
 * The OK to rewrite a book's MP3s before the pipeline goes on, with the option to stop asking (the library's Repair MP3
 * seek index automatically setting). Chapter times are always kept.
 */
export default function RepairConsentDialog({ isOpen, fileCount, yesButtonText, onClose, onConfirm }: RepairConsentDialogProps) {
  const t = useTypeSafeTranslations()
  const [always, setAlways] = useState(false)
  useEffect(() => {
    if (isOpen) setAlways(false)
  }, [isOpen])

  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={t('HeaderRepairBeforeFix')}
      message={
        <div className="flex flex-col gap-3" cy-id="repair-consent">
          <p className="font-semibold">{t('HeaderRepairBeforeFix')}</p>
          <p>{t('MessageConfirmRepairSeekIndex', { 0: fileCount })}</p>
          <div>
            <Checkbox value={always} size="small" label={t('LabelDoThisAutomatically')} onChange={setAlways} />
            <p className="text-foreground-muted mt-1 ps-7 text-xs">{t('LabelDoThisAutomaticallyHelp')}</p>
          </div>
        </div>
      }
      yesButtonText={yesButtonText}
      yesButtonClassName="bg-primary"
      onClose={onClose}
      onConfirm={() => onConfirm(always)}
    />
  )
}
