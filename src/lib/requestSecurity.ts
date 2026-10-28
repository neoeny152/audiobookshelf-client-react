/**
 * Request helpers for internal-api routes.
 * No Next.js imports so they can be unit tested in the browser.
 */

export type HeaderGetter = { get(name: string): string | null }

/**
 * Guard for internal-api routes that take a plain form post (the library zip download, which
 * has to be a navigation so the browser streams it to disk). Only our own pages may post: a urlencoded
 * body and, when the browser reports it, a same-origin request.
 */
export function isSameOriginFormPost(headerStore: HeaderGetter): boolean {
  const contentType = (headerStore.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/x-www-form-urlencoded') return false

  const fetchSite = headerStore.get('sec-fetch-site')?.trim().toLowerCase()
  return !fetchSite || fetchSite === 'same-origin'
}
