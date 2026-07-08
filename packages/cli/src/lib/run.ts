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
  /**
   * Run through a shell. Needed only to launch a **bare** command name (a package
   * manager, `git`) on Windows, where those resolve to `.cmd`/`.ps1` shims Node's
   * spawn won't run directly. Off by default — the wrangler/astro spawns use an
   * absolute `node` path (`execPath`) that needs no shell, so their config-derived
   * args (e.g. a D1 `database_name`) never reach `cmd.exe` for reinterpretation.
   * Only set it where every argument is a compile-time constant.
   */
  shell?: boolean
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Run a command, inheriting stdio so the user sees wrangler/astro output live. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: 'inherit',
      shell: opts.shell ?? false,
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
      shell: opts.shell ?? false,
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
