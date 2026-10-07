// REVISION: flow-v120-per-session
//
// Flow for Claude Code, by Rob Macrae: ambient scenes (a fire, the surf, a ski run,
// rockets, a hot-air balloon and more) drawn as one terminal `Raster` in the
// band above the prompt (5 rows) or in a tall pane docked beside the
// transcript (the spine), and repainted with `$.ui.blit`: ~14 fps while busy,
// 8 fps when calm, not at all while off screen or a frame comes out unchanged.
// Claude desktop has no Raster: there each frame is drawn as one `Svg` holding
// the scene as a small image (svg.ts), redrawn up to 10 times a second.
//
// Auto mode (the default) moves with the work Claude is doing: idle it sits
// at a low glow (or dark); a turn lifts it by effort, streamed output keeps
// it going, edits push it by lines written, commands spark, subagents add to
// the scene and stoke it, a failed command or a compaction shows as smoke,
// and a nearly-full context as blue (each scene shows these its own way).
//
// Settings are per session. The `userConfig` rows in /config (mode, style,
// idle, level, layout, time, sound) are the defaults every session starts
// from; `/flow` changes only the session it runs in, at once (a /config
// write would reload the module and restart the scene), and keeps the change
// in the store under the session's id, so a reload or a resume brings it
// back. `/flow save` writes the session's settings to /config, the default
// for new sessions; `/flow reset` puts the session back on it. A change made
// in /config itself is a default, and shows in that session at once.
// `/flow help` lists the command's forms (see settings.ts, sessions.ts).

import { atom, update } from 'claude-code'
import type { CommandRunInput, CommandRunResult, EngineInterface, Register } from 'claude-code'

import { Balloon } from './balloon'
import { Activity, linesWritten } from './activity'
import { FRAME_MS, SceneDriver } from './scene'
import {
  changedText,
  changesFor,
  helpText,
  ownHint,
  parseFlowArgs,
  readConfig,
  resetText,
  savedText,
  statusText,
  storedValue,
  type FlowConfig,
  type FlowLayout,
  nextTip,
  readTips,
} from './settings'
import {
  differences,
  type Own,
  ownAfterSwitch,
  readOwn,
  readRecord,
  SESSION_PREFIX,
  type SessionRecord,
  sessionKey,
  staleSessions,
  storedOwn,
  storedRecord,
  withOwn,
} from './sessions'
import { styleNamed } from './styles'
import { frameSvg } from './svg'
import { type BedTake, bedStep, burst, gather, MAX_PLAYS, unit, eventPlay, master, type SoundEvent } from './sound'


const FLOW_REVISION = 'flow-v120-per-session'
const PLUGIN = 'flow'
const KEY = 'flow'
/** The command. */
const COMMAND = 'flow'
/** How often the local clock is read, for day and night. */
const CLOCK_POLL_MS = 60_000
const HIDDEN_MS = 350 // off screen: only the activity keeps cooling
const AGENT_POLL_MS = 1000 // while anything is working
const AGENT_IDLE_POLL_MS = 5000 // otherwise: subagents can run on after a turn, or a reload
/** How often the session's id is read: a /clear or a resume from inside the session moves it on under this load. */
const SESSION_POLL_MS = 5000
/** After a session ends with the process going on (a /clear, a resume), the id is read every second this many times. */
const SESSION_WATCH_CHECKS = 10
/** A blit unanswered for this many ticks is presumed lost, not in flight. */
const BLIT_STALE_TICKS = 15
const MAX_ROWS = 5
/** A desktop site redraws at most 10 times a second (`$.ui.invalidate`'s limit there). */
const DESKTOP_MS = 100
/** How loud the soundscape plays (linear gain, 0 to 4). */
const SOUND_GAIN = 1
/**
 * Small events are gathered this long (ms) and played together, each at its
 * moment: each clip holds one of the player's few plays for its length and
 * almost a second more (afplay starting and draining), so not much shorter.
 */
const SOUND_BURST_MS = 1000
/** The nearest two events of a kind with clips play (nearer, the ear hears one). */
const SOUND_STAGGER_MS = 120
/** A desktop site that hasn't rendered for this many ticks (about 3 s) is gone. */
const DESKTOP_STALE_TICKS = 45
/** A desktop cell in CSS pixels (its text's column and line), to size the frame's image. */
const DESKTOP_CELL_W = 8
const DESKTOP_CELL_H = 19
/** The spine: a pane docked beside the fullscreen transcript, floor to ceiling. */
const SPINE = 'flow'
/** The width the spine asks for; the dock seats it no narrower than its minimum. */
const SPINE_COLUMNS = 13
const SPINE_INLINE_ROWS = 12 // when not fullscreen, it sits above the prompt
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LSP', 'WebFetch', 'WebSearch'])
/** Tools that are the person's to answer: Claude's question, a plan to approve. The turn's clock stops while one is open. */
const PERSON_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
/** Store keys from before settings moved to userConfig (and v3's `drop`). */
const LEGACY_KEYS = ['mode', 'strength', 'idle', 'style', 'drop'] as const

/**
 * The balloon's altitude, kept in session state: a setting change reloads
 * the module and rebuilds the balloon, which should resume, not take off again.
 */
const altitudeAtom = atom({ plugin: 'flow', key: 'altitude' } as const, 0)

async function keepAltitude($: EngineInterface, altitude: number): Promise<void> {
  await update($, altitudeAtom, () => altitude)
}

async function savedAltitude($: EngineInterface): Promise<number> {
  const { value } = await $.state.get({ plugin: 'flow', key: 'altitude' } as const)
  return typeof value === 'number' ? value : 0
}

/**
 * Before sessions kept their own settings, `/flow` kept its changes here,
 * shared by every session, and wrote them through to /config when a session
 * ended. Any still pending are written through once (see migrateOverrides).
 */
const OVERRIDES = 'overrides'

async function pendingOverrides($: EngineInterface): Promise<Own> {
  return readOwn(await $.store.get(OVERRIDES))
}

/** Write settings to their /config rows, answering the fields it could not write. */
async function saveConfig($: EngineInterface, changes: Partial<FlowConfig>): Promise<(keyof FlowConfig)[]> {
  const refused: (keyof FlowConfig)[] = []
  for (const [field, value] of Object.entries(changes) as [keyof FlowConfig, FlowConfig[keyof FlowConfig]][]) {
    try {
      const r = await $.config.set({ key: `${PLUGIN}.${field}`, value: storedValue(field, value) })
      if (r.deny) refused.push(field)
    } catch {
      refused.push(field)
    }
  }
  return refused
}

/**
 * The overrides still pending from before (a session on an older version may
 * still be writing them): written through to /config, as that session would
 * have when it ended, and forgotten once written; only those still holding
 * the value written, as another may have changed one meanwhile. Answers what
 * was pending: the defaults now (the /config rows' reload may not have come
 * yet), so nobody loses the scene they had.
 */
export async function migrateOverrides($: EngineInterface): Promise<Own> {
  const pending = await pendingOverrides($)
  if (!Object.keys(pending).length) return pending
  const refused = await saveConfig($, pending)
  try {
    const now = await pendingOverrides($)
    for (const k of Object.keys(pending) as (keyof FlowConfig)[]) {
      if (!refused.includes(k) && now[k] === pending[k]) delete now[k]
    }
    if (Object.keys(now).length) await $.store.set(OVERRIDES, storedOwn(now))
    else await $.store.delete(OVERRIDES)
  } catch {
    // Still pending in the store: the next load writes them again.
  }
  return pending
}

/**
 * This load's session: its id, the defaults (the /config rows) and its own
 * settings over them, kept in the store under the id (sessions.ts). Terminal
 * and desktop views of one session are one load, so they share all of it.
 */
type Session = {
  /** `$.session.id()`: undefined where the host can't say, and then nothing is kept. */
  id: string | undefined
  defaults: FlowConfig
  own: Own
  /** Why this process's last session ended (`clear`, `resume`), until the next one's id shows. */
  ended: string | undefined
  /** Reads of the id left at the quick pace, after a session ended with the process going on. */
  watch: number
  /** A move to another session under way (one at a time). */
  moving?: Promise<boolean>
}

/** The session's id, or undefined where the host can't say. */
async function sessionId($: EngineInterface): Promise<string | undefined> {
  try {
    const id = await $.session.id()
    return typeof id === 'string' && id ? id : undefined
  } catch {
    return undefined
  }
}

async function loadRecord($: EngineInterface, id: string): Promise<SessionRecord | undefined> {
  try {
    return readRecord(await $.store.get(sessionKey(id)))
  } catch {
    return undefined
  }
}

/**
 * Keep the session's own settings under its id, marked used now (none: its
 * record goes, and it follows the defaults); answers whether it kept them.
 * Each session writes only its own key, so two sessions never race on one.
 */
async function keepOwn($: EngineInterface, s: Pick<Session, 'id' | 'own'>): Promise<boolean> {
  if (!s.id) return false
  try {
    if (Object.keys(s.own).length) await $.store.set(sessionKey(s.id), storedRecord(s.own, await $.clock.now()))
    else await $.store.delete(sessionKey(s.id))
    return true
  } catch {
    return false
  }
}

/** Forget the sessions unused longest, past those kept (sessions.ts: staleSessions); never this one. */
async function pruneSessions($: EngineInterface, keep: string | undefined): Promise<void> {
  try {
    const keys = (await $.store.keys()).filter(k => k.startsWith(SESSION_PREFIX))
    if (!keys.length) return
    const now = await $.clock.now()
    const records = await Promise.all(keys.map(async key => ({ key, at: readRecord(await $.store.get(key))?.at ?? 0 })))
    for (const key of staleSessions(records, now, keep === undefined ? undefined : sessionKey(keep))) await $.store.delete(key)
  } catch {
    // Pruned next time.
  }
}

/**
 * Whether the spine's pane is up (a pane outlives a reload of the module).
 * Where the host can't say (no panes there), none is: this check must never
 * cost `session.start` the frame loop, the clock or the subagent polling.
 */
async function spineIsUp($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === SPINE)
  } catch {
    return false
  }
}

/** What `/flow` needs of the loaded module. */
type SceneCtx = {
  driver: SceneDriver
  session: Session
  /** Apply a change here at once (the caller invalidates). */
  applyLocal: (changes: Partial<FlowConfig>) => void
  /** The scene no longer draws in the spine. */
  leftSpine: () => void
}

/**
 * Put the spine's pane where the settings now want it, `layout` being a
 * layout just asked for (or moved to): answers a note for the reply.
 */
async function placeScene($: EngineInterface, ctx: SceneCtx, layout: FlowLayout | undefined): Promise<string> {
  const { driver } = ctx
  if (layout === 'band') {
    ctx.leftSpine()
    await $.ui.close({ id: SPINE })
    return ''
  }
  if (driver.cfg.layout !== 'spine') return ''
  // The pane shows while the scene does, as the band does: off (or dark idle) closes it, back on opens it.
  // Asked for, it's placed at any width: docked in fullscreen, else inline.
  const shown = driver.isShown()
  if (shown && (layout === 'spine' || !(await spineIsUp($)))) {
    const opened = await $.ui.open({ id: SPINE, title: 'flow', columns: SPINE_COLUMNS, rows: SPINE_INLINE_ROWS })
    return opened.isPlaced ? '' : '  (no room for the pane yet: widen the terminal)'
  }
  if (!shown && (await spineIsUp($))) {
    ctx.leftSpine()
    await $.ui.close({ id: SPINE })
  }
  return ''
}

/** Show these settings in the session at once, the pane following its layout. */
async function showSettings($: EngineInterface, ctx: SceneCtx, cfg: FlowConfig): Promise<void> {
  const layout = ctx.driver.cfg.layout
  ctx.applyLocal(cfg)
  $.ui.invalidate('ui.render')
  if (cfg.layout !== layout) await placeScene($, ctx, cfg.layout)
}

/**
 * Follow the session's id: a /clear, a resume from inside the session or a
 * fork moves it on under this load, with no `session.start`. The session it
 * moved to shows its own settings (sessions.ts: ownAfterSwitch). Answers
 * whether it moved; one move at a time.
 */
function followSession($: EngineInterface, ctx: SceneCtx): Promise<boolean> {
  const s = ctx.session
  s.moving ??= moveSession($, ctx).finally(() => {
    s.moving = undefined
  })
  return s.moving
}

async function moveSession($: EngineInterface, ctx: SceneCtx): Promise<boolean> {
  const s = ctx.session
  const id = await sessionId($)
  if (!id || id === s.id) {
    if (s.watch > 0) s.watch--
    return false
  }
  const record = await loadRecord($, id)
  const { own, carried } = ownAfterSwitch(record, s.own, s.ended)
  s.id = id
  s.own = own
  s.ended = undefined
  s.watch = 0
  // Kept under the new id: its own (marked used), or what a /clear carried on.
  if (record || carried) await keepOwn($, s)
  await showSettings($, ctx, withOwn(s.defaults, own))
  return true
}

/**
 * `/flow save`: the session's settings become the /config rows, the default
 * new sessions start with. Written first and forgotten from the session's own
 * after: a reload the write may cause finds them in one or the other.
 */
async function saveDefault($: EngineInterface, ctx: SceneCtx): Promise<string> {
  const s = ctx.session
  const cfg = ctx.driver.cfg
  const before = { ...s.defaults }
  const changes = differences(cfg, s.defaults)
  const refused = Object.keys(changes).length ? await saveConfig($, changes) : []
  for (const k of Object.keys(changes) as (keyof FlowConfig)[]) {
    if (!refused.includes(k)) (s.defaults as Record<string, unknown>)[k] = cfg[k]
  }
  // What's still its own: what /config refused (the rest is the default now).
  const own: Own = {}
  for (const k of refused) (own as Record<string, unknown>)[k] = cfg[k]
  s.own = own
  await keepOwn($, s)
  return savedText(cfg, before, refused.length < Object.keys(changes).length, refused)
}

/** `/flow reset`: the session back on the default. */
async function resetSession($: EngineInterface, ctx: SceneCtx): Promise<string> {
  const s = ctx.session
  const before = { ...ctx.driver.cfg }
  s.own = {}
  const note = (await keepOwn($, s)) || !s.id ? '' : '  (not saved)'
  await showSettings($, ctx, s.defaults)
  return `${resetText(before, s.defaults)}${note}`
}

const TIPS = 'tips'

/** A chance for a one-time tip (see nextTip), the store keeping which have been given: the tip, if one's due. */
async function takeTip($: EngineInterface, cfg: FlowConfig): Promise<string | undefined> {
  try {
    const before = readTips(await $.store.get(TIPS))
    const { tip, tips } = nextTip(before, cfg)
    if (JSON.stringify(tips) !== JSON.stringify(before)) await $.store.set(TIPS, tips)
    return tip
  } catch {
    return undefined
  }
}

/** `/flow`: show, help, or apply a change, keep it, and answer. */
async function runScene($: EngineInterface, e: CommandRunInput, ctx: SceneCtx): Promise<CommandRunResult> {
  const reply = await sceneReply($, e, ctx)
  // A one-time tip goes under the reply (the other scenes, or the sound).
  const tip = await takeTip($, ctx.driver.cfg)
  return tip ? { ...reply, text: `${reply.text ?? ''}\n\n${tip}` } : reply
}

async function sceneReply($: EngineInterface, e: CommandRunInput, ctx: SceneCtx): Promise<CommandRunResult> {
  const { driver, session } = ctx
  const cfg = driver.cfg
  // (A /clear or a resume since the last look: the session it is now.)
  await followSession($, ctx)
  const cmd = parseFlowArgs(e.args)
  if (cmd.kind === 'show') return { text: statusText(cfg, driver.level(), driver.tint(), driver.clock, session.defaults) }
  if (cmd.kind === 'help') return { text: helpText() }
  if (cmd.kind === 'error') return { text: cmd.text }
  if (cmd.kind === 'save') return { text: await saveDefault($, ctx) }
  if (cmd.kind === 'reset') return { text: await resetSession($, ctx) }
  const changes = changesFor(cmd, cfg) ?? {}
  const before = { ...cfg }
  $.ui.invalidate('ui.render')
  ctx.applyLocal(changes) // the scene carries on: 6 → 8 eases up from 6
  // This session's alone, kept under its id.
  session.own = { ...session.own, ...changes }
  let note = (await keepOwn($, session)) ? '' : '  (not saved)'
  note += await placeScene($, ctx, changes.layout)
  return { text: `${changedText(cmd, cfg, "Claude's", driver.clock)}${note}${ownHint(before, cfg, session.defaults)}` }
}

export const register: Register = (on, options) => {
  // The defaults arrive as `options` (a /config change reloads the module);
  // the session's own settings sit over them (read at `session.start`).
  // Module-level on purpose: the scenes and the activity are cosmetic, so a
  // reload simply relights them.
  const activity = new Activity()
  const driver = new SceneDriver(readConfig(options), activity)
  const cfg = driver.cfg
  const session: Session = { id: undefined, defaults: readConfig(options), own: {}, ended: undefined, watch: 0 }
  /**
   * Desktop's own scenes, on the same settings: a session open in the
   * terminal and on desktop at once draws each at its own size, and resizing
   * one shared scene back and forth every frame would rebuild it every frame.
   */
  const desktopDriver = new SceneDriver(cfg, activity)
  /** Where the scene is drawn now (band or spine). Other surfaces never touch it. */
  let mounted: { requestId: string; columns: number; rows: number } | null = null
  let ticks = 0
  /** A subagent's step or tool call arrived: count the running ones at the next poll. */
  let subagentSeen = false
  /**
   * The soundscape: the clips playing (each stoppable), its own clock (ms),
   * each bed layer's take (`bedStep` keeps them) and their players by id,
   * when the next burst of events is due, and the events gathered since the last.
   */
  const sound = {
    playing: new Set<AbortController>(),
    clock: 0,
    bed: [] as (BedTake | undefined)[],
    takes: new Map<number, AbortController>(),
    nextBurst: 0,
    lastBurst: 0,
    queue: [] as (SoundEvent & { at: number })[],
    /** How many events the window has seen (more than the queue holds when it's busy). */
    seen: 0,
    /** When each kind of event with a clip of its own may play next (a closer one waits till then). */
    nextOf: new Map<string, number>(),
    /** Bumped whenever the soundscape stops (a new scene, sound off, hidden): what was scheduled before is stale. */
    gen: 0,
    /** The event clips playing, oldest first (the first to give way when the player is full). */
    events: [] as AbortController[],
    seed: 1,
    scene: '',
  }
  /**
   * Whether what was scheduled in generation `gen` may still play: the soundscape hasn't stopped since, and
   * no change waits for the next frame to stop it (another scene picked, the sound turned off).
   */
  const current = (gen: number) => sound.gen === gen && cfg.sound === 'on' && cfg.style === sound.scene
  const stopSound = () => {
    // (A new generation: a delayed event or retry from the soundscape stopped here never plays.)
    sound.gen++
    for (const c of sound.playing) c.abort()
    sound.playing.clear()
    sound.takes.clear()
    sound.events.length = 0
    sound.bed = []
    sound.queue.length = 0
    sound.seen = 0
    sound.scene = ''
  }
  /** The tick a blit went out on, -1 when none is in flight. */
  let blitAt = -1
  let lastCells = ''
  /**
   * The desktop sites drawing the scene (band, spine), their size in cells
   * and the tick each last rendered: the newest steps it. A desktop window
   * closing sends nothing, so a site that stops rendering though it's asked
   * to every frame is forgotten (it comes back if it renders again).
   */
  const desktopSites = new Map<string, { columns: number; rows: number; at: number }>()
  const desktopSite = () => {
    for (const [id, site] of desktopSites) if (ticks - site.at > DESKTOP_STALE_TICKS) desktopSites.delete(id)
    return [...desktopSites.values()].at(-1)
  }
  /** A desktop site's frame: the scene at its size, as one Svg sized to its cells. */
  const desktopSvg = (requestId: string, columns: number, rows: number) => {
    desktopSites.delete(requestId) // re-added last: the newest site steps the scene
    desktopSites.set(requestId, { columns, rows, at: ticks })
    const scene = desktopDriver.dial()
    scene.ensure(columns, rows)
    return {
      source: frameSvg(scene.grid()),
      alt: `flow: ${cfg.style}`,
      width: columns * DESKTOP_CELL_W,
      height: rows * DESKTOP_CELL_H,
    }
  }

  /** Apply a change here at once and redraw from scratch (the caller invalidates). */
  const applyLocal = (changes: Partial<FlowConfig>) => {
    driver.apply(changes)
    lastCells = ''
  }
  const setClock = (ms: number) => {
    const d = new Date(ms)
    driver.clock = desktopDriver.clock = { hour: d.getHours(), minute: d.getMinutes() }
  }
  /** What `/flow` (and following the session) needs of this load. */
  const sceneCtx: SceneCtx = {
    driver,
    session,
    applyLocal,
    leftSpine: () => {
      if (mounted?.requestId === SPINE) mounted = null
      desktopSites.delete(SPINE)
    },
  }

  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    setClock(now)
    const at = new Date(now)
    $.ui.log(
      `[flow] REVISION: ${FLOW_REVISION} loaded at ${at.toISOString()} (local ${at.getHours()}:${at.getMinutes()}, UTC offset ${-at.getTimezoneOffset()} min)`,
      { to: 'debug' },
    )
    await $.command.register({
      name: COMMAND,
      description: 'An ambient scene that moves with the work: fire, surf, ski, rockets and more',
      argumentHint: '[<scene> | next | day | night | clock | auto | 1-10 | off | band | spine | save | reset | help]',
    })

    // One-time move of settings kept in $.store before they were userConfig.
    const legacy: Partial<FlowConfig> = {}
    const old = Object.fromEntries(await Promise.all(LEGACY_KEYS.map(async k => [k, await $.store.get(k)] as const)))
    if (old.mode === 'auto' || old.mode === 'manual') legacy.mode = old.mode
    const oldStyle = typeof old.style === 'string' ? styleNamed(old.style) : undefined
    if (oldStyle) legacy.style = oldStyle
    if (old.idle === 0 || old.idle === 1) legacy.idle = old.idle
    if (typeof old.strength === 'number' && Number.isInteger(old.strength) && old.strength >= 0 && old.strength <= 10) {
      legacy.level = old.strength
    }
    if (LEGACY_KEYS.some(k => old[k] !== undefined)) {
      for (const k of LEGACY_KEYS) await $.store.delete(k)
      await saveConfig($, legacy)
    }

    // `/flow` changes from before sessions kept their own, still pending:
    // written through to /config once, the defaults now (as are the legacy
    // ones), ahead of the reload the write brings.
    const pending = await migrateOverrides($)
    session.defaults = { ...session.defaults, ...legacy, ...pending }

    // This session's own settings over the defaults: kept under its id, so a
    // reload (a /config change, an update) or a resume brings them back. A
    // new session has none, and starts on the defaults.
    session.id = await sessionId($)
    session.ended = undefined
    session.watch = 0
    const record = session.id === undefined ? undefined : await loadRecord($, session.id)
    session.own = record?.own ?? {}
    if (record) await keepOwn($, session) // (marked used: the sessions used last are the ones kept)
    applyLocal(withOwn(session.defaults, session.own))
    $.ui.invalidate('ui.render')
    void pruneSessions($, session.id)

    // Resume the balloon where the last load left it.
    const altitude = await savedAltitude($)
    for (const d of [driver, desktopDriver]) {
      const balloon = d.sceneFor('balloon')
      if (balloon instanceof Balloon) balloon.seed(altitude)
    }

    // A one-time tip, the settings now in: the other scenes, or the sound.
    if (e.isInteractive) {
      const tip = await takeTip($, cfg)
      if (tip) $.ui.toast(tip, { timeoutMs: 12_000 })
    }

    // The frame loop: its own pace, rescheduled each tick.
    let wasShown = driver.isShown()
    let keptAltitude = -1
    const frame = (elapsed: number): number => {
      ticks++
      activity.tick(elapsed / FRAME_MS)
      const site = mounted
      const desk = desktopSite()
      // The soundscape, while the scene is on screen: beds crossfading one
      // into the next, and what happens on screen heard as it happens.
      sound.clock += elapsed
      const heard = cfg.sound === 'on' && (site || desk) && driver.isShown()
      const shownScene = site ? driver.scene : desk ? desktopDriver.scene : undefined
      const events: SoundEvent[] = []
      for (const sc of [driver.scene, desktopDriver.scene]) {
        if (!sc.sounds) continue
        if (heard && sc === shownScene) events.push(...sc.sounds)
        sc.sounds.length = 0
      }
      if (!heard || !shownScene) {
        if (sound.scene) stopSound()
      } else {
        // A clip: one of the plugin's own (`asset`) or synthesized here (base64 WAV). Claude Code plays at
        // most MAX_PLAYS at once for a plugin: a clip finding them all going stops the oldest event clip
        // (`take` undefined) first (a tail cut beats a strike unheard, or the bed dropping out); a refused
        // one tries again a moment on.
        const play = (clip: { asset: string } | { base64: string; mime: string }, gain = 1, take?: number, tries = 0): void => {
          const event = take === undefined
          if (tries === 0 && sound.playing.size >= MAX_PLAYS) sound.events.shift()?.abort()
          const stop = new AbortController()
          sound.playing.add(stop)
          if (event) sound.events.push(stop)
          else sound.takes.set(take, stop)
          // No player (a Linux or Windows terminal), or refused for good: just silence. Refused because the
          // player's full, it tries again a moment on: unless the soundscape has stopped since, or (a bed's
          // take) the planner has stopped that take (it took its entry out of `takes`).
          const gen = sound.gen
          let retrying = false
          void $.audio
            .play(clip, { gain: Math.min(4, SOUND_GAIN * gain), signal: stop.signal })
            .catch((err: unknown) => {
              if (!String(err).includes('at once') || tries >= 4 || stop.signal.aborted) return
              retrying = true
              $.clock.after(50, () => {
                if (!current(gen) || (take !== undefined && sound.takes.get(take) !== stop)) return
                play(clip, gain, take, tries + 1)
              })
            })
            .finally(() => {
              sound.playing.delete(stop)
              const i = sound.events.indexOf(stop)
              if (i >= 0) sound.events.splice(i, 1)
              if (!retrying && take !== undefined && sound.takes.get(take) === stop) sound.takes.delete(take)
            })
        }
        const playWav = (wav: string | undefined, gain = 1) => wav && play({ base64: wav, mime: 'audio/wav' }, gain)
        // Events with a clip of their own play now; the rest gather into a burst.
        for (const e of events) {
          const p = eventPlay(e, sound.seed++, cfg.style, shownScene.strength)
          if (!p) {
            // (Somewhere since the last frame, at random: a frame's pops all at once would buzz at the frame rate.)
            const at = sound.clock - Math.min(elapsed, 150) * unit(sound.seed++)
            gather(sound.queue, sound.seen++, { ...e, at }, sound.seed++)
            continue
          }
          // Each is heard, however close: one of a kind at most every SOUND_STAGGER_MS, a close one put back
          // a moment (two rocks striking together are two booms; any nearer, the ear hears one).
          const at = Math.max(sound.clock, sound.nextOf.get(e.kind) ?? 0)
          if (at - sound.clock > 4 * SOUND_STAGGER_MS) continue
          sound.nextOf.set(e.kind, at + SOUND_STAGGER_MS)
          if (at === sound.clock) play({ asset: p.asset }, p.gain)
          else {
            const gen = sound.gen
            $.clock.after(at - sound.clock, () => current(gen) && play({ asset: p.asset }, p.gain))
          }
        }
        // (A rocket acts its level out a stage at a time: its own strength is the one to hear.)
        const level = shownScene.strength
        if (cfg.style !== sound.scene) {
          stopSound()
          sound.scene = cfg.style
        }
        const mood = { scene: cfg.style, level, tint: driver.tint(), night: driver.isNight(), amb: shownScene.ambience?.() ?? {} }
        const beds = bedStep(sound.bed, mood, sound.clock, sound.seed++)
        for (const id of beds.stop) {
          sound.takes.get(id)?.abort()
          sound.takes.delete(id)
        }
        for (const p of beds.play) play({ asset: p.asset }, p.gain, p.id)
        if (sound.clock >= sound.nextBurst) {
          // Each event at its moment in the window since the last burst.
          const from = Math.max(sound.lastBurst, sound.clock - 2 * SOUND_BURST_MS)
          sound.lastBurst = sound.clock
          sound.nextBurst = sound.clock + SOUND_BURST_MS
          if (sound.queue.length) {
            playWav(burst(sound.queue.map(e => ({ ...e, offset: Math.max(0, (e.at - from) / 1000) })), sound.seed++), master(cfg.style, shownScene.strength))
            sound.queue.length = 0
            sound.seen = 0
          }
        }
      }
      // Every second or so, note the balloon's altitude if it moved, so a
      // /config change made from the menu (a reload) resumes it too.
      const b = (site || !desk ? driver : desktopDriver).sceneFor('balloon')
      if (ticks % 15 === 0 && b instanceof Balloon && Math.abs(b.altitude - keptAltitude) > 0.5) {
        keptAltitude = b.altitude
        void keepAltitude($, b.altitude)
      }
      // Auto + dark idle: mount the band when work starts, drop it once the
      // scene has wound down, so an idle session gives the rows back.
      const shown = driver.isShown()
      if (shown !== wasShown) {
        wasShown = shown
        $.ui.invalidate('ui.render')
        // The spine's pane, likewise: up while the scene shows, closed (unasked: a plugin's close) when not.
        if (cfg.layout === 'spine') {
          if (shown) void $.ui.open({ id: SPINE, title: 'flow', columns: SPINE_COLUMNS, rows: SPINE_INLINE_ROWS }).catch(() => {})
          else {
            if (mounted?.requestId === SPINE) mounted = null
            desktopSites.delete(SPINE)
            void $.ui.close({ id: SPINE }).catch(() => {})
          }
        }
      }
      if (desk) {
        // Desktop steps its own scene here and redraws its Svg.
        const scene = desktopDriver.dial()
        scene.ensure(desk.columns, desk.rows)
        scene.step()
        $.ui.invalidate('ui.render')
        if (!site) return Math.max(DESKTOP_MS, desktopDriver.pace())
      }
      if (!site) return HIDDEN_MS
      const scene = driver.dial()
      const pace = driver.pace()
      if (blitAt >= 0 && ticks - blitAt < BLIT_STALE_TICKS) return pace
      scene.ensure(site.columns, site.rows)
      scene.step()
      const cells = scene.frame()
      if (cells === lastCells) return pace
      lastCells = cells
      const at = ticks
      blitAt = at
      void $.ui.blit({ requestId: site.requestId, key: KEY, cells }).finally(() => {
        if (blitAt === at) blitAt = -1
      })
      return pace
    }
    const loop = (ms: number) => {
      $.clock.after(ms, () => loop(frame(ms)))
    }
    loop(FRAME_MS)

    // The pane outlives a reload: one left up from a spine layout that /config
    // has since changed to the band would otherwise draw beside it.
    if (cfg.layout === 'spine' && driver.isShown()) {
      // Unasked, a pane docks only from 144 columns; below that it waits.
      void $.ui.open({ id: SPINE, title: 'flow', columns: SPINE_COLUMNS, rows: SPINE_INLINE_ROWS })
    } else if (await spineIsUp($)) {
      await $.ui.close({ id: SPINE })
    }

    // Day and night by the local clock: read it every minute.
    const readClock = () => {
      $.clock.after(CLOCK_POLL_MS, () => {
        $.clock.now().then(setClock, () => {})
        readClock()
      })
    }
    readClock()

    // Subagents: always polled (never gated on what this load remembers: a
    // reload mid-run starts from nothing), every second while anything works,
    // every 5 s otherwise, and at once when a subagent's activity shows up.
    let lastPoll = 0
    const countAgents = () => {
      $.agent.list().then(
        agents => {
          activity.runningAgents = agents.filter(a => a.status === 'running' && a.type !== 'teammate').length
        },
        () => {
          activity.runningAgents = 0
        },
      )
    }
    countAgents()
    // The session's id, on the same clock: every 5 s, and every second for a
    // while after a session ends with the process going on (a /clear, a resume).
    let lastIdRead = 0
    const pollAgents = () => {
      $.clock.after(AGENT_POLL_MS, () => {
        lastPoll += AGENT_POLL_MS
        lastIdRead += AGENT_POLL_MS
        const busy = activity.isWorking || subagentSeen
        if (busy || lastPoll >= AGENT_IDLE_POLL_MS) {
          lastPoll = 0
          subagentSeen = false
          countAgents()
        }
        if (session.watch > 0 || lastIdRead >= SESSION_POLL_MS) {
          lastIdRead = 0
          followSession($, sceneCtx).catch(() => {})
        }
        pollAgents()
      })
    }
    pollAgents()

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    activity.turnStarted() // raised by the main loop only
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    // Subagents' runs complete too; only the main loop's ends the turn.
    if (e.agentId === undefined) activity.turnEnded()
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const isSubagent = e.agentId !== undefined
    if (isSubagent) subagentSeen = true
    activity.modelStep(e.effort, isSubagent)
    for await (const chunk of next(e)) {
      if (chunk.kind === 'text' || chunk.kind === 'thinking') activity.streamed(chunk.text.length, chunk.kind, isSubagent)
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    const isSubagent = e.agentId !== undefined
    if (isSubagent) subagentSeen = true
    const lines = linesWritten(e.tool, e)
    if (lines !== undefined) activity.edited(lines, isSubagent)
    else if (e.tool === 'Bash') activity.ranCommand(isSubagent)
    else if (e.tool === 'Agent') activity.spawnedAgent()
    else if (READ_TOOLS.has(e.tool)) activity.read(isSubagent)

    activity.toolsInFlight++
    const id = e.tool_use_id
    if (id && PERSON_TOOLS.has(e.tool)) activity.waitingOn(id)
    try {
      const result = await next(e)
      if (e.tool === 'Bash' && 'isError' in result && result.isError) activity.failed()
      return result
    } finally {
      activity.toolsInFlight--
      // (Answered, or over: a permission ask from tool.check ends here too.)
      if (id) activity.answered(id)
    }
  })

  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    // An ask is put to the person (in the default mode; auto's classifier decides alone): the turn's clock
    // waits until the call is over. (There's no word of when they answer, so a command they approve runs
    // uncounted too: it errs on the side of a lower level, never a higher one.)
    if (verdict.decision === 'ask' && e.tool_use_id) activity.waitingOn(e.tool_use_id)
    return verdict
  })

  on('session.compact', async ($, e, next) => {
    // `precompute` installs nothing, and a skipped compaction kept everything.
    if (e.trigger === 'precompute') return next(e)
    const result = await next(e)
    if (!('skip' in result && result.skip)) activity.compacted()
    return result
  })

  on('session.measure', ($, e, next) => {
    if (e.context.percent !== undefined) activity.contextPercent = e.context.percent
    return next(e)
  })


  on('command.run', { command: COMMAND }, ($, e) => runScene($, e, sceneCtx))

  on('session.end', async ($, e, next) => {
    // The soundscape stops with the session. Its settings were kept as they
    // changed: nothing is written to /config (only `/flow save` does that).
    stopSound()
    // A /clear or a resume from inside the session: the process goes on
    // under another id, with no `session.start`, so watch for it.
    if (e.reason === 'clear' || e.reason === 'resume') {
      session.ended = e.reason
      session.watch = SESSION_WATCH_CHECKS
    }
    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const field = e.key.startsWith(`${PLUGIN}.`) ? (e.key.slice(PLUGIN.length + 1) as keyof FlowConfig) : undefined
    if (!field || !(field in cfg) || e.origin.kind === 'plugin') return next(e)
    // A change made in /config (the menu, or `/config key=value` from here or
    // over Remote Control) is a default, and this session's too: it no longer
    // keeps that row's own value, gone before the write (and the reload it
    // brings, which reads what is kept)...
    const had = session.own[field]
    if (had !== undefined) {
      delete session.own[field]
      await keepOwn($, session)
    }
    const result = await next(e)
    if (result.deny !== undefined) {
      if (had !== undefined) {
        ;(session.own as Record<string, unknown>)[field] = had
        await keepOwn($, session)
      }
      return result
    }
    // ...and shows at once, even when it picks the value the row already
    // held (no options change, so no reload).
    const value = readConfig({ [field]: result.value })[field]
    session.defaults = { ...session.defaults, [field]: value }
    applyLocal({ [field]: value })
    $.ui.invalidate('ui.render')
    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id !== SPINE) return next(e)
    if (mounted?.requestId === SPINE) mounted = null
    desktopSites.delete(SPINE)
    // Closing the spine yourself means you'd rather have the band (in this session).
    if (e.origin.kind === 'person' && cfg.layout === 'spine') {
      applyLocal({ layout: 'band' })
      $.ui.invalidate('ui.render')
      session.own = { ...session.own, layout: 'band' }
      await keepOwn($, session)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: SPINE }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (cfg.layout !== 'spine') {
      if (mounted?.requestId === e.requestId) mounted = null
      desktopSites.delete(e.requestId)
      return <Text dimColor>Flow is in the band above the prompt: `/flow spine` brings it here.</Text>
    }
    if (e.surface === 'desktop') {
      const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
      const rows = Math.max(2, Math.min(256, e.props.scroll.bodyRows))
      const { Svg } = $.ui.resolve(e)
      return <Svg {...desktopSvg(e.requestId, columns, rows)} />
    }
    if (e.surface !== 'terminal') return <Text dimColor>The scene draws in the terminal and on desktop.</Text>
    // The scene fills the whole pane, whatever width the dock gave it.
    const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
    const rows = Math.max(2, Math.min(256, e.props.scroll.bodyRows))
    mounted = { requestId: e.requestId, columns, rows }
    const scene = driver.dial()
    scene.ensure(columns, rows)
    lastCells = scene.frame()
    const { Raster } = $.ui.resolve(e)
    return <Raster key={KEY} columns={columns} rows={rows} cells={lastCells} />
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const rows = Math.min(MAX_ROWS, e.props.maxRows - 1)
    const hidden = cfg.layout === 'spine' || e.props.hasSurvey || !driver.isShown() || rows < 2
    if (e.surface === 'desktop') {
      // No Raster here: the frame is one Svg, redrawn by the frame loop.
      if (hidden) {
        desktopSites.delete(e.requestId)
        return next(e)
      }
      const { Svg } = $.ui.resolve(e)
      return <Svg {...desktopSvg(e.requestId, Math.max(1, Math.min(512, e.props.bodyColumns)), rows)} />
    }
    // Raster is terminal-only; any other surface's band never touches ours.
    if (e.surface !== 'terminal') return next(e)
    if (hidden) {
      if (mounted?.requestId === e.requestId) mounted = null
      return next(e)
    }
    const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
    mounted = { requestId: e.requestId, columns, rows }
    const scene = driver.dial()
    scene.ensure(columns, rows)
    lastCells = scene.frame()

    // The engine keeps one blank spacer row between the band and the prompt;
    // it is outside the band, so the scene's base sits one row above the input.
    const { Raster } = $.ui.resolve(e)
    return <Raster key={KEY} columns={columns} rows={rows} cells={lastCells} />
  })
}
