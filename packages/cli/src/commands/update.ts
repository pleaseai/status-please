/**
 * `statusbeam update` — pull new @statusbeam/* releases through the user's package
 * manager. This is the whole point of ADR-0002: upgrading is a dependency bump,
 * not an upstream fork-merge.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { dim, step, success } from '../lib/log'
import { userProject } from '../lib/project'
import { run } from '../lib/run'

const PACKAGES = ['@statusbeam/cli', '@statusbeam/core', '@statusbeam/worker', '@statusbeam/web']

export interface UpdateOptions {
  cwd: string
}

export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm'

/** Detect the package manager from the lockfile present in the user's project. */
export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) {
    return 'bun'
  }
  if (existsSync(join(root, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }
  if (existsSync(join(root, 'yarn.lock'))) {
    return 'yarn'
  }
  return 'npm'
}

/**
 * Yarn Berry (>= 2) uses `yarn up`; Classic uses `yarn upgrade`. Berry lockfiles
 * carry a `__metadata:` block, which Classic ones don't — a reliable discriminator.
 */
export function isYarnBerry(root: string): boolean {
  if (existsSync(join(root, '.yarnrc.yml'))) {
    return true
  }
  try {
    return readFileSync(join(root, 'yarn.lock'), 'utf8').includes('__metadata:')
  }
  catch {
    return false
  }
}

/**
 * The upgrade subcommand + packages for each package manager. `yarn update`
 * doesn't exist — Classic uses `upgrade`, Berry uses `up`. bun/pnpm/npm all use
 * `update`. `yarnBerry` only matters when `pm === 'yarn'`.
 */
export function upgradeArgs(pm: PackageManager, yarnBerry = false): string[] {
  if (pm === 'yarn') {
    return [yarnBerry ? 'up' : 'upgrade', ...PACKAGES]
  }
  return ['update', ...PACKAGES]
}

export async function update(opts: UpdateOptions): Promise<void> {
  const project = userProject(opts.cwd)
  const pm = detectPackageManager(project.root)

  step(`Updating @statusbeam/* via ${pm}`)
  // Each PM's upgrade command honors the ranges in package.json and rewrites the
  // lockfile. `pm` is a bare command name → needs a shell on Windows to resolve
  // its `.cmd` shim; safe because every argument here is a compile-time constant.
  await run(pm, upgradeArgs(pm, pm === 'yarn' && isYarnBerry(project.root)), {
    cwd: project.root,
    shell: process.platform === 'win32',
  })

  success('Updated. Run `statusbeam deploy` to ship the new version.')
  dim('Tip: automate this with Renovate or Dependabot on your repo.')
}
