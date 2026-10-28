import { canDownloadLibraryItemCount, downloadLibraryItems, LIBRARY_DOWNLOAD_GET_LIMIT, parseLibraryDownloadIds } from '@/lib/download'
import { isSameOriginFormPost } from '@/lib/requestSecurity'

describe('canDownloadLibraryItemCount (libraryDownloadPost server feature)', () => {
  it('keeps the 40 item limit on a stock server', () => {
    expect(LIBRARY_DOWNLOAD_GET_LIMIT).to.equal(40)
    expect(canDownloadLibraryItemCount(1, false)).to.equal(true)
    expect(canDownloadLibraryItemCount(40, false)).to.equal(true)
    expect(canDownloadLibraryItemCount(41, false)).to.equal(false)
  })

  it('lifts the limit when the server takes the ids in a POST body', () => {
    expect(canDownloadLibraryItemCount(41, true)).to.equal(true)
    expect(canDownloadLibraryItemCount(5000, true)).to.equal(true)
  })

  it('never offers an empty download', () => {
    expect(canDownloadLibraryItemCount(0, true)).to.equal(false)
    expect(canDownloadLibraryItemCount(0, false)).to.equal(false)
  })
})

describe('parseLibraryDownloadIds', () => {
  it('reads the comma separated form field', () => {
    expect(parseLibraryDownloadIds('li_1,li_2, li_3,')).to.deep.equal(['li_1', 'li_2', 'li_3'])
  })

  it('treats a missing or non-string field as no ids', () => {
    expect(parseLibraryDownloadIds(null)).to.deep.equal([])
    expect(parseLibraryDownloadIds('')).to.deep.equal([])
    expect(parseLibraryDownloadIds(new Blob(['li_1']))).to.deep.equal([])
  })
})

describe('downloadLibraryItems', () => {
  it('posts a hidden form with the ids when usePost is set', () => {
    const ids = Array.from({ length: 300 }, (_, index) => `li_${index}`)
    const submitted: { method: string; action: string; ids: string | null }[] = []
    cy.stub(HTMLFormElement.prototype, 'submit').callsFake(function (this: HTMLFormElement) {
      submitted.push({ method: this.method, action: this.action, ids: new FormData(this).get('ids') as string | null })
    })
    const click = cy.stub(HTMLAnchorElement.prototype, 'click')

    cy.then(() => {
      downloadLibraryItems('lib_1', ids, { usePost: true })
      expect(click.callCount).to.equal(0)
      expect(submitted).to.have.length(1)
      expect(submitted[0].method).to.equal('post')
      expect(new URL(submitted[0].action).pathname).to.match(/\/internal-api\/libraries\/lib_1\/download$/)
      expect(submitted[0].ids).to.equal(ids.join(','))
    })
  })

  it('uses the GET link on a stock server', () => {
    const submit = cy.stub(HTMLFormElement.prototype, 'submit')
    const hrefs: string[] = []
    cy.stub(HTMLAnchorElement.prototype, 'click').callsFake(function (this: HTMLAnchorElement) {
      hrefs.push(this.href)
    })

    cy.then(() => {
      downloadLibraryItems('lib_1', ['li_1', 'li_2'])
      expect(submit.callCount).to.equal(0)
      expect(hrefs).to.have.length(1)
      const url = new URL(hrefs[0])
      expect(url.pathname).to.match(/\/internal-api\/libraries\/lib_1\/download$/)
      expect(url.searchParams.get('ids')).to.equal('li_1,li_2')
    })
  })
})

describe('isSameOriginFormPost', () => {
  const headersOf = (values: Record<string, string>) => new Headers(values)

  it('accepts our own form post', () => {
    expect(isSameOriginFormPost(headersOf({ 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' }))).to.equal(true)
    expect(isSameOriginFormPost(headersOf({ 'content-type': 'application/x-www-form-urlencoded' }))).to.equal(true)
  })

  it('rejects cross-site, same-site and other body types', () => {
    expect(isSameOriginFormPost(headersOf({ 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' }))).to.equal(false)
    expect(isSameOriginFormPost(headersOf({ 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-site' }))).to.equal(false)
    expect(isSameOriginFormPost(headersOf({ 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' }))).to.equal(false)
    expect(isSameOriginFormPost(headersOf({}))).to.equal(false)
  })
})
