// REVISION: flow-v61-names
//
// pi's events in the heat model's terms. Pure (no Node imports), so the
// shared test suite covers it.

import { countLines, type Effort } from '../hooks/activity'
import type { PiThinkingLevel } from './types'

export const COMMAND_TOOLS = new Set(['bash', 'powershell'])
export const READ_TOOLS = new Set(['read', 'grep', 'find', 'ls'])

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

/** Lines a pi write or edit call writes: `content`, or every `edits[].newText`. */
export function piLinesWritten(toolName: string, input: Record<string, unknown>): number | undefined {
  if (toolName === 'write') return countLines(input.content)
  if (toolName !== 'edit') return undefined
  if (Array.isArray(input.edits)) {
    return input.edits.reduce((n: number, ed) => n + countLines((ed as Record<string, unknown>)?.newText), 0)
  }
  return countLines(input.newText) // the legacy single-edit form
}
