'use client'

import { useLibraries } from '@/contexts/LibrariesContext'
import { useGlobalToast } from '@/contexts/ToastContext'
import { useTypeSafeTranslations } from '@/hooks/useTypeSafeTranslations'
import { Library } from '@/types/api'
import { useCallback, useEffect, useState } from 'react'
import SettingsContent from '../SettingsContent'
import { SETTINGS_MORE_INFO_URLS } from '../settingsNavItems'
import { createLibrary, editLibrary, saveLibraryOrder } from './actions'
import LibrariesList from './LibrariesList'
import LibraryEditModal, { LibraryFormData } from './LibraryEditModal'

interface LibraryClientProps {
  libraries: Library[]
}

export default function LibrariesClient({ libraries }: LibraryClientProps) {
  const t = useTypeSafeTranslations()
  const { setLibraries } = useLibraries()
  const { showToast } = useGlobalToast()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingLibrary, setEditingLibrary] = useState<Library | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    setLibraries(libraries)
  }, [libraries, setLibraries])

  const handleAddLibrary = useCallback(() => {
    setEditingLibrary(null)
    setIsModalOpen(true)
  }, [])

  const handleEditLibrary = useCallback((library: Library) => {
    setEditingLibrary(library)
    setIsModalOpen(true)
  }, [])

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
    setEditingLibrary(null)
  }, [])

  const handleSubmit = useCallback(
    async (formData: LibraryFormData) => {
      setIsProcessing(true)
      try {
        const validFolders = formData.folders.filter((f) => f.fullPath.trim() !== '')

        const payload = {
          name: formData.name,
          mediaType: formData.mediaType,
          icon: formData.icon,
          provider: formData.provider,
          folders: validFolders,
          settings: formData.settings
        } as Library

        const result = editingLibrary ? await editLibrary(editingLibrary.id, payload) : await createLibrary(payload)
        if (!result.ok) {
          showToast(result.error || (editingLibrary ? t('ToastFailedToUpdate') : t('ToastLibraryCreateFailed')), { type: 'error' })
          return
        }

        handleCloseModal()
      } catch (error) {
        console.error('Failed to save library:', error)
        showToast(editingLibrary ? t('ToastFailedToUpdate') : t('ToastLibraryCreateFailed'), { type: 'error' })
      } finally {
        setIsProcessing(false)
      }
    },
    [editingLibrary, handleCloseModal, showToast, t]
  )

  return (
    <>
      <SettingsContent
        title={t('HeaderLibraries')}
        addButton={{
          label: t('ButtonAddLibrary'),
          onClick: handleAddLibrary
        }}
        moreInfoUrl={SETTINGS_MORE_INFO_URLS.libraries}
      >
        <LibrariesList libraries={libraries} saveLibraryOrderAction={saveLibraryOrder} onEditLibrary={handleEditLibrary} onAddLibrary={handleAddLibrary} />
      </SettingsContent>

      <LibraryEditModal isOpen={isModalOpen} library={editingLibrary} processing={isProcessing} onClose={handleCloseModal} onSubmit={handleSubmit} />
    </>
  )
}
