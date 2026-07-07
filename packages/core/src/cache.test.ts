import { describe, expect, it } from 'bun:test'
import { cacheTagHeader, cacheTags, siteTag, STATUS_PAGE_TAG } from './cache'

describe('siteTag', () => {
  it('namespaces a slug', () => {
    expect(siteTag('api')).toBe('status-site-api')
  })
})

describe('cacheTags', () => {
  it('is the page tag plus one tag per site', () => {
    expect(cacheTags(['website', 'api'])).toEqual([
      STATUS_PAGE_TAG,
      'status-site-website',
      'status-site-api',
    ])
  })

  it('is just the page tag when there are no sites', () => {
    expect(cacheTags([])).toEqual([STATUS_PAGE_TAG])
  })
})

describe('cacheTagHeader', () => {
  it('comma-joins the tags for the Cache-Tag header', () => {
    expect(cacheTagHeader(['api'])).toBe('status-page,status-site-api')
  })
})
