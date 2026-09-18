// Harness for the engine tests. The engine is a CLI, and the only honest way to test a CLI is to
// run it: each subcommand gets its own `node` process, exactly as SKILL.md invokes it. The files a
// subagent would write (scenarios.json, batch-<r>-<i>.json) are written here by hand instead, which
// is what makes an otherwise ambient pipeline deterministic.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const here = dirname(fileURLToPath(import.meta.url))

export const ENGINE = resolve(here, '../../plugin/skills/generate-tickets/engine.mjs')

/** A minimal stand-in for the user's TICKET_PROMPT.md. Content is irrelevant to the engine. */
export const SAMPLE_PROMPT = 'Generate support tickets for a fictional product.'

/**
 * The plugin manifest's version, read straight off disk rather than through `pluginVersion()`, so a
 * test asserting the stamp in `tickets.json` is checking it against the manifest and not against the
 * same code that produced it.
 */
export async function manifestVersion(): Promise<string> {
  const path = resolve(here, '../../plugin/.claude-plugin/plugin.json')
  return JSON.parse(await fs.readFile(path, 'utf-8')).version
}

export interface EngineResult {
  code: number
  stdout: string
  stderr: string
}

/** Run one engine subcommand. Never throws: a non-zero exit is a result, not an error. */
export async function runEngine(args: string[], cwd: string): Promise<EngineResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [ENGINE, ...args], { cwd })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string }
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? ''
    }
  }
}

export interface Run {
  /** Working directory the engine is invoked from. */
  dir: string
  /** The `--out` directory (absolute). */
  out: string
  /** The `--prompt` file (absolute). */
  promptFile: string
}

export async function newRun(): Promise<Run> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'qbort-engine-'))
  const promptFile = join(dir, 'TICKET_PROMPT.md')
  await fs.writeFile(promptFile, SAMPLE_PROMPT, 'utf-8')
  return { dir, out: join(dir, '.qbort-run'), promptFile }
}

export async function cleanup(run: Run): Promise<void> {
  await fs.rm(run.dir, { recursive: true, force: true })
}

export interface PlanOptions {
  count: number
  batchSize?: number
  staff?: boolean
  avg?: number
  staffMembers?: number
  ageDays?: number
}

/** `engine.mjs plan` with the flags spelled out, so tests read as settings rather than argv. */
export async function plan(run: Run, opts: PlanOptions): Promise<EngineResult> {
  const args = ['plan', '--prompt', run.promptFile, '--out', run.out, '--count', String(opts.count)]
  if (opts.batchSize !== undefined) args.push('--batch-size', String(opts.batchSize))
  if (opts.staff) args.push('--staff')
  if (opts.avg !== undefined) args.push('--avg', String(opts.avg))
  if (opts.staffMembers !== undefined) args.push('--staff-members', String(opts.staffMembers))
  // Default to the widest window so no opening time lands inside the "too fresh to have replies"
  // guard and silently strips a ticket's staff replies mid-assertion.
  args.push('--age-days', String(opts.ageDays ?? 3650))
  return runEngine(args, run.dir)
}

export async function readOutJson<T = any>(run: Run, name: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(join(run.out, name), 'utf-8')) as T
  } catch {
    return null
  }
}

export async function readOutText(run: Run, name: string): Promise<string | null> {
  try {
    return await fs.readFile(join(run.out, name), 'utf-8')
  } catch {
    return null
  }
}

export async function writeOut(run: Run, name: string, contents: string): Promise<void> {
  await fs.mkdir(run.out, { recursive: true })
  await fs.writeFile(join(run.out, name), contents, 'utf-8')
}

/** Stand in for the scenario subagent. */
export async function writeScenarios(run: Run, scenarios: string[]): Promise<void> {
  await writeOut(run, 'scenarios.json', JSON.stringify({ scenarios }, null, 2))
}

export interface DraftOptions {
  /** Number of staff replies to attach. */
  responses?: number
  status?: string
}

/** One raw ticket in the shape a batch subagent is asked to produce (no id, flat body/responses). */
export function rawTicket(label: string, opts: DraftOptions = {}): Record<string, unknown> {
  return {
    subject: `Subject ${label}`,
    body: `Body of ticket ${label}.`,
    status: opts.status ?? 'open',
    from: { name: `Customer ${label}`, email: `customer.${label}@acme.example` },
    responses: Array.from({ length: opts.responses ?? 0 }, (_, i) => ({
      body: `Reply ${i + 1} to ${label}.`,
      from: { name: 'Sarah Chen', email: 'sarah.chen@company.biz' }
    }))
  }
}

/** Stand in for a batch subagent: write `labels` as a well-formed batch file. */
export async function writeBatch(
  run: Run,
  round: number,
  index: number,
  labels: string[],
  opts: DraftOptions = {}
): Promise<void> {
  const body = JSON.stringify({ tickets: labels.map((l) => rawTicket(l, opts)) }, null, 2)
  await writeOut(run, `batch-${round}-${index}.json`, body)
}

export interface RoundManifest {
  round: number
  batches: { index: number; count: number; promptFile: string; batchFile: string }[]
}

export function readRound(run: Run, round: number): Promise<RoundManifest | null> {
  return readOutJson<RoundManifest>(run, `round-${round}.json`)
}

/**
 * Pull the numbered scenario lines back out of a compiled batch prompt. The engine deals scenarios
 * into the prompt text and nowhere else, so reading them back is the only way to assert the deal.
 */
export function scenariosInPrompt(prompt: string): string[] {
  return prompt
    .split('\n')
    .map((line) => line.match(/^ {2}\d+\. (.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1])
}
