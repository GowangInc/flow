// REVISION: flow-v86-flat-side
//
// Flow's settings and the `/flow` command's grammar, shared by every harness adapter (Claude Code's
// register.tsx, pi's pi/index.ts). Pure: no engine imports. Replies carry no
// `flow:` prefix: Claude Code adds the plugin's name itself; pi's adapter adds it.

import { hasNight, nextStyle, STYLES, styleNamed, type SceneName } from './styles'

export type FlowMode = 'auto' | 'manual'
/** `band` above the prompt, or `spine`: a tall pane docked beside the transcript. */
export type FlowLayout = 'band' | 'spine'

/** The words for each layout: its name, and others it answers to. */
const LAYOUTS: ReadonlyMap<string, FlowLayout> = new Map([
  ['band', 'band'],
  ['horizontal', 'band'],
  ['bar', 'band'],
  ['flat', 'band'],
  ['spine', 'spine'],
  ['portrait', 'spine'],
  ['vertical', 'spine'],
  ['side', 'spine'],
])
/** Day or night for the scenes that have both: by the local `clock`, or pinned. */
export type FlowTime = 'clock' | 'day' | 'night'
export type FlowConfig = {
  mode: FlowMode
  style: SceneName
  /** Auto mode while idle: 1 a low glow, 0 dark (the band gives its rows back). */
  idle: 0 | 1
  level: number
  layout: FlowLayout
  time: FlowTime
}
/** The local time of day, as the adapter last read it. */
export type Clock = { hour: number; minute: number }

const DEFAULT_LEVEL = 8
/** By the clock, night runs from this hour... */
const NIGHT_FROM = 19
/** ...until this one. */
const DAY_FROM = 7

const label = (s: number) => (s === 0 ? 'off' : `${s}/10`)

/** Whether the scene is at night, given the local hour (0-23). */
export function isNightAt(time: FlowTime, hour: number): boolean {
  if (time !== 'clock') return time === 'night'
  return hour >= NIGHT_FROM || hour < DAY_FROM
}

/** Stored settings, validated: anything missing or out of range falls back. */
export function readConfig(options: Readonly<Record<string, unknown>> | undefined): FlowConfig {
  const o = options ?? {}
  const level = Number(o.level)
  return {
    mode: o.mode === 'manual' ? 'manual' : 'auto',
    style: (typeof o.style === 'string' && styleNamed(o.style)) || 'fire',
    idle: o.idle === 'dark' ? 0 : 1, // `glow`, and `pilot` from before
    level: Number.isInteger(level) && level >= 0 && level <= 10 ? level : DEFAULT_LEVEL,
    layout: o.layout === 'spine' ? 'spine' : 'band',
    time: o.time === 'day' || o.time === 'night' ? o.time : 'clock',
  }
}

/** A setting as it is stored (idle reads `glow` / `dark`). */
export function storedValue(field: keyof FlowConfig, value: FlowConfig[keyof FlowConfig]): string | number {
  if (field === 'idle') return value === 0 ? 'dark' : 'glow'
  return value
}

export type FlowCommand =
  | { kind: 'show' }
  | { kind: 'help' }
  | { kind: 'auto' }
  | { kind: 'idle'; level: 0 | 1 }
  /** A fixed level; none given holds the configured one. */
  | { kind: 'manual'; level?: number }
  /** A scene (none given: the next one), optionally with the time of day too. */
  | { kind: 'style'; name?: SceneName; time?: FlowTime }
  | { kind: 'layout'; layout?: FlowLayout }
  | { kind: 'time'; time: FlowTime }
  | { kind: 'error'; text: string }

const SCENES = STYLES.join(', ')
const USAGE = '! `/flow help` lists what it takes; `/flow next` cycles the scenes'

const TIMES = new Map<string, FlowTime>([
  ['day', 'day'],
  ['night', 'night'],
  ['clock', 'clock'],
])
const IDLE = new Map<string, 0 | 1>([
  ['0', 0],
  ['dark', 0],
  ['off', 0],
  ['1', 1],
  ['glow', 1],
  ['on', 1],
])

export function parseFlowArgs(args: string): FlowCommand {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const [a, b, extra] = words
  if (a === undefined) return { kind: 'show' }
  if (extra !== undefined) return { kind: 'error', text: USAGE }
  if (a === 'idle') {
    const level = b === undefined ? undefined : IDLE.get(b)
    if (level !== undefined) return { kind: 'idle', level }
    return { kind: 'error', text: '! `/flow idle glow` (a low glow while idle) or `/flow idle dark` (nothing)' }
  }
  if (a === 'layout') {
    if (b === undefined) return { kind: 'layout' }
    const layout = LAYOUTS.get(b)
    if (layout) return { kind: 'layout', layout }
    return { kind: 'error', text: '! `/flow band` (above the prompt) or `/flow spine` (a tall side pane)' }
  }
  // `style <name>`, from before scenes were picked by name alone.
  if (a === 'style' && b !== undefined) return sceneCommand(b, undefined)
  // A scene and a time of day, either way round: `/flow surf night`.
  if (b !== undefined) {
    const timeB = TIMES.get(b)
    if (timeB) return sceneCommand(a, timeB)
    const timeA = TIMES.get(a)
    if (timeA) return sceneCommand(b, timeA)
    return { kind: 'error', text: USAGE }
  }
  if (a === 'help' || a === 'list' || a === '?') return { kind: 'help' }
  if (a === 'auto' || a === 'on') return { kind: 'auto' }
  if (a === 'next' || a === 'style') return { kind: 'style' }
  const layout = LAYOUTS.get(a)
  if (layout) return { kind: 'layout', layout }
  const time = TIMES.get(a)
  if (time) return { kind: 'time', time }
  if (a === 'off') return { kind: 'manual', level: 0 }
  if (a === 'manual') return { kind: 'manual' }
  if (/^\d+$/.test(a)) {
    if (Number(a) <= 10) return { kind: 'manual', level: Number(a) }
    return { kind: 'error', text: '! levels run from 0 (off) to 10' }
  }
  return sceneCommand(a, undefined)
}

/** A scene by name, or an error that lists them. */
function sceneCommand(word: string, time: FlowTime | undefined): FlowCommand {
  const name = styleNamed(word)
  if (name) return time ? { kind: 'style', name, time } : { kind: 'style', name }
  return { kind: 'error', text: `! no scene "${word}" — the scenes are ${SCENES} (\`/flow next\` cycles them)` }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** How the time of day reads: `night`, or `day (clock 08:54)` when the clock decides. */
function timeText(cfg: FlowConfig, clock: Clock): string {
  const night = isNightAt(cfg.time, clock.hour)
  return `${night ? 'night' : 'day'}${cfg.time === 'clock' ? ` (clock ${pad(clock.hour)}:${pad(clock.minute)})` : ''}`
}

/** The tints, in words: what made the scene change. */
const TINTS: Record<string, string> = { smoke: 'after a failure', blue: 'context nearly full' }

const BACK_TO_AUTO = '`/flow auto` to follow the work again'

/** `/flow` with no arguments: the scene, the mode and level now, any tint, the time of day. */
export function statusText(cfg: FlowConfig, levelNow: number, tint: string, clock: Clock): string {
  const parts = [`${cfg.style}`]
  parts.push(
    cfg.mode === 'auto'
      ? `auto, now ${label(levelNow)} (idle ${cfg.idle === 0 ? 'dark' : 'glow'})`
      : cfg.level === 0
        ? 'off'
        : `holding ${label(cfg.level)}`,
  )
  if (cfg.mode === 'auto' && TINTS[tint]) parts.push(TINTS[tint]!)
  if (hasNight(cfg.style)) parts.push(timeText(cfg, clock))
  else if (cfg.time !== 'clock') parts.push(`${cfg.time} pinned (${cfg.style} has no night)`)
  if (cfg.layout === 'spine') parts.push('spine')
  return `${parts.join(', ')}\nscenes: ${SCENES} · \`/flow next\` for another · \`/flow help\``
}

/** `/flow help`: everything it takes (`panes`: whether the harness has the spine). */
export function helpText(agent = "Claude's", panes = true): string {
  const lines = [
    'ambient scenes that move with the work',
    `  /flow <name>          pick a scene: ${SCENES}`,
    '  /flow next            the next scene',
    `  /flow day | night     pin the time of day (${STYLES.filter(hasNight).join(', ')})`,
    '  /flow clock           day or night by your clock (night 19:00 to 7:00)',
    '  /flow <name> night    a scene and a time of day at once',
    `  /flow auto            move with ${agent} work (the default)`,
    '  /flow 1-10 | off      hold a level (10 is the busiest), or switch it off',
    '  /flow idle glow|dark  in auto mode while idle: a low glow, or nothing',
  ]
  if (panes) {
    lines.push('  /flow band | spine    above the prompt, or a tall pane beside the transcript')
    lines.push('                        (also horizontal, bar or flat; portrait, vertical or side)')
  }
  return lines.join('\n')
}

/** The changes a parsed command makes, or none for `show` / `help` / `error`. */
export function changesFor(cmd: FlowCommand, cfg: FlowConfig): Partial<FlowConfig> | undefined {
  switch (cmd.kind) {
    case 'style': {
      const style = cmd.name ?? nextStyle(cfg.style)
      return cmd.time ? { style, time: cmd.time } : { style }
    }
    case 'auto':
      return { mode: 'auto' }
    case 'idle':
      return { idle: cmd.level, mode: 'auto' }
    case 'manual':
      return { level: cmd.level ?? cfg.level, mode: 'manual' }
    case 'layout':
      return { layout: cmd.layout ?? (cfg.layout === 'band' ? 'spine' : 'band') }
    case 'time':
      return { time: cmd.time }
    default:
      return undefined
  }
}

/** What `/flow` answers once a change is applied. */
export function changedText(cmd: FlowCommand, cfg: FlowConfig, agent: string, clock: Clock): string {
  switch (cmd.kind) {
    case 'style': {
      const time = hasNight(cfg.style) ? `, ${timeText(cfg, clock)}` : ''
      return `${cfg.style}${time} · \`/flow next\` for another`
    }
    case 'auto':
      return `auto — moves with ${agent} work`
    case 'idle':
      return `auto, ${cfg.idle === 0 ? 'dark while idle' : 'a low glow while idle'}`
    case 'manual':
      return cfg.level === 0 ? `off — ${BACK_TO_AUTO}` : `holding ${label(cfg.level)} — ${BACK_TO_AUTO}`
    case 'layout':
      return cfg.layout === 'spine' ? 'spine — a tall pane beside the transcript' : 'band — above the prompt'
    case 'time': {
      const what =
        cfg.time === 'clock'
          ? `day and night follow your clock, ${timeText(cfg, clock)} now (night is ${NIGHT_FROM}:00 to ${DAY_FROM}:00)`
          : `${cfg.time} until \`/flow clock\``
      const applies = hasNight(cfg.style)
        ? ''
        : ` (${cfg.style} has no night; it shows in ${STYLES.filter(hasNight).join(', ')})`
      return `${what}${applies}`
    }
    default:
      return ''
  }
}
