import { toActionResult } from '@/lib/actionResult'
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
