#!/usr/bin/env node
// Smoke driver for the StatusBeam docs site (apps/docs).
//
// It serves the already-built ./dist with `astro preview`, then hits the real
// HTTP surface a future agent (or PR) actually changes: the rendered HTML, the
// llms.txt family, a `.md.txt` raw-markdown endpoint, the `.md` copy source, and
// the per-page AI action buttons in the HTML. Exits 0 if every check passes,
// non-zero on the first failure (with the reason), so it is CI-usable.
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
  ['home renders', '/', (s, b) => (s === 200 && b.includes('StatusBeam')) || `status=${s} hasTitle=${b.includes('StatusBeam')}`],
  ['llms.txt', '/llms.txt', (s, b) => (s === 200 && b.startsWith('# StatusBeam')) || `status=${s} head=${JSON.stringify(b.slice(0, 20))}`],
  ['llms-full.txt', '/llms-full.txt', (s, b) => (s === 200 && b.length > 1000) || `status=${s} len=${b.length}`],
  ['md.txt endpoint', '/guides/configuration.md.txt', (s, b) => (s === 200 && b.includes('title:')) || `status=${s} hasFrontmatter=${b.includes('title:')}`],
  ['md copy source', '/guides/configuration.md', (s) => s === 200 || `status=${s}`],
  ['copy-markdown button', '/guides/configuration/', (s, b) => (s === 200 && b.includes('copy-markdown')) || `status=${s} hasButton=${b.includes('copy-markdown')}`],
  // Guards the MDX-rendering bug: a `.mdx` page with the integration missing
  // renders its `import {...}` line as literal text and never expands <Aside>.
  ['mdx components render', '/guides/configuration/', (s, b) => (!b.includes('import {') && b.includes('starlight-aside')) || `leakedImport=${b.includes('import {')} hasAside=${b.includes('starlight-aside')}`],
  ['open-in-Claude action', '/guides/configuration/', (s, b) => b.includes('claude.ai/new') || 'missing claude.ai/new link'],
  ['open-in-ChatGPT action', '/guides/configuration/', (s, b) => b.includes('chatgpt.com') || 'missing chatgpt.com link'],
]

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/', { redirect: 'manual' })
      if (r.status > 0) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
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
    process.exit(1)
  }
  for (const [label, path, assert] of checks) {
    const res = await fetch(BASE + path, { redirect: 'follow' })
    const body = await res.text()
    const verdict = assert(res.status, body)
    if (verdict === true) {
      console.log(`✓ ${label}  (${path})`)
    } else {
      console.error(`✗ ${label}  (${path}) — ${verdict}`)
      failed = true
    }
  }
} finally {
  server.kill('SIGTERM')
}

console.log(failed ? '\nFAIL' : '\nPASS — docs site serves and all AI endpoints are live.')
process.exit(failed ? 1 : 0)
