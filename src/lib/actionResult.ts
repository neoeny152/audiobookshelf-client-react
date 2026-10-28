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

/**
 * Like ActionResult, but a failure also carries the HTTP status so the client can explain it (e.g. 409, 429).
 * `status` is 0 when the server could not be reached or the action itself failed.
 */
export type StatusActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string }

/** The server's message from an error body: `{ "error": "..." }` JSON or plain text such as "Forbidden". */
export function parseApiErrorBody(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
      return parsed.error
    }
  } catch {
    // Plain-text body
  }
  return body.trim()
}

/** `toActionResult` that keeps the HTTP status of an ApiError. Redirects are re-thrown. */
export async function toStatusActionResult<T>(request: () => Promise<T>): Promise<StatusActionResult<T>> {
  try {
    return { ok: true, data: await request() }
  } catch (error) {
    if (isNextRedirectError(error)) {
      throw error
    }
    if (error instanceof ApiError) {
      return { ok: false, status: error.status, error: parseApiErrorBody(error.message) }
    }
    console.error('Server action failed', error)
    return { ok: false, status: 0, error: '' }
  }
}

/**
 * Call a status-returning server action from the client. The action transport itself can reject (connection to
 * the Next server lost, app redeployed so the action id is gone); report that as an unreachable server.
 */
export async function callStatusAction<T>(action: () => Promise<StatusActionResult<T>>): Promise<StatusActionResult<T>> {
  try {
    return await action()
  } catch (error) {
    console.error('Server action could not be called', error)
    return { ok: false, status: 0, error: '' }
  }
}
