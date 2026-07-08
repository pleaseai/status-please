/**
 * Child-process helpers. `run` streams output through (for long-running deploys);
 * `capture` collects stdout (for JSON queries like `wrangler d1 list --json`).
 */
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** When true, swallow a non-zero exit and return it instead of rejecting. */
  allowFailure?: boolean
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

// On Windows, package managers and git resolve to `.cmd`/`.ps1` shims that
// Node's spawn won't launch without a shell. All commands here are first-party
// (fixed subcommands + the user's own local config values, run on their own
// machine — no privilege boundary), so shelling out on win32 is safe.
const useShell = process.platform === 'win32'

/** Run a command, inheriting stdio so the user sees wrangler/astro output live. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: 'inherit',
      shell: useShell,
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const exit = code ?? 1
      if (exit !== 0 && !opts.allowFailure) {
        reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${exit}`))
        return
      }
      resolve(exit)
    })
  })
}

/** Run a command and capture stdout/stderr — for machine-readable queries. */
export function capture(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      const exit = code ?? 1
      if (exit !== 0 && !opts.allowFailure) {
        reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${exit}: ${stderr.trim()}`))
        return
      }
      resolve({ code: exit, stdout, stderr })
    })
  })
}
