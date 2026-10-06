// REVISION: flow-v105-tips
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
/** Each scene's soundscape: off (the default) or on. */
export type FlowSound = 'off' | 'on'
export type FlowConfig = {
  mode: FlowMode
  style: SceneName
  /** Auto mode while idle: 1 a low glow, 0 dark (the band gives its rows back). */
  idle: 0 | 1
  level: number
  layout: FlowLayout
  time: FlowTime
  sound: FlowSound
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
    sound: o.sound === 'on' ? 'on' : 'off',
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
  /** Sound on or off; none given toggles it. */
  | { kind: 'sound'; sound?: FlowSound }
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
  if (a === 'sound') {
    if (b === undefined) return { kind: 'sound' }
    if (b === 'on' || b === 'off') return { kind: 'sound', sound: b }
    return { kind: 'error', text: '! `/flow sound` toggles the soundscape, or `/flow sound on` / `/flow sound off`' }
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
  if (cfg.sound === 'on') parts.push('sound on')
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
    '  /flow sound [on|off]  a soundscape for each scene, swelling with the work (macOS); alone, toggles it',
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
    case 'sound':
      return { sound: cmd.sound ?? (cfg.sound === 'on' ? 'off' : 'on') }
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
    case 'sound':
      return cfg.sound === 'on' ? "sound on — each scene's soundscape, swelling with the work (macOS)" : 'sound off'
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

/**
 * What the one-time tips know (kept in the store): whether another scene and
 * the sound have ever been on, which tips have been given, and how many
 * chances (a `/flow`, a session starting) have passed since the scenes tip.
 */
export type Tips = { otherScene?: boolean; triedSound?: boolean; scenesTold?: boolean; soundTold?: boolean; since?: number }

/** Chances after the scenes tip before the sound tip. */
const SOUND_TIP_AFTER = 3

/** Reads stored tips, leaving out anything that isn't one. */
export function readTips(v: unknown): Tips {
  if (!v || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  const t: Tips = {}
  for (const k of ['otherScene', 'triedSound', 'scenesTold', 'soundTold'] as const) if (o[k] === true) t[k] = true
  if (typeof o.since === 'number' && Number.isInteger(o.since) && o.since >= 0) t.since = o.since
  return t
}

/**
 * A chance to give a tip (a `/flow` just run, or a session starting), with the
 * settings as they now are: the tip to give, if any, and the tips to keep.
 * Once ever: the other scenes, while it's still the fire and none other has
 * been on; then, three chances on, the sound, if it has never been on.
 */
export function nextTip(tips: Tips, cfg: FlowConfig): { tip?: string; tips: Tips } {
  const t: Tips = { ...tips }
  if (cfg.style !== 'fire') t.otherScene = true
  if (cfg.sound === 'on') t.triedSound = true
  if (!t.scenesTold) {
    t.scenesTold = true
    t.since = 0
    if (!t.otherScene)
      return {
        tip: `flow: the fire is one of ${STYLES.length} scenes (${STYLES.filter(s => s !== 'fire').join(', ')}): \`/flow next\` steps through them, or \`/flow <name>\` picks one.`,
        tips: t,
      }
    return { tips: t }
  }
  if (t.soundTold) return { tips: t }
  if (t.triedSound) return { tips: { ...t, soundTold: true } }
  t.since = (t.since ?? 0) + 1
  if (t.since < SOUND_TIP_AFTER) return { tips: t }
  t.soundTold = true
  return { tip: 'flow: every scene has a soundscape too, swelling with the work: `/flow sound` turns it on (macOS).', tips: t }
}
