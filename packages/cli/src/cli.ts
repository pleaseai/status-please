/**
 * `statusbeam` — the StatusBeam CLI entrypoint. Parses argv, then dispatches to
 * setup / deploy / update. Deliberately dependency-free arg parsing: the surface
 * is tiny and a parser lib would be more weight than the whole thing.
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { deploy } from './commands/deploy'
import { setup } from './commands/setup'
import { update } from './commands/update'
import { die } from './lib/log'

const HELP = `statusbeam — deploy and manage a StatusBeam status page on Cloudflare.

Usage:
  statusbeam setup [options]     Provision D1 + KV, configure, and deploy.
  statusbeam deploy [options]    Apply schema, upload config, deploy worker + page.
  statusbeam update [options]    Pull new @statusbeam/* releases via your package manager.

Options:
  --cwd <dir>       Run against <dir> instead of the current directory.
  --yes, -y         Non-interactive; accept every default (setup).
  --skip-deploy     Provision + configure only, don't deploy (setup).
  --help, -h        Show this help.
  --version, -v     Print the CLI version.

Docs: https://github.com/pleaseai/statusbeam/blob/main/DEPLOYMENT.md`

interface Flags {
  cwd: string
  yes: boolean
  skipDeploy: boolean
  help: boolean
  version: boolean
}

function parse(argv: string[]): { command?: string, flags: Flags } {
  const flags: Flags = { cwd: process.cwd(), yes: false, skipDeploy: false, help: false, version: false }
  let command: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--cwd':
        i += 1
        flags.cwd = argv[i] ?? process.cwd()
        break
      case '--yes':
      case '-y':
        flags.yes = true
        break
      case '--skip-deploy':
        flags.skipDeploy = true
        break
      case '--help':
      case '-h':
        flags.help = true
        break
      case '--version':
      case '-v':
        flags.version = true
        break
      default:
        if (arg && !arg.startsWith('-') && !command) {
          command = arg
        }
        else if (arg?.startsWith('-')) {
          die(`unknown option: ${arg} (try --help)`)
        }
    }
  }
  return { command, flags }
}

function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    return pkg.version
  }
  catch {
    return '0.0.0'
  }
}

async function main(): Promise<void> {
  const { command, flags } = parse(process.argv.slice(2))

  if (flags.version) {
    process.stdout.write(`${version()}\n`)
    return
  }
  if (flags.help || !command) {
    process.stdout.write(`${HELP}\n`)
    return
  }

  switch (command) {
    case 'setup':
      await setup({ cwd: flags.cwd, yes: flags.yes, skipDeploy: flags.skipDeploy })
      break
    case 'deploy':
      await deploy({ cwd: flags.cwd })
      break
    case 'update':
      await update({ cwd: flags.cwd })
      break
    default:
      die(`unknown command: ${command} (try --help)`)
  }
}

main().catch((err: unknown) => {
  die(err instanceof Error ? err.message : String(err))
})
