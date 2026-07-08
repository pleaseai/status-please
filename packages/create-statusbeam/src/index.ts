/**
 * `create-statusbeam` — scaffold a thin StatusBeam project: the user-owned config
 * (status.config.yml + the two wrangler configs + CI) that deploys the published
 * @statusbeam packages via the statusbeam CLI. `bunx create-statusbeam [dir]`.
 *
 * The same template tree also seeds the pleaseai/statusbeam-template GitHub repo
 * (see templates/README in the monorepo docs), so the "Use this template" button
 * and this scaffolder emit an identical project.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { cp, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import * as readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const templatesDir = fileURLToPath(new URL('../templates', import.meta.url))

/** The scaffolder's own version, used to pin the generated @statusbeam/cli range. */
function ownVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    return pkg.version
  }
  catch {
    return '0.0.0'
  }
}

interface Args {
  dir: string
  yes: boolean
  name?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: '.', yes: false }
  let sawDir = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--yes' || a === '-y') {
      args.yes = true
    }
    else if (a === '--name') {
      i += 1
      args.name = argv[i]
    }
    else if (a?.startsWith('--name=')) {
      // Accept the `--name=value` form too, the standard CLI convention.
      args.name = a.slice('--name='.length)
    }
    else if (a && !a.startsWith('-') && !sawDir) {
      args.dir = a
      sawDir = true
    }
  }
  return args
}

/** Turn a directory name into a valid npm package name. */
function toPackageName(dir: string): string {
  const base = basename(resolve(dir)) || 'statusbeam-status'
  // npm names may not start with `.` or `_`, so strip those (and `-`) from the
  // front as well as trailing `-`/`.`.
  const slug = base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-.]+$/g, '')
  return slug || 'statusbeam-status'
}

async function ask(prompt: string, def: string, interactive: boolean): Promise<string> {
  if (!interactive) {
    return def
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const reply = (await rl.question(`${prompt} [${def}]: `)).trim()
    return reply || def
  }
  finally {
    rl.close()
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const target = resolve(args.dir)
  const interactive = !args.yes && process.stdin.isTTY === true

  // Refuse to clobber a non-empty directory unless the user opted in with --yes.
  if (existsSync(target)) {
    const entries = (await readdir(target)).filter(e => e !== '.git')
    if (entries.length > 0 && !args.yes) {
      process.stderr.write(`\n✗ ${target} is not empty. Pass a new directory, or --yes to scaffold into it.\n`)
      process.exit(1)
    }
  }

  const pageName = args.name ?? (await ask('Status page name', 'Acme Status', interactive))

  // 1. Copy the template tree.
  await cp(templatesDir, target, { recursive: true })

  // 2. npm strips a literal `.gitignore` from the tarball, so it ships as
  //    `gitignore` — restore the dot in the scaffolded project.
  const gitignoreSrc = join(target, 'gitignore')
  if (existsSync(gitignoreSrc)) {
    await rename(gitignoreSrc, join(target, '.gitignore'))
  }

  // 3. Inject the page name into status.config.yml (JSON.stringify → a quoted YAML
  //    scalar, so a name with ":", "#", a leading "@", or quotes stays valid).
  const configPath = join(target, 'status.config.yml')
  const config = await readFile(configPath, 'utf8')
  await writeFile(configPath, config.replace(/^name:.*$/m, () => `name: ${JSON.stringify(pageName)}`))

  // 4. Generate package.json pinned to a compatible CLI release.
  const version = ownVersion()
  const cliRange = version === '0.0.0' ? 'latest' : `^${version}`
  const pkg = {
    name: toPackageName(target),
    type: 'module',
    private: true,
    scripts: {
      setup: 'statusbeam setup',
      deploy: 'statusbeam deploy',
      update: 'statusbeam update',
    },
    devDependencies: {
      '@statusbeam/cli': cliRange,
    },
  }
  await writeFile(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

  // 5. git init (best-effort — a scaffold without git is still usable).
  spawnSync('git', ['init', '--quiet'], { cwd: target, stdio: 'ignore' })

  const rel = args.dir === '.' ? '.' : args.dir
  process.stdout.write(`\n✓ Scaffolded a StatusBeam project in ${target}\n\nNext:\n`)
  if (rel !== '.') {
    process.stdout.write(`  cd ${rel}\n`)
  }
  process.stdout.write('  mise trust && mise install && bun install\n')
  process.stdout.write('  bunx wrangler login\n')
  process.stdout.write('  bunx statusbeam setup\n\nThen edit status.config.yml to list your services.\n')
}

main().catch((err: unknown) => {
  process.stderr.write(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
