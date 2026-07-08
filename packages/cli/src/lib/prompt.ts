/**
 * Minimal interactive prompt — the TS port of setup.sh's `ask`. Returns the
 * default when non-interactive (no TTY, or --yes), so the same flow drives both
 * a human terminal and a CI/`--yes` run.
 */
import process from 'node:process'
import * as readline from 'node:readline/promises'

export interface AskOptions {
  /** Skip the prompt and use `def` (set by --yes or when stdin isn't a TTY). */
  nonInteractive: boolean
}

export async function ask(prompt: string, def: string, opts: AskOptions): Promise<string> {
  if (opts.nonInteractive || !process.stdin.isTTY) {
    return def
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const label = def ? `  ${prompt} [${def}]: ` : `  ${prompt}: `
    const reply = (await rl.question(label)).trim()
    return reply || def
  }
  catch {
    // Ctrl-D / EOF closes the stream mid-prompt — treat it as an empty reply and
    // fall back to the default (matches setup.sh's `read`-returns-nonzero behavior).
    return def
  }
  finally {
    rl.close()
  }
}

/** Pause until the user presses Enter (no-op when non-interactive). */
export async function pause(prompt: string, opts: AskOptions): Promise<void> {
  if (opts.nonInteractive || !process.stdin.isTTY) {
    return
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    await rl.question(`  ${prompt}`)
  }
  finally {
    rl.close()
  }
}
