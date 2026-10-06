// REVISION: flow-v118-spine-hides
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
// Settings are `userConfig` rows in /config (mode, style, idle, level,
// layout, time); `/flow` is the shortcut. A /config change reloads the
// module, which would restart the scene, so `/flow` keeps its changes in
// the store (applied at once, no reload) and writes them through to /config
// when the session ends. A change made in /config wins. `/flow help` lists
// the command's forms (see settings.ts).

import { atom, update } from 'claude-code'
import type { CommandRunInput, CommandRunResult, EngineInterface, Register } from 'claude-code'

import { Balloon } from './balloon'
import { Activity, linesWritten } from './activity'
import { FRAME_MS, SceneDriver } from './scene'
import { changedText, changesFor, helpText, parseFlowArgs, readConfig, statusText, storedValue, type FlowConfig, nextTip, readTips } from './settings'
import { styleNamed } from './styles'
import { frameSvg } from './svg'
import { type BedTake, bedStep, burst, gather, MAX_PLAYS, unit, eventPlay, master, type SoundEvent } from './sound'


const FLOW_REVISION = 'flow-v110-no-rhythms'
const PLUGIN = 'flow'
const KEY = 'flow'
/** The command. */
const COMMAND = 'flow'
/** How often the local clock is read, for day and night. */
const CLOCK_POLL_MS = 60_000
const HIDDEN_MS = 350 // off screen: only the activity keeps cooling
const AGENT_POLL_MS = 1000 // while anything is working
const AGENT_IDLE_POLL_MS = 5000 // otherwise: subagents can run on after a turn, or a reload
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
 * Where `/flow` keeps its changes until a session ends (no reload). The
 * store is shared by every session, so each write merges into what is there
 * rather than replacing it: two sessions' changes both survive.
 */
const OVERRIDES = 'overrides'

/** Stored overrides, validated: only fields that read back as themselves survive. */
function validOverrides(raw: unknown): Partial<FlowConfig> {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const full = readConfig(o)
  const out: Partial<FlowConfig> = {}
  for (const k of Object.keys(full) as (keyof FlowConfig)[]) {
    // A scene under an old name (`colony`, now `avalon`) is still that scene.
    const same = k === 'style' && typeof o[k] === 'string' && styleNamed(o[k] as string) === full[k]
    if (o[k] !== undefined && (same || storedValue(k, full[k]) === o[k])) (out as Record<string, unknown>)[k] = full[k]
  }
  return out
}

/** The overrides as stored: each field spelled as its /config row spells it. */
function storedOverrides(o: Partial<FlowConfig>): Record<string, string | number> {
  return Object.fromEntries((Object.keys(o) as (keyof FlowConfig)[]).map(k => [k, storedValue(k, o[k]!)]))
}

async function pendingOverrides($: EngineInterface): Promise<Partial<FlowConfig>> {
  return validOverrides(await $.store.get(OVERRIDES))
}

/** Merge changes into the stored overrides (`drop` removes fields); answers whether it saved. */
export async function keepOverrides(
  $: EngineInterface,
  changes: Partial<FlowConfig>,
  drop: readonly (keyof FlowConfig)[] = [],
): Promise<boolean> {
  try {
    const merged: Partial<FlowConfig> = { ...(await pendingOverrides($)), ...changes }
    for (const k of drop) delete merged[k]
    if (Object.keys(merged).length) await $.store.set(OVERRIDES, storedOverrides(merged))
    else await $.store.delete(OVERRIDES)
    return true
  } catch {
    return false
  }
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
 * Write the pending overrides through to /config, then forget the ones that
 * made it. Only those still holding the value written: another session may
 * have changed one meanwhile, and that newer change stays pending.
 */
export async function writeThrough($: EngineInterface): Promise<void> {
  const pending = await pendingOverrides($)
  if (!Object.keys(pending).length) return
  const refused = await saveConfig($, pending)
  try {
    const now = await pendingOverrides($)
    for (const k of Object.keys(pending) as (keyof FlowConfig)[]) {
      if (!refused.includes(k) && now[k] === pending[k]) delete now[k]
    }
    if (Object.keys(now).length) await $.store.set(OVERRIDES, storedOverrides(now))
    else await $.store.delete(OVERRIDES)
  } catch {
    // Still pending in the store: the next session writes them again.
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
  /** Apply a change here at once (the caller invalidates). */
  applyLocal: (changes: Partial<FlowConfig>) => void
  /** The scene no longer draws in the spine. */
  leftSpine: () => void
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
  const { driver } = ctx
  const cfg = driver.cfg
  const cmd = parseFlowArgs(e.args)
  if (cmd.kind === 'show') return { text: statusText(cfg, driver.level(), driver.tint(), driver.clock) }
  if (cmd.kind === 'help') return { text: helpText() }
  if (cmd.kind === 'error') return { text: cmd.text }
  const changes = changesFor(cmd, cfg) ?? {}
  $.ui.invalidate('ui.render')
  ctx.applyLocal(changes) // the scene carries on: 6 → 8 eases up from 6
  let note = (await keepOverrides($, changes)) ? '' : '  (not saved)'
  if (changes.layout === 'band') {
    ctx.leftSpine()
    await $.ui.close({ id: SPINE })
  } else if (cfg.layout === 'spine') {
    // The pane shows while the scene does, as the band does: off (or dark idle) closes it, back on opens it.
    // Asked for, it's placed at any width: docked in fullscreen, else inline.
    const shown = driver.isShown()
    if (shown && (changes.layout === 'spine' || !(await spineIsUp($)))) {
      const opened = await $.ui.open({ id: SPINE, title: 'flow', columns: SPINE_COLUMNS, rows: SPINE_INLINE_ROWS })
      if (!opened.isPlaced) note += '  (no room for the pane yet: widen the terminal)'
    } else if (!shown && (await spineIsUp($))) {
      ctx.leftSpine()
      await $.ui.close({ id: SPINE })
    }
  }
  return { text: `${changedText(cmd, cfg, "Claude's", driver.clock)}${note}` }
}

export const register: Register = (on, options) => {
  // The settings arrive as `options` (a /config change reloads the module);
  // `/flow` applies its change here at once too, in case no reload follows.
  // Module-level on purpose: the scenes and the activity are cosmetic, so a
  // reload simply relights them.
  const activity = new Activity()
  const driver = new SceneDriver(readConfig(options), activity)
  const cfg = driver.cfg
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
    /** The event clips playing, oldest first (the first to give way when the player is full). */
    events: [] as AbortController[],
    seed: 1,
    scene: '',
  }
  const stopSound = () => {
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
      argumentHint: '[<scene> | next | day | night | clock | auto | 1-10 | off | band | spine | help]',
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

    // /flow's changes not yet written through (this session's, or one that
    // ended without managing to) sit over the /config values.
    const pending = await pendingOverrides($)
    if (Object.keys(pending).length) {
      applyLocal(pending)
      $.ui.invalidate('ui.render')
    }

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
          // No player (a Linux or Windows terminal), or refused for good: just silence.
          void $.audio
            .play(clip, { gain: Math.min(4, SOUND_GAIN * gain), signal: stop.signal })
            .catch((err: unknown) => {
              if (String(err).includes('at once') && tries < 4 && !stop.signal.aborted)
                $.clock.after(50, () => sound.scene && play(clip, gain, take, tries + 1))
            })
            .finally(() => {
              sound.playing.delete(stop)
              const i = sound.events.indexOf(stop)
              if (i >= 0) sound.events.splice(i, 1)
              if (take !== undefined && sound.takes.get(take) === stop) sound.takes.delete(take)
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
          else $.clock.after(at - sound.clock, () => sound.scene && play({ asset: p.asset }, p.gain))
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
    const pollAgents = () => {
      $.clock.after(AGENT_POLL_MS, () => {
        lastPoll += AGENT_POLL_MS
        const busy = activity.isWorking || subagentSeen
        if (busy || lastPoll >= AGENT_IDLE_POLL_MS) {
          lastPoll = 0
          subagentSeen = false
          countAgents()
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
    try {
      const result = await next(e)
      if (e.tool === 'Bash' && 'isError' in result && result.isError) activity.failed()
      return result
    } finally {
      activity.toolsInFlight--
    }
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


  /** What `/flow` needs of this load. */
  const sceneCtx: SceneCtx = {
    driver,
    applyLocal,
    leftSpine: () => {
      if (mounted?.requestId === SPINE) mounted = null
      desktopSites.delete(SPINE)
    },
  }
  on('command.run', { command: COMMAND }, ($, e) => runScene($, e, sceneCtx))

  on('session.end', async ($, e, next) => {
    // The soundscape stops with the session.
    stopSound()
    // Bring the /config rows up to date (the reload this causes no longer
    // matters). Fields /config refuses, or that the end's short time bound
    // cuts off, stay in the store for the next session to apply.
    try {
      await writeThrough($)
    } catch {
      // Still pending in the store.
    }
    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const field = e.key.startsWith(`${PLUGIN}.`) ? (e.key.slice(PLUGIN.length + 1) as keyof FlowConfig) : undefined
    if (!field || !(field in cfg) || e.origin.kind === 'plugin') return next(e)
    // A change made in /config (the menu, or `/config key=value` from here or
    // over Remote Control) wins over /flow's pending one for that row...
    await keepOverrides($, {}, [field])
    const result = await next(e)
    // ...and shows at once, even when it picks the value the row already
    // held (no options change, so no reload).
    if (result.deny === undefined) {
      applyLocal({ [field]: readConfig({ [field]: result.value })[field] })
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id !== SPINE) return next(e)
    if (mounted?.requestId === SPINE) mounted = null
    desktopSites.delete(SPINE)
    // Closing the spine yourself means you'd rather have the band.
    if (e.origin.kind === 'person' && cfg.layout === 'spine') {
      applyLocal({ layout: 'band' })
      $.ui.invalidate('ui.render')
      await keepOverrides($, { layout: 'band' })
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
