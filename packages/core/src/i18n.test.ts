import { describe, expect, it } from 'bun:test'
import { DEFAULT_LOCALE, formatDay, getDict, isLocale, LOCALES, resolveLocale } from './i18n'

describe('resolveLocale', () => {
  it('collapses regional variants to the base language', () => {
    expect(resolveLocale('zh-CN')).toBe('zh')
    expect(resolveLocale('ja_JP')).toBe('ja')
    expect(resolveLocale('ko-KR')).toBe('ko')
    expect(resolveLocale('en-US')).toBe('en')
  })

  it('falls back to the default for unknown or empty input', () => {
    expect(resolveLocale('fr')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale('')).toBe(DEFAULT_LOCALE)
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE)
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE)
  })
})

describe('isLocale', () => {
  it('accepts supported locales and rejects everything else', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('ko')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(42)).toBe(false)
  })
})

describe('getDict', () => {
  it('provides a complete dictionary for every supported locale', () => {
    for (const locale of LOCALES) {
      const dict = getDict(locale)
      expect(dict.banner.operational.length).toBeGreaterThan(0)
      expect(dict.severity.major_outage.length).toBeGreaterThan(0)
      expect(dict.state.investigating.length).toBeGreaterThan(0)
      expect(dict.day.nodata.length).toBeGreaterThan(0)
      expect(dict.incidents.none.length).toBeGreaterThan(0)
      expect(dict.timeline.windowStart(90)).toContain('90')
      expect(dict.breakdown({ day: '100%', week: '99%', month: '98%', quarter: '97%' })).toContain('100%')
    }
  })

  it('translates the banner headline per locale', () => {
    expect(getDict('en').banner.operational).toBe('All Systems Operational')
    expect(getDict('ko').banner.operational).toBe('모든 시스템 정상')
    expect(getDict('ja').banner.operational).toBe('すべてのシステムが正常')
    expect(getDict('zh').banner.operational).toBe('所有系统正常')
  })
})

describe('formatDay', () => {
  it('formats a UTC ISO date per locale', () => {
    expect(formatDay('2026-07-05', 'en')).toBe('Jul 5, 2026')
    expect(formatDay('2026-07-05', 'ko')).toContain('2026')
    expect(formatDay('2026-07-05', 'ja')).toContain('年')
  })

  it('returns the raw input for a malformed date', () => {
    expect(formatDay('nope', 'en')).toBe('nope')
  })
})
