import { getCurrentUser, getData } from '@/lib/api'
import { staticPageMetadata } from '@/lib/pageMetadata'
import { isUserAdminOrUp, userCanUpdate } from '@/lib/userPermissions'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import ProcessingClient from './ProcessingClient'

export async function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata('TitleAudiobookshelfProcessing')
}

/** Auto pipeline (fork only): the library's queue and the books waiting for review. */
export default async function ProcessingPage({ params }: { params: Promise<{ library: string }> }) {
  const { library: libraryId } = await params
  const [currentUser] = await getData(getCurrentUser())
  const user = currentUser?.user

  if (!user || !(isUserAdminOrUp(user.type) || userCanUpdate(user))) {
    redirect(`/library/${libraryId}`)
  }

  return (
    <div className="w-full p-4 sm:p-8">
      <ProcessingClient libraryId={libraryId} canRunLibrary={isUserAdminOrUp(user.type)} />
    </div>
  )
}
