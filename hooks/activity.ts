// REVISION: flow-v64-tool-spark
//
// How busy the agent is: the work → scene mapping for `/flow auto`. Events
// add "heat" (the metaphor from when the only scene was a fire), the heat
// cools every frame, and `strength()` turns it into the scene's 0..=10 dial
// (a fire's height, the swell, the balloon's altitude, ...), and a turn that
// keeps going climbs a level every 30 s besides (its clock stopped while it
// waits on the person: a permission, a question, a plan). It also says
// which tint shows: smoke after a failure or a compaction, blue when the
// context is nearly full. Pure: no `$`, so it is unit-tested directly.
//
// Calibrated so the range reads as work, not chatter (see the calibration
// tests): a streamed answer sits mid-range, reads and any other tool (an MCP
// server's) spark a little, edits and commands flare above it, a few
// subagents push it high, and 10 takes parallel work plus edits.

import type { Tint } from './styles'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number | undefined

/** Per-frame cooling: at 70 ms frames, a burst halves in ~2.4 s. */
const DECAY = 0.98
const MAX_HEAT = 5
/** Streaming heat per character, and its cap per frame (a rate, not a chunk). */
const STREAM_PER_CHAR = 0.002
const STREAM_CAP = 0.025
/** Activity from a subagent's loop counts at this weight (its count adds the rest). */
const SUBAGENT_WEIGHT = 0.5
/** A turn's running time adds a level every TURN_STEP_MS (frames are 70 ms). */
const FRAME_MS = 70
const TURN_STEP_MS = 30_000
/** Frames of gray tips after a failed command / a compaction. */
const FAIL_SMOKE = 30
const COMPACT_SMOKE = 40

export function effortFloor(effort: Effort): number {
  switch (effort) {
    case 'low':
      return 2
    case 'medium':
      return 3
    case 'high':
      return 4
    case 'xhigh':
      return 5
    case 'max':
      return 6
    default:
      return 3
  }
}

export class Activity {
  heat = 0
  isTurnActive = false
  runningAgents = 0
  toolsInFlight = 0
  floor = 3
  smokeFrames = 0
  contextPercent = 0
  /** Frames this turn has been running (none between turns), not counting time it waited on the person. */
  turnFrames = 0
  /** The calls waiting on the person (a permission ask, a question, a plan to approve), by tool_use_id. */
  private waits = new Set<string>()
  /** Streamed characters since the last tick, weighted. */
  private pendingChars = 0

  private add(n: number): void {
    this.heat = Math.min(MAX_HEAT, this.heat + n)
  }

  turnStarted(): void {
    if (!this.isTurnActive) this.turnFrames = 0
    this.isTurnActive = true
  }

  turnEnded(): void {
    this.isTurnActive = false
    this.turnFrames = 0
    this.waits.clear()
  }

  /** A call now waits on the person: the turn's clock stops till it's answered. */
  waitingOn(id: string): void {
    this.waits.add(id)
  }

  /** The call is answered (or over): the clock goes on, unless another still waits. */
  answered(id: string): void {
    this.waits.delete(id)
  }

  /** Whether the turn is held up waiting on the person. */
  get isWaiting(): boolean {
    return this.waits.size > 0
  }

  /** One model request. Only the main loop's sets the effort floor. */
  modelStep(effort: Effort, isSubagent = false): void {
    if (!isSubagent) this.floor = effortFloor(effort)
    this.add(isSubagent ? 0.2 : 0.4)
  }

  /** Streamed output; thinking counts half. Applied per frame at a capped rate. */
  streamed(chars: number, kind: 'text' | 'thinking' = 'text', isSubagent = false): void {
    this.pendingChars += chars * (kind === 'thinking' ? 0.5 : 1) * (isSubagent ? SUBAGENT_WEIGHT : 1)
  }

  /** Code written: a flare scaled by the lines changed. */
  edited(lines: number, isSubagent = false): void {
    this.add(Math.min(4, 1 + lines / 15) * (isSubagent ? SUBAGENT_WEIGHT : 1))
  }

  ranCommand(isSubagent = false): void {
    this.add(isSubagent ? SUBAGENT_WEIGHT : 1)
  }

  read(isSubagent = false): void {
    this.add(isSubagent ? 0.25 : 0.5)
  }

  /** Any other tool (an MCP server's, one with no word of its own here): work of a size unknown, a small spark as a read is. */
  usedTool(isSubagent = false): void {
    this.add(isSubagent ? 0.25 : 0.5)
  }

  /** The Agent tool: a small spark; the running count does the rest. */
  spawnedAgent(): void {
    this.add(0.5)
  }

  /** A command failed: the scene dips and shows smoke for ~2 s. */
  failed(): void {
    this.smokeFrames = FAIL_SMOKE
    this.heat = Math.max(0, this.heat - 2)
  }

  /** A real compaction: the scene drops to nothing, shows smoke, then picks up again. */
  compacted(): void {
    this.heat = 0
    this.smokeFrames = COMPACT_SMOKE
  }

  get isWorking(): boolean {
    return this.isTurnActive || this.runningAgents > 0
  }

  /** Heat that still shows as at least one level (strength rounds). */
  get isGlowing(): boolean {
    return this.heat >= 0.5
  }

  /** Levels from running subagents: diminishing, so a swarm doesn't pin 10. */
  get agentBoost(): number {
    return this.runningAgents > 0 ? 1.2 * Math.log2(1 + this.runningAgents) : 0
  }

  /** Levels from how long this turn has been going: one for every 30 s (time spent waiting on the person aside). */
  get turnBoost(): number {
    return this.isTurnActive ? Math.floor((this.turnFrames * FRAME_MS) / TURN_STEP_MS) : 0
  }

  /** Advance `frames` frames (a slow tick covers several) of cooling. */
  tick(frames = 1): void {
    if (this.isTurnActive && !this.isWaiting) this.turnFrames += frames
    if (this.pendingChars > 0) {
      this.add(Math.min(STREAM_CAP * frames, this.pendingChars * STREAM_PER_CHAR))
      this.pendingChars = 0
    }
    this.heat *= Math.pow(DECAY, frames)
    if (this.heat < 0.01) this.heat = 0
    // A tool still running (a long build, a blocked command) keeps a low burn.
    if (this.isWorking && this.toolsInFlight > 0 && this.heat < 1) this.heat = 1
    this.smokeFrames = Math.max(0, this.smokeFrames - frames)
  }

  /**
   * The dial for this frame. Idle: the idle floor (0 or 1) plus whatever is
   * still cooling. A turn: its effort floor + heat + the subagent boost + a
   * level for every 30 s it has run. Subagents alone (the turn over): from 1,
   * + heat + their boost.
   */
  strength(idleFloor: number): number {
    if (!this.isWorking) return Math.max(0, Math.min(10, Math.round(idleFloor + this.heat)))
    const base = this.isTurnActive ? this.floor : 1
    return Math.max(1, Math.min(10, Math.round(base + this.heat + this.agentBoost) + this.turnBoost))
  }

  /** How much company subagents add (a wider fire, more boats, wingmen): 15 per running subagent. */
  get coverageBoost(): number {
    return Math.min(60, this.runningAgents * 15)
  }

  get tint(): Tint {
    if (this.smokeFrames > 0) return 'smoke'
    if (this.contextPercent >= 85) return 'blue'
    return 'normal'
  }
}

export function countLines(s: unknown): number {
  if (typeof s !== 'string') return 0
  let n = 1
  for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++
  return n
}

/** How many lines a write-ish tool call changes (its new text). */
export function linesWritten(tool: string, input: unknown): number | undefined {
  const i = (input ?? {}) as Record<string, unknown>
  switch (tool) {
    case 'Write':
      return countLines(i.content)
    case 'Edit':
      return countLines(i.new_string)
    case 'MultiEdit':
      return Array.isArray(i.edits)
        ? i.edits.reduce((n: number, ed) => n + countLines((ed as Record<string, unknown>)?.new_string), 0)
        : 1
    case 'NotebookEdit':
      return countLines(i.new_source)
    default:
      return undefined
  }
}
