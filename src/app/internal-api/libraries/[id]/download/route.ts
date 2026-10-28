import { getServerBaseUrl } from '@/lib/api'
import { parseLibraryDownloadIds } from '@/lib/download'
import { isSameOriginFormPost } from '@/lib/requestSecurity'
import { proxyBackendStreamingDownload } from '@/lib/serverBackendProxy'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Proxy endpoint for multi-item library downloads (zip).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ids = request.nextUrl.searchParams.get('ids')

  if (!ids) {
    return NextResponse.json({ error: 'Missing ids query parameter' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const backendUrl = `${getServerBaseUrl()}/api/libraries/${id}/download?ids=${encodeURIComponent(ids)}`

  return proxyBackendStreamingDownload(request, cookieStore, backendUrl, {
    logLabel: 'LibraryItemsDownload',
    errorMessage: 'Failed to fetch library items download'
  })
}

/**
 * Form-post version for large selections (server feature `libraryDownloadPost`): the ids come in a
 * urlencoded `ids` field (comma separated) and are forwarded as JSON to POST /api/libraries/:id/download.
 * Only call this when the server advertises the feature; a stock server has no POST route.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginFormPost(request.headers)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  let ids: string[]
  try {
    ids = parseLibraryDownloadIds((await request.formData()).get('ids'))
  } catch {
    ids = []
  }
  if (!ids.length) {
    return NextResponse.json({ error: 'Missing ids' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const backendUrl = `${getServerBaseUrl()}/api/libraries/${encodeURIComponent(id)}/download`

  return proxyBackendStreamingDownload(request, cookieStore, backendUrl, {
    logLabel: 'LibraryItemsDownload',
    errorMessage: 'Failed to fetch library items download',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    }
  })
}
