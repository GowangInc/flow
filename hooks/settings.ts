// REVISION: flow-v123-first-tips
//
// Flow's settings and the `/flow` command's grammar, shared by every harness adapter (Claude Code's
// register.tsx, pi's pi/index.ts). Pure: no engine imports. Replies carry no
// `flow:` prefix: Claude Code adds the plugin's name itself; pi's adapter adds it.
// `/flow` changes only the session it runs in; `/flow save` makes the
// session's settings the default new sessions start with, and `/flow reset`
// puts a session back on it (sessions.ts keeps each session's own).

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

/** A /config row as `$.config.list()` reads it: its key, the value as stored, the values it takes. */
export type StoredRow = { key: string; value: unknown; options?: readonly string[] }
/** A row to write back: the value stored, and the one it stands for now. */
export type StaleRow = { key: string; field: keyof FlowConfig; from: string; to: string | number }

/**
 * Flow's rows (`<plugin>.<field>`) holding a value none of their options are:
 * a scene since renamed (`colony`, now `avalon`) or dropped (`river`, `lava`),
 * an alias, idle's old `pilot`. Claude Code reads such a value as the row's
 * default before Flow loads, and says so at every load; each comes back with
 * what it stands for now (the default, for a scene that's gone), to write back.
 */
export function staleRows(rows: readonly StoredRow[], plugin: string): StaleRow[] {
  const fields = Object.keys(readConfig(undefined)) as (keyof FlowConfig)[]
  const stale: StaleRow[] = []
  for (const row of rows) {
    const field = fields.find(f => row.key === `${plugin}.${f}`)
    const { value, options } = row
    if (!field || !options || typeof value !== 'string' || options.includes(value)) continue
    const to = storedValue(field, readConfig({ [field]: value })[field])
    if (options.includes(String(to))) stale.push({ key: row.key, field, from: value, to })
  }
  return stale
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
  /** Make this session's settings the default new sessions start with. */
  | { kind: 'save' }
  /** Put this session back on the default. */
  | { kind: 'reset' }
  | { kind: 'error'; text: string }

const SCENES = STYLES.join(', ')
const USAGE = '! `/flow help` lists what it takes; `/flow next` cycles the scenes'
const DEFAULT_USAGE = "! `/flow save` makes this session's settings your default; `/flow reset` puts this session back on it"

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
  if (a === 'save') return { kind: 'save' }
  if (a === 'reset') return { kind: 'reset' }
  // (Either could be meant: say which is which.)
  if (a === 'default' || a === 'defaults') return { kind: 'error', text: DEFAULT_USAGE }
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

/** The mode and its level, as a person thinks of them: `auto`, `off` or `holding 5/10`. */
const modeText = (cfg: FlowConfig) => (cfg.mode === 'auto' ? 'auto' : cfg.level === 0 ? 'off' : `holding ${label(cfg.level)}`)

/** The settings as a person thinks of them (the mode carries its level), in the status line's order. */
type Item = 'style' | 'mode' | 'idle' | 'time' | 'layout' | 'sound'
const ITEMS: readonly Item[] = ['style', 'mode', 'idle', 'time', 'layout', 'sound']

function itemText(cfg: FlowConfig, item: Item): string {
  switch (item) {
    case 'style':
      return cfg.style
    case 'mode':
      return modeText(cfg)
    case 'idle':
      return `idle ${cfg.idle === 0 ? 'dark' : 'glow'}`
    case 'time':
      return cfg.time === 'clock' ? 'day and night by the clock' : cfg.time
    case 'layout':
      return cfg.layout
    case 'sound':
      return `sound ${cfg.sound}`
  }
}

/** Where two sets of settings differ, as a person would notice (a manual level held in auto mode doesn't show). */
function differingItems(a: FlowConfig, b: FlowConfig): Item[] {
  return ITEMS.filter(i => itemText(a, i) !== itemText(b, i))
}

const inWords = (cfg: FlowConfig, items: readonly Item[]) => items.map(i => itemText(cfg, i)).join(', ')

/**
 * `/flow` with no arguments: the scene, the mode and level now, any tint, the
 * time of day; then, where this session's settings differ from the default
 * (`defaults`, what new sessions start with), what the default has instead.
 */
export function statusText(cfg: FlowConfig, levelNow: number, tint: string, clock: Clock, defaults?: FlowConfig): string {
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
  const lines = [parts.join(', ')]
  const own = defaults ? differingItems(cfg, defaults) : []
  if (defaults && own.length) {
    lines.push(`just this session (your default: ${inWords(defaults, own)}) · \`/flow save\` makes this the default · \`/flow reset\` goes back`)
  }
  lines.push(`scenes: ${SCENES} · \`/flow next\` for another · \`/flow help\``)
  return lines.join('\n')
}

/**
 * Under the reply to a change that first sets this session apart from the
 * default: that it's this session's alone, and how to make it the default.
 */
export function ownHint(before: FlowConfig, after: FlowConfig, defaults: FlowConfig): string {
  const first = !differingItems(before, defaults).length && differingItems(after, defaults).length > 0
  return first ? '\njust this session · `/flow save` makes it your default for new sessions' : ''
}

/**
 * What `/flow save` answers: `before` the default it replaced, `saved`
 * whether anything was written, `refused` the fields /config would not take.
 */
export function savedText(cfg: FlowConfig, before: FlowConfig, saved: boolean, refused: readonly (keyof FlowConfig)[] = []): string {
  const notSaved = refused.length ? `  (not saved: /config refused ${refused.join(', ')})` : ''
  if (!saved) return refused.length ? `not saved: /config refused ${refused.join(', ')}` : 'already your default: new sessions start this way'
  const items = differingItems(cfg, before)
  return `saved as your default: new sessions start with ${items.length ? inWords(cfg, items) : 'these settings'}${notSaved}`
}

/** What `/flow reset` answers: `before` the session's settings, `defaults` what it's back on. */
export function resetText(before: FlowConfig, defaults: FlowConfig): string {
  const items = differingItems(before, defaults)
  return items.length ? `back to your default: ${inWords(defaults, items)}` : 'already on your default'
}

/** `/flow help`: everything it takes (`panes`: whether the harness has the spine). */
export function helpText(agent = "Claude's", panes = true): string {
  const lines = [
    'ambient scenes that move with the work; each session keeps its own settings',
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
  lines.push("  /flow save            make this session's settings the default new sessions start with")
  lines.push('  /flow reset           put this session back on the default')
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
 * The tips' first record, for someone with none (kept from a session's start,
 * before its own `/flow` can store anything). Someone new has been told
 * nothing. Someone who had Flow before tips were kept (`usedBefore`: other
 * state of Flow's already kept, a /config row from an older Flow) or has
 * changed a default (`settings`: the /config rows) has been told both: they
 * may well have found the other scenes and the sound already, and been
 * through them.
 */
export function firstTips(usedBefore: boolean, settings: FlowConfig): Tips {
  const defaults = readConfig(undefined)
  const changed = (Object.keys(defaults) as (keyof FlowConfig)[]).some(k => settings[k] !== defaults[k])
  return usedBefore || changed ? { scenesTold: true, soundTold: true } : {}
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
