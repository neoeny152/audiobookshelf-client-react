import { getServerBaseUrl } from '@/lib/api'
import { proxyBackendBufferedResponse } from '@/lib/serverBackendProxy'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

/**
 * Proxy for an item's (or one podcast episode's) transcript list (fork feature `transcripts`). Only `episodeId` is
 * passed on.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cookieStore = await cookies()
  const episodeId = request.nextUrl.searchParams.get('episodeId')
  const search = episodeId ? `?episodeId=${encodeURIComponent(episodeId)}` : ''
  const backendUrl = `${getServerBaseUrl()}/api/items/${encodeURIComponent(id)}/transcripts${search}`

  return proxyBackendBufferedResponse(request, cookieStore, backendUrl, {
    logLabel: 'TranscriptListProxy',
    errorMessage: 'Failed to fetch transcripts',
    defaultContentType: 'application/json',
    cacheControl: 'private, no-cache'
  })
}
