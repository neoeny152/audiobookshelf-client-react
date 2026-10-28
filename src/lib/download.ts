import { withBasePath } from '@/lib/basePath'

interface DownloadByUrlOptions {
  filename?: string
  openInNewTab?: boolean
}

export function downloadByUrl(url: string, { filename, openInNewTab = false }: DownloadByUrlOptions = {}) {
  const link = document.createElement('a')
  link.style.display = 'none'
  link.href = withBasePath(url)

  if (filename != null) {
    link.download = filename
  }
  if (openInNewTab) {
    link.target = '_blank'
  }

  document.body.appendChild(link)
  link.click()
  setTimeout(() => {
    link.remove()
  })
}

export function downloadLibraryItem(libraryItemId: string) {
  downloadByUrl(`/internal-api/items/${libraryItemId}/download`)
}

export function downloadLibraryItemFile(libraryItemId: string, fileId: string, filename?: string) {
  downloadByUrl(`/internal-api/items/${libraryItemId}/file/${fileId}/download`, { filename })
}

export function downloadBackup(backupId: string, filename?: string) {
  downloadByUrl(`/internal-api/backups/${encodeURIComponent(backupId)}/download`, { filename })
}

export function downloadLibraryOpml(libraryId: string) {
  downloadByUrl(`/internal-api/libraries/${libraryId}/opml`, { openInNewTab: true })
}

/**
 * Most items one zip download may hold on a stock server: the ids go in the GET query string, which
 * proxies and browsers cap. Servers with the `libraryDownloadPost` feature take them in a form body.
 */
export const LIBRARY_DOWNLOAD_GET_LIMIT = 40

/** Whether a multi-item download of `count` items is offered. */
export function canDownloadLibraryItemCount(count: number, hasLibraryDownloadPost: boolean): boolean {
  return count > 0 && (hasLibraryDownloadPost || count <= LIBRARY_DOWNLOAD_GET_LIMIT)
}

/** Item ids from the `ids` field of a library download form (comma separated). */
export function parseLibraryDownloadIds(value: unknown): string[] {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * Submits a hidden same-origin form, so the browser treats the zip response as a normal download
 * (no buffering in page memory) while the ids travel in the body instead of the URL.
 */
function postDownloadForm(url: string, fields: Record<string, string>) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = withBasePath(url)
  form.style.display = 'none'
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  setTimeout(() => {
    form.remove()
  })
}

/**
 * Download several library items as one zip. `usePost` (server feature `libraryDownloadPost`) sends
 * the ids in a form body; otherwise they go in the GET query string (stock servers).
 */
export function downloadLibraryItems(libraryId: string, libraryItemIds: string[], { usePost = false }: { usePost?: boolean } = {}) {
  if (!libraryItemIds.length) return
  const url = `/internal-api/libraries/${libraryId}/download`
  if (usePost) {
    postDownloadForm(url, { ids: libraryItemIds.join(',') })
    return
  }
  downloadByUrl(`${url}?ids=${encodeURIComponent(libraryItemIds.join(','))}`)
}
