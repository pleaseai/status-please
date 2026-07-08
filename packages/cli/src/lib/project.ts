import { readFileSync } from 'node:fs'
/**
 * Resolve the two sides of a StatusBeam deploy:
 *  - the *user's* project files (status.config.yml + the two wrangler configs), and
 *  - the *installed* @statusbeam/worker and @statusbeam/web packages, plus the
 *    wrangler/astro bins they carry, resolved from each package's own context so
 *    the CLI works whether deps are hoisted or nested.
 */
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface UserProject {
  root: string
  statusConfig: string
  workerWrangler: string
  webWrangler: string
}

/** The user-owned files a thin StatusBeam repo holds (scaffolded by create-statusbeam). */
export function userProject(cwd: string): UserProject {
  const root = resolve(cwd)
  return {
    root,
    statusConfig: join(root, 'status.config.yml'),
    workerWrangler: join(root, 'wrangler.worker.jsonc'),
    webWrangler: join(root, 'wrangler.web.jsonc'),
  }
}

export interface StatusbeamPackage {
  /** Absolute directory of the installed package. */
  dir: string
  /** Contents of the package's `statusbeam` metadata block. */
  meta: Record<string, string>
}

const requireHere = createRequire(import.meta.url)

/** Locate an installed @statusbeam/* package by resolving its package.json. */
export function resolvePackage(spec: string): StatusbeamPackage {
  const pkgJsonPath = requireHere.resolve(`${spec}/package.json`)
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    statusbeam?: Record<string, string>
  }
  return { dir: dirname(pkgJsonPath), meta: pkgJson.statusbeam ?? {} }
}

/** Resolve a bin (e.g. wrangler, astro) from a package's own dependency context. */
export function resolveBin(fromDir: string, pkg: string, binName: string): string {
  const req = createRequire(pathToFileURL(join(fromDir, 'package.json')))
  const pkgJsonPath = req.resolve(`${pkg}/package.json`)
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const bin = pkgJson.bin
  const rel = typeof bin === 'string' ? bin : bin?.[binName]
  if (!rel) {
    throw new Error(`could not find the "${binName}" bin in ${pkg} (resolved from ${fromDir}).`)
  }
  return resolve(dirname(pkgJsonPath), rel)
}
