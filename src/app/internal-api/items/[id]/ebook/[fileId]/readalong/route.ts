import { getServerBaseUrl } from '@/lib/api'
import { proxyBackendBufferedResponse } from '@/lib/serverBackendProxy'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

/**
 * Proxy for the read-along data of an ebook file (fork feature `readAlong`). A 404 (no data for this EPUB) passes
 * through so the reader just hides the feature.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await params
  const cookieStore = await cookies()
  const backendUrl = `${getServerBaseUrl()}/api/items/${id}/ebook/${fileId}/readalong`

  return proxyBackendBufferedResponse(request, cookieStore, backendUrl, {
    logLabel: 'EbookReadAlongProxy',
    errorMessage: 'Failed to fetch read-along data',
    cacheControl: 'private, no-cache'
  })
}
