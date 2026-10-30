import { getServerBaseUrl } from '@/lib/api'
import { proxyBackendBufferedResponse, proxyBackendStreamingDownload } from '@/lib/serverBackendProxy'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

const FORMATS = new Set(['json', 'vtt', 'original'])

/**
 * Proxy for one transcript (fork feature `transcripts`): `format=json` (cues, for the player), `vtt`, or `original`
 * (a download). Only `episodeId` and `format` are passed on; the response is never rendered inline.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; transcriptId: string }> }) {
  const { id, transcriptId } = await params
  const cookieStore = await cookies()
  const search = new URLSearchParams()
  const episodeId = request.nextUrl.searchParams.get('episodeId')
  const format = request.nextUrl.searchParams.get('format')
  if (episodeId) search.set('episodeId', episodeId)
  if (format && FORMATS.has(format)) search.set('format', format)
  const query = search.toString()
  const backendUrl = `${getServerBaseUrl()}/api/items/${encodeURIComponent(id)}/transcripts/${encodeURIComponent(transcriptId)}${query ? `?${query}` : ''}`

  if (format === 'original') {
    // keeps the server's file name (Content-Disposition)
    return proxyBackendStreamingDownload(request, cookieStore, backendUrl, {
      logLabel: 'TranscriptDownloadProxy',
      errorMessage: 'Failed to download the transcript'
    })
  }

  return proxyBackendBufferedResponse(request, cookieStore, backendUrl, {
    logLabel: 'TranscriptProxy',
    errorMessage: 'Failed to fetch the transcript',
    cacheControl: 'private, no-cache'
  })
}
