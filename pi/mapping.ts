// REVISION: flow-v130-omp-mapping
//
// Pi and OMP events in the heat model's terms, and session entries in
// the settings'. Pure (no Node imports), so the shared test suite covers it.

import { countLines, type Effort } from '../hooks/activity'
import { readOwn, type Own } from '../hooks/sessions'
import type { PiSessionEntry, PiThinkingLevel } from './types'

/** The session entry that keeps a session's own settings, `{ own }`: the latest on the branch counts. */
export const FLOW_ENTRY = 'flow'

/** A session's own settings, from its branch's entries (none kept: it follows the defaults). */
export function ownInSession(entries: readonly PiSessionEntry[]): Own {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
    if (entry.type === 'custom' && entry.customType === FLOW_ENTRY) {
      return readOwn((entry.data as { own?: unknown } | undefined)?.own)
    }
  }
  return {}
}

export const COMMAND_TOOLS: Record<string, true> = { bash: true, powershell: true, eval: true, python: true }
export const READ_TOOLS: Record<string, true> = { read: true, grep: true, glob: true, find: true, ls: true, lsp: true, web_search: true }

/** pi's thinking level as the heat model's effort floor. */
export function effortOf(level: PiThinkingLevel | undefined): Effort {
  switch (level) {
    case 'off':
    case 'minimal':
    case 'low':
      return 'low'
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return level
    default:
      return undefined
  }
}

/** Lines a Pi or OMP write/edit call writes, not the length of its patch metadata. */
export function piLinesWritten(toolName: string, input: Record<string, unknown>): number | undefined {
  if (toolName === 'write') return countLines(input.content)
  if (toolName !== 'edit') return undefined
  if (typeof input.input === 'string') {
    // OMP's hashline patch: only '+' body rows write text.
    let lines = 0
    for (const line of input.input.split('\n')) if (line.startsWith('+')) lines++
    return lines
  }
  if (Array.isArray(input.edits)) {
    return input.edits.reduce((n: number, ed) => n + countLines((ed as Record<string, unknown>)?.newText), 0)
  }
  return countLines(input.newText ?? input.new_string)
}

/** Only task jobs are subagents; background shell and eval jobs aren't company. */
export function runningTasks(jobs: readonly { type: string }[]): number {
  let count = 0
  for (const job of jobs) if (job.type === 'task') count++
  return count
}
