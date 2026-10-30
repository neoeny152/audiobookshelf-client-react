'use client'

import ConfirmDialog from '@/components/widgets/ConfirmDialog'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'

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
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title={t('HeaderRepairBeforeFix')}
      message={
        <div className="flex flex-col gap-3" cy-id="repair-consent">
          <p className="font-semibold">{t('HeaderRepairBeforeFix')}</p>
          <p>{t('MessageConfirmRepairSeekIndex', { 0: fileCount })}</p>
          <p className="text-foreground-muted text-xs">{t('LabelDoThisAutomaticallyHelp')}</p>
        </div>
      }
      checkboxLabel={t('LabelDoThisAutomatically')}
      yesButtonText={yesButtonText}
      yesButtonClassName="bg-primary"
      onClose={onClose}
      onConfirm={(always) => onConfirm(!!always)}
    />
  )
}
