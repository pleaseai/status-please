/**
 * `statusbeam update` — pull new @statusbeam/* releases through the user's package
 * manager. This is the whole point of ADR-0002: upgrading is a dependency bump,
 * not an upstream fork-merge.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dim, step, success } from '../lib/log'
import { userProject } from '../lib/project'
import { run } from '../lib/run'

const PACKAGES = ['@statusbeam/cli', '@statusbeam/core', '@statusbeam/worker', '@statusbeam/web']

export interface UpdateOptions {
  cwd: string
}

/** Detect the package manager from the lockfile present in the user's project. */
function detectPackageManager(root: string): 'bun' | 'pnpm' | 'yarn' | 'npm' {
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

export async function update(opts: UpdateOptions): Promise<void> {
  const project = userProject(opts.cwd)
  const pm = detectPackageManager(project.root)

  step(`Updating @statusbeam/* via ${pm}`)
  // `update` on every PM honors the ranges in package.json and rewrites the lockfile.
  await run(pm, ['update', ...PACKAGES], { cwd: project.root })

  success('Updated. Run `statusbeam deploy` to ship the new version.')
  dim('Tip: automate this with Renovate or Dependabot on your repo.')
}
