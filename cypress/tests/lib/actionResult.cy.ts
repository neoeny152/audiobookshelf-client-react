import { callStatusAction, parseApiErrorBody, toActionResult, toStatusActionResult } from '@/lib/actionResult'
import { ApiError, NetworkError } from '@/lib/apiErrors'

describe('toActionResult', () => {
  it('wraps the resolved value', async () => {
    const result = await toActionResult(async () => ({ id: 'lib1' }))
    expect(result).to.deep.equal({ ok: true, data: { id: 'lib1' } })
  })

  it('returns the server message from an ApiError', async () => {
    const result = await toActionResult(async () => {
      throw new ApiError('Invalid request. Name must be a string', 400, 'Bad Request')
    })
    expect(result).to.deep.equal({ ok: false, error: 'Invalid request. Name must be a string' })
  })

  it('returns an empty error for a blank ApiError message or another error', async () => {
    const blank = await toActionResult(async () => {
      throw new ApiError('  ', 500, 'Internal Server Error')
    })
    expect(blank).to.deep.equal({ ok: false, error: '' })

    const network = await toActionResult(async () => {
      throw new NetworkError()
    })
    expect(network).to.deep.equal({ ok: false, error: '' })
  })

  it('re-throws Next.js redirects', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })
    let caught: unknown = null
    try {
      await toActionResult(async () => {
        throw redirect
      })
    } catch (error) {
      caught = error
    }
    expect(caught).to.equal(redirect)
  })
})

describe('toStatusActionResult', () => {
  it('keeps the HTTP status and the JSON error message', async () => {
    const busy = await toStatusActionResult(async () => {
      throw new ApiError('{"error":"Too many chapter snaps running"}', 429, 'Too Many Requests')
    })
    expect(busy).to.deep.equal({ ok: false, status: 429, error: 'Too many chapter snaps running' })
  })

  it('keeps a plain-text body and reports other errors as status 0', async () => {
    const forbidden = await toStatusActionResult(async () => {
      throw new ApiError('Forbidden', 403, 'Forbidden')
    })
    expect(forbidden).to.deep.equal({ ok: false, status: 403, error: 'Forbidden' })

    const network = await toStatusActionResult(async () => {
      throw new NetworkError()
    })
    expect(network).to.deep.equal({ ok: false, status: 0, error: '' })
  })

  it('re-throws Next.js redirects', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })
    let caught: unknown = null
    try {
      await toStatusActionResult(async () => {
        throw redirect
      })
    } catch (error) {
      caught = error
    }
    expect(caught).to.equal(redirect)
  })
})

describe('parseApiErrorBody', () => {
  it('reads { error } JSON, otherwise returns the trimmed text', () => {
    expect(parseApiErrorBody('{"error":"Invalid request body","index":2}')).to.equal('Invalid request body')
    expect(parseApiErrorBody('{"message":"x"}')).to.equal('{"message":"x"}')
    expect(parseApiErrorBody(' Not Found \n')).to.equal('Not Found')
  })
})

describe('callStatusAction', () => {
  it('passes the action result through', async () => {
    const result = await callStatusAction(async () => ({ ok: false as const, status: 409, error: 'Already running' }))
    expect(result).to.deep.equal({ ok: false, status: 409, error: 'Already running' })
  })

  it('turns a rejected action call into an unreachable-server failure', async () => {
    const result = await callStatusAction<number>(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(result).to.deep.equal({ ok: false, status: 0, error: '' })
  })
})
