/**
 * Pretty terminal logging — the TS port of setup.sh's step/info/ok/warn/die
 * helpers. Colors are emitted only to a real TTY so piped/CI output stays clean.
 */
import process from 'node:process'

const tty = process.stdout.isTTY === true
const B = tty ? '[1m' : ''
const DIM = tty ? '[2m' : ''
const GRN = tty ? '[32m' : ''
const YLW = tty ? '[33m' : ''
const RED = tty ? '[31m' : ''
const RST = tty ? '[0m' : ''

let stepCount = 0

/** Numbered top-level step header (resets are not needed across one run). */
export function step(title: string): void {
  stepCount += 1
  process.stdout.write(`\n${B}▸ ${stepCount}. ${title}${RST}\n`)
}

export function info(msg: string): void {
  process.stdout.write(`  ${msg}\n`)
}

export function ok(msg: string): void {
  process.stdout.write(`  ${GRN}✓ ${msg}${RST}\n`)
}

export function warn(msg: string): void {
  process.stdout.write(`  ${YLW}! ${msg}${RST}\n`)
}

export function dim(msg: string): void {
  process.stdout.write(`${DIM}${msg}${RST}\n`)
}

export function success(msg: string): void {
  process.stdout.write(`\n${GRN}${B}✓ ${msg}${RST}\n`)
}

/** Print an error and exit non-zero — the CLI's fatal path. */
export function die(msg: string): never {
  process.stderr.write(`\n${RED}✗ ${msg}${RST}\n`)
  process.exit(1)
}
