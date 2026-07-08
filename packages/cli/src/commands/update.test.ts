import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { detectPackageManager, isYarnBerry, upgradeArgs } from './update'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-update-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('detectPackageManager', () => {
  it('detects bun / pnpm / yarn from the lockfile', () => {
    writeFileSync(join(dir, 'bun.lock'), '')
    expect(detectPackageManager(dir)).toBe('bun')
  })
  it('detects pnpm', () => {
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    expect(detectPackageManager(dir)).toBe('pnpm')
  })
  it('detects yarn', () => {
    writeFileSync(join(dir, 'yarn.lock'), '')
    expect(detectPackageManager(dir)).toBe('yarn')
  })
  it('falls back to npm when no lockfile is present', () => {
    expect(detectPackageManager(dir)).toBe('npm')
  })
})

describe('isYarnBerry', () => {
  it('is true when a Berry lockfile carries __metadata:', () => {
    writeFileSync(join(dir, 'yarn.lock'), '__metadata:\n  version: 8\n')
    expect(isYarnBerry(dir)).toBe(true)
  })
  it('is true when .yarnrc.yml exists', () => {
    writeFileSync(join(dir, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
    expect(isYarnBerry(dir)).toBe(true)
  })
  it('is false for a Classic lockfile', () => {
    writeFileSync(join(dir, 'yarn.lock'), '# yarn lockfile v1\n')
    expect(isYarnBerry(dir)).toBe(false)
  })
})

describe('upgradeArgs', () => {
  it('uses `update` for bun/pnpm/npm', () => {
    expect(upgradeArgs('bun')[0]).toBe('update')
    expect(upgradeArgs('pnpm')[0]).toBe('update')
    expect(upgradeArgs('npm')[0]).toBe('update')
  })
  it('uses `upgrade` for Yarn Classic and `up` for Berry', () => {
    expect(upgradeArgs('yarn', false)[0]).toBe('upgrade')
    expect(upgradeArgs('yarn', true)[0]).toBe('up')
  })
  it('always targets the @statusbeam packages', () => {
    expect(upgradeArgs('yarn', true)).toContain('@statusbeam/cli')
    expect(upgradeArgs('bun')).toContain('@statusbeam/core')
  })
})
