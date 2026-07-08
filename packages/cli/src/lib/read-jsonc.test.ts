import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readJsoncString } from './apply-config'

let dir: string
function file(contents: string): string {
  const p = join(dir, 'wrangler.jsonc')
  writeFileSync(p, contents)
  return p
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-jsonc-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readJsoncString', () => {
  it('reads an active string value by key', async () => {
    const p = file('{\n  "database_name": "statusbeam"\n}')
    expect(await readJsoncString(p, 'database_name')).toBe('statusbeam')
  })

  it('skips a commented-out line and returns the active value', async () => {
    const p = file('{\n  // "database_name": "old-commented"\n  "database_name": "real"\n}')
    expect(await readJsoncString(p, 'database_name')).toBe('real')
  })

  it('returns undefined when the key only appears in a comment', async () => {
    const p = file('{\n  // "database_name": "only-commented"\n}')
    expect(await readJsoncString(p, 'database_name')).toBeUndefined()
  })

  it('returns undefined for an absent key', async () => {
    const p = file('{\n  "name": "x"\n}')
    expect(await readJsoncString(p, 'database_name')).toBeUndefined()
  })
})
