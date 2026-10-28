import { ApiError } from '@/lib/apiErrors'
import { isNextRedirectError } from '@/lib/nextErrors'

/**
 * Result of a server action that reports failure instead of throwing.
 * Next.js replaces the message of errors thrown from server actions in production builds,
 * so actions return the server's error text here for the client to show in a toast.
 * `error` is empty when there is no server message; callers fall back to a translated string.
 */
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Run a server-side request and convert a thrown error into `{ ok: false, error }`.
 * Redirects (e.g. to login after a failed token refresh) are re-thrown.
 */
export async function toActionResult<T>(request: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await request() }
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error
    }
    if (error instanceof ApiError && error.message.trim()) {
      return { ok: false, error: error.message }
    }
    console.error('Server action failed', error)
    return { ok: false, error: '' }
  }
}
