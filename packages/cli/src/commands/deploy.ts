import type { Wrangler } from '../lib/wrangler'
/**
 * `statusbeam deploy` — apply the D1 schema, upload the config to KV, deploy the
 * check Worker, then build + deploy the status page. The TS equivalent of the
 * root `deploy` script + the CI deploy.yml, but driven against the *user's* config
 * files and the *installed* @statusbeam packages instead of the monorepo.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { readJsoncString } from '../lib/apply-config'
import { die, ok, step } from '../lib/log'
import { resolveBin, resolvePackage, userProject } from '../lib/project'
import { run } from '../lib/run'
import { applySchema, deploy as deployWorker, isAuthenticated, uploadConfig } from '../lib/wrangler'

export interface DeployOptions {
  cwd: string
}

export async function deploy(opts: DeployOptions): Promise<void> {
  const project = userProject(opts.cwd)
  const worker = resolvePackage('@statusbeam/worker')
  const web = resolvePackage('@statusbeam/web')

  // wrangler + astro ship with @statusbeam/web; resolve them from its context so
  // the CLI doesn't depend on a global install or hoisting.
  const wranglerBin = resolveBin(web.dir, 'wrangler', 'wrangler')
  const astroBin = resolveBin(web.dir, 'astro', 'astro')
  const w: Wrangler = { runtime: process.execPath, bin: wranglerBin }

  for (const f of [project.statusConfig, project.workerWrangler, project.webWrangler]) {
    if (!existsSync(f)) {
      die(`missing ${f} — run \`statusbeam setup\` first, or scaffold a project with \`bunx create-statusbeam\`.`)
    }
  }
  if (!(await isAuthenticated(w))) {
    die('not authenticated with Cloudflare. Run `wrangler login` (or set CLOUDFLARE_API_TOKEN) and re-run.')
  }

  const dbName = (await readJsoncString(project.workerWrangler, 'database_name')) ?? 'statusbeam'
  const schemaPath = join(worker.dir, worker.meta.schema ?? './schema.sql')

  step('Applying the D1 schema')
  await applySchema(w, dbName, schemaPath, project.workerWrangler)
  ok('Schema applied')

  step('Uploading status.config.yml to KV')
  await uploadConfig(w, project.statusConfig, project.workerWrangler)
  ok('Config uploaded')

  step('Deploying the check Worker')
  await deployWorker(w, project.workerWrangler, project.root)
  ok('Check Worker deployed')

  step('Building + deploying the status page')
  // The @astrojs/cloudflare adapter reads STATUSBEAM_WRANGLER_CONFIG at build time
  // (apps/web/astro.config.ts) so the user's real ids/domain — not the package's
  // demo placeholders — are fused into the deploy artifact.
  const buildEnv: NodeJS.ProcessEnv = { ...process.env, STATUSBEAM_WRANGLER_CONFIG: project.webWrangler }
  await run(w.runtime, [astroBin, 'build'], { cwd: web.dir, env: buildEnv })
  await run(w.runtime, [wranglerBin, 'deploy'], { cwd: web.dir })
  ok('Status page deployed')
}
