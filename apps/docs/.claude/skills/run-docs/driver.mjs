#!/usr/bin/env node
// Smoke driver for the StatusBeam docs site (apps/docs).
//
// It serves the already-built ./dist with `astro preview`, then checks the real
// Nimbus surface: rendered HTML, site and section llms.txt indexes, per-page
// Markdown/MDX twins, rendered MDX components, and Nimbus page actions. Exits 0
// only when every check passes, so it is CI-usable.
//
// Prereq: `bunx astro build` has been run (./dist exists). See SKILL.md.
// Usage:  node .claude/skills/run-docs/driver.mjs [--port 4321]
//         run from the apps/docs directory.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'

const portArg = process.argv.indexOf('--port')
const PORT = portArg !== -1 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT) || 4321
const BASE = `http://localhost:${PORT}`

if (!existsSync('dist')) {
  console.error('✗ ./dist not found — run `bunx astro build` first (from apps/docs).')
  process.exit(2)
}

/** Each check: [label, path, assert(status, body) => true | string(error)] */
const checks = [
  ['home renders', '/', (s, b) => (s === 200 && b.includes('StatusBeam') && b.includes('Why StatusBeam')) || `status=${s} hasTitle=${b.includes('StatusBeam')} hasCards=${b.includes('Why StatusBeam')}`],
  ['llms.txt', '/llms.txt', (s, b) => (s === 200 && b.startsWith('# StatusBeam')) || `status=${s} head=${JSON.stringify(b.slice(0, 20))}`],
  ['llms-full.txt', '/llms-full.txt', (s, b) => (s === 200 && b.length > 1000) || `status=${s} len=${b.length}`],
  ['section llms.txt', '/guides/llms.txt', (s, b) => (s === 200 && b.includes('## Pages') && b.includes('Configuration')) || `status=${s} hasPages=${b.includes('## Pages')} hasPage=${b.includes('Configuration')}`],
  ['markdown twin', '/guides/configuration/index.md', (s, b) => (s === 200 && b.includes('# Configuration') && b.includes('Start from')) || `status=${s} hasTitle=${b.includes('# Configuration')} hasContent=${b.includes('Start from')}`],
  ['mdx twin', '/guides/configuration/index.mdx', (s, b) => (s === 200 && b.includes('<Aside type="tip">')) || `status=${s} hasAsideSource=${b.includes('<Aside type="tip">')}`],
  ['mdx components render', '/guides/configuration/', (s, b) => (s === 200 && !b.includes('<Aside type=') && b.includes('aside-card')) || `status=${s} leakedComponent=${b.includes('<Aside type=')} hasAside=${b.includes('aside-card')}`],
  ['page actions render', '/guides/configuration/', (s, b) => (s === 200 && b.includes('data-nb-page-actions') && b.includes('data-nb-page-actions-copy')) || `status=${s} hasActions=${b.includes('data-nb-page-actions')} hasCopy=${b.includes('data-nb-page-actions-copy')}`],
  ['markdown action link', '/guides/configuration/', (s, b) => (s === 200 && b.includes('View as Markdown') && b.includes('/guides/configuration/index.md')) || `status=${s} hasLabel=${b.includes('View as Markdown')} hasTarget=${b.includes('/guides/configuration/index.md')}`],
]

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE + '/', { redirect: 'manual' })
      if (response.status > 0) return true
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

const server = spawn('bunx', ['astro', 'preview', '--port', String(PORT)], {
  stdio: ['ignore', 'ignore', 'inherit'],
})

let failed = false
try {
  if (!(await waitForServer())) {
    console.error(`✗ preview server never came up on ${BASE}`)
    failed = true
  } else {
    for (const [label, path, assert] of checks) {
      const response = await fetch(BASE + path, { redirect: 'follow' })
      const body = await response.text()
      const verdict = assert(response.status, body)
      if (verdict === true) {
        console.log(`✓ ${label}  (${path})`)
      } else {
        console.error(`✗ ${label}  (${path}) — ${verdict}`)
        failed = true
      }
    }
  }
} finally {
  server.kill('SIGTERM')
}

console.log(failed ? '\nFAIL' : '\nPASS — docs site serves and all Nimbus endpoints are live.')
process.exit(failed ? 1 : 0)
