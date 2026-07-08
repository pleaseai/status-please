import type { Wrangler } from '../lib/wrangler'
/**
 * `statusbeam setup` — one-shot provision + configure (+ deploy) for a thin
 * StatusBeam repo. The TS port of scripts/setup.sh, but it writes into the user's
 * own wrangler configs instead of the monorepo's. Idempotent: safe to re-run to
 * change the domain/cron or redeploy.
 */
import { existsSync } from 'node:fs'
import process from 'node:process'
import { edit, injectIds, readJsoncString, setCron, setNetworking } from '../lib/apply-config'
import { die, info, ok, step, success } from '../lib/log'
import { resolveBin, resolvePackage, userProject } from '../lib/project'
import { ask, pause } from '../lib/prompt'
import { createD1, createKv, isAuthenticated, lookupD1, lookupKv } from '../lib/wrangler'
import { deploy } from './deploy'

export interface SetupOptions {
  cwd: string
  yes: boolean
  skipDeploy: boolean
}

export async function setup(opts: SetupOptions): Promise<void> {
  const nonInteractive = opts.yes || !process.stdin.isTTY
  const project = userProject(opts.cwd)
  const web = resolvePackage('@statusbeam/web')
  const wranglerBin = resolveBin(web.dir, 'wrangler', 'wrangler')
  const w: Wrangler = { runtime: process.execPath, bin: wranglerBin }

  step('Checking prerequisites')
  for (const f of [project.workerWrangler, project.webWrangler]) {
    if (!existsSync(f)) {
      die(`missing ${f}. Scaffold a project first with \`bunx create-statusbeam\`.`)
    }
  }
  if (!existsSync(project.statusConfig)) {
    die(`missing ${project.statusConfig}. Scaffold a project first with \`bunx create-statusbeam\`.`)
  }
  if (!(await isAuthenticated(w))) {
    die('not authenticated with Cloudflare. Run `wrangler login` (or set CLOUDFLARE_API_TOKEN) and re-run.')
  }
  ok('Cloudflare auth ready')

  step('Provisioning D1 + KV')
  const dbName = (await readJsoncString(project.workerWrangler, 'database_name')) ?? 'statusbeam'
  let d1 = await lookupD1(w, dbName)
  if (!d1) {
    info(`Creating D1 database '${dbName}'…`)
    await createD1(w, dbName)
    d1 = await lookupD1(w, dbName)
  }
  else {
    info(`D1 '${dbName}' already exists — reusing.`)
  }
  if (!d1) {
    die('could not determine the D1 database id after create.')
  }
  ok(`D1 database_id: ${d1}`)

  let kv = await lookupKv(w)
  if (!kv) {
    info('Creating KV namespace \'STATUS_KV\'…')
    await createKv(w, project.workerWrangler)
    kv = await lookupKv(w)
  }
  else {
    info('KV namespace \'STATUS_KV\' already exists — reusing.')
  }
  if (!kv) {
    die('could not determine the KV namespace id after create.')
  }
  ok(`KV namespace id: ${kv}`)

  step('Wrangler settings')
  const domain = await ask('Custom domain for the status page (blank = use *.workers.dev)', '', { nonInteractive })
  const cron = await ask('Cron schedule for checks', '*/5 * * * *', { nonInteractive })
  info(domain ? `Domain: ${domain}` : 'No custom domain — the page will use its *.workers.dev URL.')
  info(`Cron:   ${cron}`)

  step('Writing settings into your wrangler configs')
  await edit(project.workerWrangler, s => setCron(injectIds(s, d1, kv), cron))
  await edit(project.webWrangler, s => setNetworking(injectIds(s, d1, kv), domain))
  ok('wrangler.worker.jsonc + wrangler.web.jsonc configured')

  if (opts.skipDeploy) {
    success('Provisioned + configured. Run `statusbeam deploy` when you\'re ready to ship.')
    return
  }

  step('Your service list (status.config.yml)')
  info('Edit status.config.yml now to list the services you want to monitor.')
  await pause('Press Enter when it\'s ready to deploy (Ctrl-C to abort)… ', { nonInteractive })

  await deploy({ cwd: opts.cwd })
  success('StatusBeam is live. The page shows sample data until the first cron writes a real snapshot.')
}
