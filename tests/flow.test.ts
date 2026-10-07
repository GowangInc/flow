// REVISION: flow-v125-stale-rows

import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { AsciiFire, colorFor, params } from '../hooks/fire'
import { effortFloor, Activity, linesWritten } from '../hooks/activity'
import { nextTip, readTips, changedText, changesFor, helpText, isNightAt, ownHint, parseFlowArgs, readConfig, resetText, savedText, staleRows, statusText } from '../hooks/settings'
import { differences, type Own, ownAfterSwitch, pinShown, readOwn, readRecord, SESSION_KEPT_MS, SESSIONS_KEPT, sessionKey, staleSessions, storedOwn, storedRecord, withOwn } from '../hooks/sessions'
import { gridToAnsi } from '../pi/ansi'
import { effortOf, ownInSession, piLinesWritten } from '../pi/mapping'
import { PiSettings, type SessionEntries } from '../pi/session'
import type { PiSessionEntry } from '../pi/types'
import { Balloon, skyColor } from '../hooks/balloon'
import { Falcon } from '../hooks/rocket'
import { Colony } from '../hooks/colony'
import { Train } from '../hooks/train'
import { makeScene, nextStyle, SCENES, STYLES, styleNamed } from '../hooks/styles'
import { migrateOverrides, openSession, runScene, type SceneCtx } from '../hooks/register'
import { coverage, frameSvg, gridPixels, SVG_LIMIT } from '../hooks/svg'
import { Cells, isTall } from '../hooks/cells'
import { SceneDriver } from '../hooks/scene'
import { BED_EVERY_MS, BED_FADE_MS, BED_MIN_MS, BED_MS, BURST_MAX, MAX_PLAYS, MOODS, PLAYER_DRAIN_MS, PLAYER_LEAD_MS, type BedTake, bedGap, bedPlays, bedStep, burst, EVENTS, eventPlay, gather, LAYERS } from '../hooks/sound'
import { SOUND_FILES } from '../hooks/sound-files'
import { PixelScene, type Dials, type Painter } from '../hooks/pixel-scene'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const DEFAULT = 0x01000000

function decode(cells: string): Uint32Array {
  const bin = atob(cells)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint32Array(bytes.buffer)
}

type Captured = {
  blits: string[]
  config: [string, unknown][]
  invalidates?: number
  plays?: string[]
  toasts?: string[]
  /** What `$.ui.log` was given, and where to. */
  logs?: { text: string; to?: string }[]
  /** The session's id, as `$.session.id()` answers it (change it to move the process to another session). */
  session?: string
  /**
   * /config's flow rows as stored (`flow.style`: 'surf'), shared by every
   * session: given, `$.config.list()` answers from them and a save writes
   * them; left out, it doesn't answer and the plugin goes by its options.
   */
  rows?: Record<string, unknown>
}

/** /config's flow rows as `$.config.list()` lists them: every one, the manifest's default where none is stored. */
function configRows(rows: Readonly<Record<string, unknown>>) {
  const all: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(storedOwn(readConfig(undefined)))) all[`flow.${k}`] = v
  return Object.entries({ ...all, ...rows }).map(([key, value]) => ({ key, value }))
}

/** Stand for the engine beneath the plugin: its band, session start, calls. */
function engine(
  on: On,
  captured: Captured = { blits: [], config: [] },
  /** Clips the player refuses as full (as Claude Code does past four at once). */
  refuse?: (asset: string) => boolean,
) {
  on('session.id', () => ({ value: (captured.session ??= 'session-a') }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('audio.play', (_, e) => {
    const clip = e.clip as { base64?: string; asset?: string }
    ;(captured.plays ??= []).push(`${e.shouldLoop ? 'loop' : 'once'}:${(clip.base64 ?? '').length}:${clip.asset ?? (clip.base64 ?? '').slice(-24)}`)
    if (clip.asset && refuse?.(clip.asset)) return { deny: 'refused: 4 plays are going at once' }
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' })
  })
  on('session.start', () => ({ cwd: '/tmp' }))
  on('ui.log', (_, e) => {
    ;(captured.logs ??= []).push({ text: e.text, to: e.to })
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    ;(captured.toasts ??= []).push((e as { text: string }).text)
    return { value: undefined }
  })
  on('ui.invalidate', () => {
    captured.invalidates = (captured.invalidates ?? 0) + 1
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'flow' } }))
  on('ui.blit', (_, e) => {
    captured.blits.push(e.requestId)
    return { value: {} }
  })
  on('config.set', (_, e) => {
    captured.config.push([e.key, e.value])
    if (captured.rows) captured.rows[e.key] = e.value
    return { value: e.value }
  })
  const rows = captured.rows
  if (rows) on('config.list', () => ({ value: configRows(rows) as never }))
  return captured
}

/**
 * `$.store` over a Map the test can look into, values kept as JSON keeps them
 * (as mock.store does): the store every session of the plugin shares.
 */
function memoryStore(on: On, entries: Readonly<Record<string, unknown>> = {}): Map<string, unknown> {
  const store = new Map<string, unknown>(Object.entries(entries).map(([k, v]) => [k, structuredClone(v)]))
  on('store.get', (_, e) => ({ value: structuredClone(store.get(e.key)) }))
  on('store.set', (_, e) => (store.set(e.key, JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  return store
}

type TestDollar = { session: { start: (a: { cwd: string; surface: 'terminal'; isInteractive: boolean }) => Promise<unknown> } }

async function start($: TestDollar) {
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

type RunInput = {
  command: string
  args: string
  origin: { kind: 'composer' }
  presentation: { isFullscreen: boolean; columns: number }
}

/** Run `/flow <args>` through the plugin as typed at the prompt, answering its text. */
async function flow($: { command: { run: (e: RunInput) => Promise<{ text?: string }> } }, args = '', command = 'flow') {
  const e: RunInput = { command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }
  return (await $.command.run(e)).text ?? ''
}

// ── The automaton ────────────────────────────────────────────────────────

test('the strength dial: off, pilots, roaring', async () => {
  expect(params(0)).toEqual([0, 0])
  expect(params(1)).toEqual([2, 10])
  expect(params(8)).toEqual([24, 100])
  expect(params(10)).toEqual([35, 100])
})

test('a lit fire packs flames into Raster cells; off draws nothing', async () => {
  // The simulation's heat: a hot base when lit, none at all when off.
  const sim = new AsciiFire(42)
  sim.ensure(40, 4)
  for (let i = 0; i < 20; i++) sim.step()
  expect(Math.max(...sim.cells.subarray(3 * 40))).toBeGreaterThan(sim.peak * 0.5)
  sim.strength = 0
  sim.step()
  expect(Math.max(...sim.cells)).toBe(0)

  // The fire scene draws it: ▓ or █ at the hot base, blank when off.
  const f = makeScene('fire', 42)
  f.ensure(40, 4)
  for (let i = 0; i < 20; i++) f.step()
  const words = decode(f.frame())
  expect(words.length).toBe(40 * 4 * 3)
  const glyphs = new Set<number>()
  for (let i = 0; i < words.length; i += 3) glyphs.add(words[i]!)
  expect(glyphs.has(0x2588) || glyphs.has(0x2593)).toBe(true) // hot base
  f.strength = 0
  for (let i = 0; i < 40; i++) f.step()
  const off = decode(f.frame())
  for (let i = 0; i < off.length; i += 3) expect(off[i]).toBe(0x20)
})

test('burners wander: lit columns change over time, density holds', async () => {
  const f = new AsciiFire(11)
  f.strength = 3 // 42% coverage
  f.ensure(200, 2)
  const litAt = () => {
    const row = f.cells.subarray(200)
    return new Set(Array.from(row.keys()).filter(x => row[x]! > 0))
  }
  for (let i = 0; i < 60; i++) f.step()
  const early = litAt()
  for (let i = 0; i < 300; i++) f.step() // ~21 s
  const late = litAt()
  expect([...early].filter(x => late.has(x)).length).toBeLessThan(early.size)
  expect(late.size).toBeGreaterThan(40)
  expect(late.size).toBeLessThan(130)
})

test('the headroom row stays mostly blank, licked by only the tallest flames', async () => {
  const topLit = (strength: number) => {
    const f = new AsciiFire(5)
    f.strength = strength
    f.ensure(100, 5)
    let lit = 0
    for (let i = 0; i < 200; i++) {
      f.step()
      if (i >= 50) lit += Array.from(f.cells.subarray(0, 100)).filter(v => v > 0).length
    }
    return lit / (150 * 100)
  }
  expect(topLit(4)).toBeLessThan(0.002) // low fires all but never reach it: it separates
  expect(topLit(10)).toBeGreaterThan(0) // the tallest tongues taper into it
  expect(topLit(10)).toBeLessThan(0.35) // but it stays mostly blank
})

test('smoke grays only the tips: the core keeps its color', async () => {
  const tip = colorFor(8, 0.2, 'smoke')
  expect(tip >> 16).toBe(tip & 0xff) // r == b: gray
  expect(colorFor(8, 0.9, 'smoke')).toBe(colorFor(8, 0.9)) // core untouched
})

test('every style draws a full frame, lit when on and blank when off', async () => {
  for (const style of STYLES) {
    const f = makeScene(style, 99)
    f.ensure(48, 5)
    for (let i = 0; i < 40; i++) f.step()
    const lit = decode(f.frame())
    expect(lit.length).toBe(48 * 5 * 3)
    let glyphs = 0
    for (let i = 0; i < lit.length; i += 3) if (lit[i] !== 0x20) glyphs++
    expect(glyphs).toBeGreaterThan(10)

    f.strength = 0
    for (let i = 0; i < 40; i++) f.step()
    const off = decode(f.frame())
    for (let i = 0; i < off.length; i += 3) expect(off[i]).toBe(0x20)
  }
  // `/flow next` walks SCENES in order and wraps round.
  STYLES.forEach((s, i) => expect(nextStyle(s)).toBe(STYLES[(i + 1) % STYLES.length]!))
})

test("the fire draws no backgrounds: every cell keeps the terminal's own", async () => {
  for (const strength of [1, 4, 8, 10]) {
    const f = makeScene('fire', 7)
    f.strength = strength
    f.ensure(60, 5)
    for (let i = 0; i < 60; i++) f.step()
    const words = decode(f.frame())
    for (let i = 0; i < words.length; i += 3) expect(words[i + 2]).toBe(DEFAULT)
  }
})

// ── The heat model ───────────────────────────────────────────────────────

/** Level per frame over `seconds` of a workload at 70 ms frames. */
function simulate(
  seconds: number,
  each: (h: Activity, t: number) => void,
  setup = (h: Activity) => {
    h.turnStarted()
    h.modelStep('high')
  },
) {
  const h = new Activity()
  setup(h)
  const levels: number[] = []
  for (let f = 0; f < Math.round(seconds / 0.07); f++) {
    each(h, f * 0.07)
    h.tick()
    levels.push(h.strength(1))
  }
  const sorted = [...levels].sort((a, b) => a - b)
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    max: sorted[sorted.length - 1]!,
    at10: levels.filter(l => l === 10).length / levels.length,
  }
}
const tickOf = (t: number, period: number) => t % period < 0.035

test('calibration: a streamed answer sits below an edit-test loop', async () => {
  const chat = simulate(20, h => h.streamed(21)) // ~300 chars/s
  const loop = simulate(40, (h, t) => {
    const c = t % 7
    if (c < 0.035) {
      h.modelStep('high')
      h.edited(30)
    }
    if (Math.abs(c - 1) < 0.035) {
      h.ranCommand()
      h.toolsInFlight = 1
    }
    if (Math.abs(c - 6) < 0.035) h.toolsInFlight = 0
  })
  expect(chat.median).toBeLessThan(loop.max)
  expect(chat.max).toBeLessThan(loop.max)
})

test('calibration: a swarm of reading subagents stays below 10; editing ones reach it', async () => {
  // (Over 30 s: a turn running longer climbs a level each 30 s on purpose, below.)
  const readers = simulate(30, (h, t) => {
    h.runningAgents = 4
    for (let a = 0; a < 4; a++) {
      if (tickOf(t + a * 0.5, 2)) {
        h.read(true)
        h.modelStep('low', true)
        h.streamed(60, 'text', true)
      }
    }
  })
  expect(readers.at10).toBeLessThan(0.1)
  const editors = simulate(60, (h, t) => {
    h.runningAgents = 4
    for (let a = 0; a < 4; a++) if (tickOf(t + a * 0.5, 3)) h.edited(30, true)
  })
  expect(editors.max).toBe(10)
})

test('calibration: a blocked tool keeps a low burn; a burst cools back to idle', async () => {
  const blocked = simulate(30, (h, t) => {
    if (t < 0.035) {
      h.ranCommand()
      h.toolsInFlight = 1
    }
  })
  expect(blocked.median).toBe(effortFloor('high') + 1)

  const h = new Activity()
  h.heat = 5
  for (let i = 0; i < 400; i++) h.tick() // ~28 s
  expect(h.strength(1)).toBe(1)
  expect(h.strength(0)).toBe(0)
  expect(h.isGlowing).toBe(false)
})

test('a turn that keeps going climbs a level every 30 s, and starts over with the next turn', async () => {
  const h = new Activity()
  h.turnStarted()
  h.modelStep(undefined) // the default floor, 3
  const at = (seconds: number) => {
    while (h.turnFrames * 0.07 < seconds) h.tick()
    return h.strength(1)
  }
  expect(at(29)).toBe(3)
  expect(at(31)).toBe(4)
  expect(at(61)).toBe(5)
  h.turnStarted() // (raised again within the turn: it keeps counting)
  expect(at(91)).toBe(6)
  expect(at(600)).toBe(10) // never past 10
  h.turnEnded()
  expect(h.strength(1)).toBeLessThanOrEqual(1 + Math.round(h.heat))
  h.turnStarted()
  h.modelStep(undefined)
  expect(h.strength(1)).toBe(3)
})

test("a turn's 30 s clock stops while it waits on the person (a permission, a question), and goes on after", async () => {
  const h = new Activity()
  h.turnStarted()
  h.modelStep(undefined)
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / 0.07); i++) h.tick()
  }
  run(20)
  h.waitingOn('toolu_1') // a permission prompt, left a minute
  h.waitingOn('toolu_2') // and Claude's question beside it
  run(60)
  expect(h.isWaiting).toBe(true)
  expect(h.turnBoost).toBe(0)
  h.answered('toolu_1')
  run(5)
  expect(h.turnBoost).toBe(0) // the question still waits
  h.answered('toolu_2')
  run(11) // 20 s + 11 s of work: past 30
  expect(h.turnBoost).toBe(1)
  h.waitingOn('toolu_3')
  h.turnEnded() // the turn ending forgets what waited
  expect(h.isWaiting).toBe(false)
})

test("a subagent's model step never moves the main turn's effort floor", async () => {
  const h = new Activity()
  h.turnStarted()
  h.modelStep('max')
  h.modelStep('low', true)
  expect(h.floor).toBe(6)
})

test('glowing and strength agree: once it shows no level, it is not glowing', async () => {
  const h = new Activity()
  for (let heat = 0; heat < 2; heat += 0.05) {
    h.heat = heat
    expect(h.isGlowing).toBe(h.strength(0) > 0)
  }
})

test('failures and compaction tint the tips, then clear', async () => {
  const h = new Activity()
  h.failed()
  expect(h.tint).toBe('smoke')
  for (let i = 0; i < 40; i++) h.tick()
  expect(h.tint).toBe('normal')
  h.contextPercent = 90
  expect(h.tint).toBe('blue')
})

test('lines written by each write tool', async () => {
  expect(linesWritten('Write', { content: 'a\nb\nc' })).toBe(3)
  expect(linesWritten('Edit', { new_string: 'x' })).toBe(1)
  expect(linesWritten('MultiEdit', { edits: [{ new_string: 'a\nb' }, { new_string: 'c' }] })).toBe(3)
  expect(linesWritten('MultiEdit', { edits: 'nope' })).toBe(1)
  expect(linesWritten('NotebookEdit', { new_source: 'x\ny' })).toBe(2)
  expect(linesWritten('Bash', { command: 'ls' })).toBeUndefined()
})

// ── Settings and the command ─────────────────────────────────────────────

test('/flow parses every form; `on` means auto', async () => {
  expect(parseFlowArgs('')).toEqual({ kind: 'show' })
  expect(parseFlowArgs('auto')).toEqual({ kind: 'auto' })
  expect(parseFlowArgs('on')).toEqual({ kind: 'auto' })
  expect(parseFlowArgs('idle 0')).toEqual({ kind: 'idle', level: 0 })
  expect(parseFlowArgs('idle 5').kind).toBe('error')
  expect(parseFlowArgs('off')).toEqual({ kind: 'manual', level: 0 })
  expect(parseFlowArgs(' 3 ')).toEqual({ kind: 'manual', level: 3 })
  expect(parseFlowArgs('10')).toEqual({ kind: 'manual', level: 10 })
  expect(parseFlowArgs('11').kind).toBe('error')
  expect(parseFlowArgs('AUTO')).toEqual({ kind: 'auto' })
  expect(parseFlowArgs('auto x').kind).toBe('error')
  expect(parseFlowArgs('style')).toEqual({ kind: 'style' })
  expect(parseFlowArgs('style fire')).toEqual({ kind: 'style', name: 'fire' })
  // The fire's two old looks are both the fire now.
  expect(parseFlowArgs('classic')).toEqual({ kind: 'style', name: 'fire' })
  expect(parseFlowArgs('ember')).toEqual({ kind: 'style', name: 'fire' })
  expect(parseFlowArgs('style hearth').kind).toBe('error') // retired
  // Scenes by name alone; `next` cycles; old night styles are the plain scene.
  expect(parseFlowArgs('ski')).toEqual({ kind: 'style', name: 'ski' })
  expect(parseFlowArgs('next')).toEqual({ kind: 'style' })
  expect(parseFlowArgs('balloon-night').kind).toBe('error') // day or night is never part of a name
  // A scene and a time of day at once, either way round.
  expect(parseFlowArgs('surf night')).toEqual({ kind: 'style', name: 'surf', time: 'night' })
  expect(parseFlowArgs('day ski')).toEqual({ kind: 'style', name: 'ski', time: 'day' })
  expect(parseFlowArgs('surf loud').kind).toBe('error')
  // An unknown scene lists the real ones.
  const unknown = parseFlowArgs('surfing')
  expect(unknown.kind).toBe('error')
  expect(unknown.kind === 'error' && unknown.text.includes('surf, ski')).toBe(true)
  expect(parseFlowArgs('help')).toEqual({ kind: 'help' })
  expect(parseFlowArgs('list')).toEqual({ kind: 'help' })
  expect(parseFlowArgs('manual')).toEqual({ kind: 'manual' })
  expect(parseFlowArgs('idle glow')).toEqual({ kind: 'idle', level: 1 })
  expect(parseFlowArgs('idle dark')).toEqual({ kind: 'idle', level: 0 })
  // Day and night, apart from the scene.
  expect(parseFlowArgs('night')).toEqual({ kind: 'time', time: 'night' })
  expect(parseFlowArgs('day')).toEqual({ kind: 'time', time: 'day' })
  expect(parseFlowArgs('clock')).toEqual({ kind: 'time', time: 'clock' })
  expect(parseFlowArgs('night now').kind).toBe('error')
})

test('day and night: the clock decides unless pinned', async () => {
  expect(isNightAt('clock', 12)).toBe(false)
  expect(isNightAt('clock', 7)).toBe(false)
  expect(isNightAt('clock', 18)).toBe(false)
  expect(isNightAt('clock', 19)).toBe(true)
  expect(isNightAt('clock', 2)).toBe(true)
  expect(isNightAt('day', 2)).toBe(false)
  expect(isNightAt('night', 12)).toBe(true)
  expect(readConfig(undefined).time).toBe('clock')
  expect(readConfig({ time: 'night' }).time).toBe('night')
  expect(readConfig({ time: 'dusk' }).time).toBe('clock')
  const cfg = readConfig({ style: 'surf' })
  expect(changesFor(parseFlowArgs('night'), cfg)).toEqual({ time: 'night' })
  expect(statusText({ ...cfg, time: 'night' }, 8, 'normal', { hour: 12, minute: 0 })).toContain('night')
  expect(statusText(cfg, 8, 'normal', { hour: 8, minute: 54 })).toContain('day (clock 08:54)')
  expect(statusText(cfg, 8, 'normal', { hour: 21, minute: 5 })).toContain('night (clock 21:05)')
  expect(statusText({ ...cfg, style: 'fire' }, 8, 'normal', { hour: 23, minute: 0 })).not.toContain('night') // no night to show
  expect(statusText({ ...cfg, style: 'fire', time: 'night' }, 8, 'normal', { hour: 12, minute: 0 })).toContain('night pinned')
  expect(changedText(parseFlowArgs('clock'), cfg, "Claude's", { hour: 12, minute: 0 })).toContain('clock')
  // A scene with a time sets both.
  expect(changesFor(parseFlowArgs('ski night'), cfg)).toEqual({ style: 'ski', time: 'night' })
})

test('/flow says how to undo, and names tints in words', async () => {
  const cfg = readConfig(undefined)
  expect(changedText(parseFlowArgs('off'), { ...cfg, mode: 'manual', level: 0 }, "Claude's", { hour: 12, minute: 0 })).toContain('/flow auto')
  expect(changedText(parseFlowArgs('5'), { ...cfg, mode: 'manual', level: 5 }, "Claude's", { hour: 12, minute: 0 })).toBe(
    'holding 5/10 — `/flow auto` to follow the work again',
  )
  expect(changedText(parseFlowArgs('surf'), { ...cfg, style: 'surf' }, "Claude's", { hour: 12, minute: 0 })).toContain('/flow next')
  expect(statusText(cfg, 4, 'smoke', { hour: 12, minute: 0 })).toContain('after a failure')
  expect(statusText(cfg, 4, 'blue', { hour: 12, minute: 0 })).toContain('context nearly full')
  expect(statusText(cfg, 4, 'normal', { hour: 12, minute: 0 })).toContain('/flow help')
  expect(helpText()).toContain('band | spine')
  expect(helpText("pi's", false)).not.toContain('spine')
})

test('surf and ski: night darkens the sky, with stars or a moon in it', async () => {
  const lum = (c: number) => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11
  for (const style of ['surf', 'ski'] as const) {
    const shots: number[][] = []
    for (const night of [false, true]) {
      const f = makeScene(style, 4)
      f.strength = 5
      f.night = night
      f.ensure(60, 5)
      for (let i = 0; i < 80; i++) f.step()
      const g = f.grid()
      const top: number[] = []
      for (let x = 0; x < 60; x++) top.push(g.background(x))
      shots.push(top)
    }
    const [day, night] = shots as [number[], number[]]
    const avg = (row: number[]) => row.reduce((s, c) => s + lum(c), 0) / row.length
    expect(avg(night)).toBeLessThan(avg(day) * 0.5)
    // Something bright up there: a star or the moon.
    const f = makeScene(style, 4)
    f.strength = 5
    f.night = true
    f.ensure(60, 5)
    for (let i = 0; i < 80; i++) f.step()
    const g = f.grid()
    let bright = 0
    for (let i = 0; i < 60 * 2; i++) for (const c of [g.foreground(i), g.background(i)]) if (c !== 0x01000000 && lum(c) > 180) bright++
    expect(bright).toBeGreaterThan(0)
  }
})

test('settings: /flow sound on | off | (toggle), shown in the status', () => {
  expect(parseFlowArgs('sound on')).toEqual({ kind: 'sound', sound: 'on' })
  expect(parseFlowArgs('sound off')).toEqual({ kind: 'sound', sound: 'off' })
  expect(parseFlowArgs('sound')).toEqual({ kind: 'sound' })
  expect(parseFlowArgs('sound loud').kind).toBe('error')
  const cfg = readConfig({ sound: 'on' })
  expect(cfg.sound).toBe('on')
  expect(changesFor(parseFlowArgs('sound'), cfg)).toEqual({ sound: 'off' })
  expect(statusText(cfg, 3, 'normal', { hour: 12, minute: 0 })).toContain('sound on')
  expect(helpText()).toContain('/flow sound')
})

test('soundscapes: a bed renews as its take fades, never with the take before, and follows the level at once', () => {
  const takes: (BedTake | undefined)[] = []
  const mood = (level: number) => ({ scene: 'avalon', level, tint: 'normal' as const, night: false, amb: {} })
  const starts: number[] = []
  const picks: string[] = []
  let seed = 1
  for (let ms = 0; ms < 600_000; ms += 70) {
    const { play, stop } = bedStep(takes, mood(5), ms, seed++)
    expect(stop).toEqual([])
    for (const p of play) {
      starts.push(ms)
      picks.push(p.asset)
    }
  }
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i]! - starts[i - 1]!
    expect(gap >= BED_MIN_MS && gap <= BED_EVERY_MS + 70).toBe(true)
  }
  for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1])
  expect(new Set(picks).size).toBe(3)
  // A jump in level (another mood) starts a fresh take now, and the old one stops once it's in.
  const at = Math.max(600_000, starts.at(-1)! + BED_MS)
  const before = takes.map(t => t?.id)
  const rise = bedStep(takes, mood(10), at, seed++)
  expect(rise.play.length).toBe(1)
  expect(rise.play[0]!.asset).not.toBe(picks.at(-1))
  const later = bedStep(takes, mood(10), at + BED_FADE_MS, seed++)
  expect(later.stop.length).toBe(1)
  expect(before.includes(later.stop[0])).toBe(true)
  // A bed that falls silent stops (a rocket's engines cutting off, in orbit's quiet... or none at all).
  const rocket: (BedTake | undefined)[] = []
  const flying = { scene: 'falcon', level: 5, tint: 'normal' as const, night: false, amb: { roar: 1 } }
  const on = bedStep(rocket, flying, 0, 1)
  expect(on.play.length).toBe(1)
  const quiet = bedStep(rocket, { ...flying, amb: {} }, BED_FADE_MS, 2)
  expect(quiet.stop).toEqual([on.play[0]!.id])
})

test('soundscapes: a bed never has more than two takes going, leaving the player room for events', () => {
  for (const scene of STYLES) {
    const takes: (BedTake | undefined)[] = []
    const live = new Map<number, number>() // id -> when it ends by itself
    let seed = 1
    let most = 0
    const ambs = [{}, { roar: 1 }, { roar: 1, wind: 1 }, { space: 1 }, { wind: 0.5 }, { vent: 1 }, { sea: 1 }, { burner: 1 }]
    for (let ms = 0; ms < 900_000; ms += 70) {
      // The level and the doings wander: a new mood every few seconds.
      const level = 1 + (Math.floor(ms / 4130) * 7) % 10
      const amb = ambs[Math.floor(ms / 2710) % ambs.length]!
      const { play, stop } = bedStep(takes, { scene, level, tint: 'normal', night: false, amb }, ms, seed++)
      // (A stopped take leaves the player a moment later; a played-out one after afplay's drain.)
      for (const id of stop) if (live.has(id)) live.set(id, Math.min(live.get(id)!, ms + 100))
      for (const p of play) live.set(p.id, ms + BED_MS + PLAYER_DRAIN_MS)
      for (const [id, end] of live) if (end <= ms) live.delete(id)
      most = Math.max(most, live.size)
    }
    expect(most).toBeLessThanOrEqual(2)
    expect(MAX_PLAYS - most).toBeGreaterThanOrEqual(2)
  }
})

test('soundscapes: a scene holds only a few events for the adapter, so one that never takes them (pi) stays bounded', () => {
  for (const style of STYLES) {
    const f = makeScene(style, 2)
    f.ensure(100, 5)
    for (let i = 0; i < 6000; i++) {
      f.strength = i % 900 < 450 ? 10 : 3
      f.step()
    }
    expect((f.sounds ?? []).length).toBeLessThanOrEqual(24)
  }
})

test('soundscapes: a busy burst samples the whole window, not just its first events', () => {
  const q: number[] = []
  for (let i = 0; i < 400; i++) gather(q, i, i, i * 7 + 1)
  expect(q.length).toBe(BURST_MAX)
  expect(q.filter(i => i >= 200).length).toBeGreaterThan(BURST_MAX / 4)
})

test('soundscapes: beds overlap at random gaps (no seam keeps a beat), and on-screen events synthesize a burst (a valid WAV, each at its moment)', () => {
  expect(BED_MS).toBeGreaterThan(BED_EVERY_MS)
  const gaps = Array.from({ length: 200 }, (_, i) => bedGap(i))
  for (const g of gaps) expect(g >= BED_MIN_MS && g <= BED_EVERY_MS).toBe(true)
  expect(new Set(gaps).size).toBeGreaterThan(100)
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan((BED_EVERY_MS - BED_MIN_MS) * 0.9)
  const b64 = burst([{ kind: 'pop', v: 0.5, offset: 0 }, { kind: 'crack', v: 1, offset: 0.2 }], 3)!
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')
  const n = new DataView(bytes.buffer).getUint32(40, true) / 2
  expect(n).toBeGreaterThan(0.2 * 22050)
  expect(burst([], 1)).toBeUndefined()
})

test('soundscapes: every scene has a bed for every mood, every clip it and the events name exists, and no play can clip', () => {
  const files = new Set(SOUND_FILES)
  const ambs = [{}, { roar: 1, vent: 1, wind: 1, space: 0, burner: 1, swell: 1, curl: 1 }, { roar: 1, space: 1 }, { wind: 0.5 }, { sea: 1 }]
  for (const scene of STYLES) {
    expect(LAYERS[scene]).toBeDefined()
    expect(MOODS[scene]).toBeDefined()
    let heard = 0
    for (let level = 0; level <= 10; level++)
      for (const amb of ambs)
        for (let seed = 0; seed < 6; seed++)
          for (const p of bedPlays({ scene, level, tint: 'normal', night: false, amb }, seed) ?? []) {
            heard++
            expect(files.has(p.asset)).toBe(true)
            // Clips peak at -2 to -3 dBFS and afplay's gain multiplies: past ~1.4 it clips.
            expect(p.gain).toBeLessThanOrEqual(1.4)
          }
    expect(heard).toBeGreaterThan(0)
  }
  for (const kind of Object.keys(EVENTS) as (keyof typeof EVENTS)[])
    for (let seed = 0; seed < 6; seed++) {
      const p = eventPlay({ kind, v: 1 }, seed, 'falcon', 10)!
      expect(files.has(p.asset)).toBe(true)
    }
})

test('sound on: fresh beds keep coming while it shows, and what happens on screen is heard', { options: { mode: 'manual', level: 9, sound: 'on', style: 'bubbles' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow', surface: 'terminal', ...BAND })
  await clock.advance(10_000)
  const plays = seen.plays ?? []
  // Beds (4 s each, every 3.3 s) and bursts of pops; nothing loops.
  expect(plays.length).toBeGreaterThan(6)
  expect(plays.every(p => p.startsWith('once:'))).toBe(true)
  const sizes = new Set(plays.map(p => Number(p.split(':')[1])))
  expect(sizes.size).toBeGreaterThan(1) // beds and bursts are different clips
  await ui.unmount()
})

test('tips: the other scenes once, while it is still the fire; the sound three chances later, if never on', () => {
  const fire = readConfig({})
  let t = readTips(undefined)
  let r = nextTip(t, fire)
  expect(r.tip).toContain('/flow next')
  expect(r.tip).toContain('starship')
  t = r.tips
  // Never again.
  const tips: (string | undefined)[] = []
  for (let i = 0; i < 6; i++) {
    r = nextTip(t, fire)
    tips.push(r.tip)
    t = r.tips
  }
  expect(tips.filter(Boolean).length).toBe(1)
  expect(tips[2]).toContain('/flow sound')
  // Found another scene first: no scenes tip; sound on before its turn: no sound tip.
  t = {}
  for (let i = 0; i < 6; i++) {
    r = nextTip(t, readConfig({ style: 'surf', sound: i === 1 ? 'on' : 'off' }))
    expect(r.tip).toBeUndefined()
    t = r.tips
  }
  // Stored junk is ignored.
  expect(readTips({ scenesTold: 'yes', since: -1, soundTold: true })).toEqual({ soundTold: true })
})

test('tips: starting on the fire shows the scenes tip once, as a toast', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  expect(seen.toasts ?? []).toHaveLength(1)
  expect(seen.toasts![0]).toContain('`/flow next` steps through them')
  expect(await flow($, '')).not.toContain('steps through them')
})

test('tips: or, started without a prompt to toast over, under the next /flow', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await ($ as unknown as { session: { start: (a: object) => Promise<unknown> } }).session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: false })
  expect(seen.toasts ?? []).toEqual([])
  expect(await flow($, '')).toContain('`/flow next` steps through them')
  expect(await flow($, '')).not.toContain('steps through them')
})

test('/flow sound toggles it: on, the soundscape plays; off again, it stops at once and nothing more plays', { options: { mode: 'manual', level: 9, style: 'bubbles' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow', surface: 'terminal', ...BAND })
  await clock.advance(2000)
  expect(seen.plays ?? []).toEqual([])
  expect(await flow($, 'sound')).toContain('sound on')
  await clock.advance(3000)
  const playing = (seen.plays ?? []).length
  expect(playing).toBeGreaterThan(0)
  expect(await flow($, 'sound')).toContain('sound off')
  await clock.advance(5000)
  expect((seen.plays ?? []).length).toBe(playing)
  await ui.unmount()
})

test('spine: the pane hides while flow is off, as the band does, and comes back with it', { options: { mode: 'manual', level: 5, layout: 'spine' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const panes = new Set<string>()
  const calls: string[] = []
  on('ui.open', (_, e) => {
    panes.add((e as { id: string }).id)
    calls.push('open')
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    panes.delete((e as { id: string }).id)
    calls.push('close')
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  await start($)
  expect(panes.has('flow')).toBe(true)
  expect(await flow($, '0')).toContain('off')
  expect(panes.has('flow')).toBe(false)
  expect(await flow($, '5')).toContain('holding 5/10')
  expect(panes.has('flow')).toBe(true)
  // Still the spine: the pane closing itself isn't you asking for the band.
  expect(await flow($, '')).toContain('spine')
})

test('a clip refused as the player is full is retried, but not once the soundscape has moved to another scene', { options: { mode: 'manual', level: 9, sound: 'on', style: 'engine' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  // The player refuses the engine's chuffs (full); everything else plays.
  const seen = engine(on, undefined, asset => asset.includes('chuff'))
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow', surface: 'terminal', ...BAND })
  const chuffs = () => (seen.plays ?? []).filter(p => p.includes('chuff')).length
  await clock.advance(1000)
  // Frame by frame till a chuff is refused; then, its retry not yet due, another scene.
  const start0 = chuffs()
  for (let k = 0; k < 100 && chuffs() === start0; k++) await clock.advance(10)
  expect(chuffs()).toBeGreaterThan(start0)
  await flow($, 'surf')
  const before = chuffs()
  await clock.advance(2000)
  expect(chuffs()).toBe(before)
  await ui.unmount()
})

test('sound off (the default): nothing plays', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow', surface: 'terminal', ...BAND })
  await clock.advance(2000)
  expect(seen.plays ?? []).toEqual([])
  await ui.unmount()
})

test('config values are validated, falling back to defaults', async () => {
  expect(readConfig(undefined)).toEqual({ mode: 'auto', style: 'fire', idle: 1, level: 8, layout: 'band', time: 'clock', sound: 'off' })
  expect(readConfig({ mode: 'manual', style: 'ember', idle: 'dark', level: 3 })).toEqual({
    mode: 'manual',
    style: 'fire',
    idle: 0,
    level: 3,
    layout: 'band',
    time: 'clock',
    sound: 'off',
  })
  expect(readConfig({ idle: 'pilot' }).idle).toBe(1) // the old name for glow
  expect(readConfig({ idle: 'glow' })).toEqual({
    mode: 'auto',
    style: 'fire',
    idle: 1,
    level: 8,
    layout: 'band',
    time: 'clock',
    sound: 'off',
  })
  expect(readConfig({ mode: 'loud', style: 'hearth', idle: 'x', level: 5.5 })).toEqual(readConfig(undefined))
  expect(readConfig({ level: 42 }).level).toBe(8)
})

test('/config rows left on a scene since renamed or dropped read as the one meant, to be written back', () => {
  const style = { key: 'flow.style', options: STYLES }
  expect(staleRows([{ ...style, value: 'colony' }], 'flow')).toEqual([{ key: 'flow.style', field: 'style', from: 'colony', to: 'avalon' }])
  expect(staleRows([{ ...style, value: 'ocean' }], 'flow')[0]?.to).toBe('surf')
  expect(staleRows([{ ...style, value: 'river' }], 'flow')[0]?.to).toBe('fire') // dropped: the default
  expect(staleRows([{ ...style, value: 'lava' }], 'flow')[0]?.to).toBe('fire')
  expect(staleRows([{ key: 'flow.idle', value: 'pilot', options: ['glow', 'dark'] }], 'flow')[0]?.to).toBe('glow')
  // Every old name and alias stands for a scene of today's.
  for (const d of SCENES) {
    for (const a of d.aliases ?? []) expect(staleRows([{ ...style, value: a }], 'flow')[0]?.to).toBe(d.name)
  }
  // A row already right, another plugin's, the panel's own, one with no options: left alone.
  const rows = [
    { ...style, value: 'surf' },
    { key: 'other.style', value: 'colony', options: ['a', 'b'] },
    { key: 'theme', value: 'colony', options: ['light', 'dark'] },
    { key: 'flow.level', value: 3 },
  ]
  expect(staleRows(rows, 'flow')).toEqual([])
})

test('a /config row left on an old scene (colony) is written back as avalon at the start, said in the debug log alone', { options: { style: 'colony' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  // Claude Code reads the stored `colony` as the default (fire) before Flow loads; /config's row still holds it.
  const row = { key: 'flow.style', label: 'Scene', kind: 'choice', value: 'colony', options: [...STYLES], provider: { plugin: 'flow', tier: 'user' }, isLocked: false }
  on('config.list', () => ({ value: [row] as never }))
  await start($)
  expect(seen.config).toEqual([['flow.style', 'avalon']])
  expect((await flow($)).split('\n')[0]).toContain('avalon')
  const said = (seen.logs ?? []).filter(l => l.text.includes('colony'))
  expect(said).toHaveLength(1)
  expect(said[0]!.to).toBe('debug')
  expect((seen.toasts ?? []).some(t => t.includes('colony'))).toBe(false)
})

test('settings arrive from /config', { options: { mode: 'manual', style: 'surf', level: 3 } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  await start($)
  expect((await flow($)).split('\n')[0]).toContain('surf, holding 3/10')
})

test('/flow applies at once without a /config write (no reload), and its changes outlast a reload', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  expect((await flow($, 'next')).split('\n')[0]).toBe('warp · `/flow next` for another')
  // (A one-time tip may follow the reply, after a blank line.)
  expect((await flow($, '5')).split('\n\n')[0]).toBe('holding 5/10 — `/flow auto` to follow the work again')
  expect((await flow($, '8')).split('\n\n')[0]).toBe('holding 8/10 — `/flow auto` to follow the work again')
  expect(seen.config).toEqual([]) // nothing written to /config: the scene keeps running
  expect((await flow($)).split('\n')[0]).toBe('warp, holding 8/10')
  // A reload (a /config menu change, a restart) reads them back from the store.
  await start($)
  expect((await flow($)).split('\n')[0]).toBe('warp, holding 8/10')
})

test('settings kept in the old store move to /config once', async ($, on) => {
  mock.clock(on)
  mock.store(on, { mode: 'manual', strength: 4, style: 'ember', drop: 2 })
  const seen = engine(on)
  await start($)
  expect(seen.config).toContainEqual(['flow.level', 4])
  expect(seen.config).toContainEqual(['flow.style', 'fire'])
  expect(seen.config).toContainEqual(['flow.mode', 'manual'])
  // The store was emptied, so a second start (a reload) moves nothing again.
  const moved = seen.config.length
  await start($)
  expect(seen.config.length).toBe(moved)
})

// ── Wiring ───────────────────────────────────────────────────────────────

test('a big write lifts the scene; a failed command shows smoke', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  let isError = false
  on('tool.call', () => (isError ? { result: {} as never, isError: true as const } : { result: {} as never }))
  await start($)
  expect(await flow($)).toContain('now 1/10') // idle: a low glow

  const content = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')
  await $.tool.call({ tool: 'Write', file_path: '/tmp/x.ts', content } as never)
  expect(await flow($)).toContain('now 5/10') // 1 + a full flare of 4

  isError = true
  await $.tool.call({ tool: 'Bash', command: 'false' } as never)
  expect(await flow($)).toContain('after a failure')
})

test('a precompute pass is not a compaction: no smoke', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  on('session.compact', () => ({ skip: 'nothing to do' }))
  await start($)
  await $.session.compact({ trigger: 'precompute' } as never)
  await $.session.compact({ trigger: 'manual' } as never) // skipped below
  expect(await flow($)).not.toContain('after a failure')
})

// ── The band ─────────────────────────────────────────────────────────────

test('the band draws its 5 rows on the terminal', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  const ui = await $.ui.mount({ plugin: 'flow', surface: 'terminal', ...BAND })
  const raster = await ui.find({ type: 'Raster', key: 'flow' })
  expect(raster?.props.columns).toBe(60)
  expect(raster?.props.rows).toBe(5)
  await ui.unmount()
})

test('the band yields to other surfaces, surveys, and a one-row squeeze', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  for (const [surface, props] of [
    ['vscode', BAND.props],
    ['terminal', { ...BAND.props, hasSurvey: true }],
    ['terminal', { ...BAND.props, maxRows: 2 }],
  ] as const) {
    const ui = await $.ui.mount({ plugin: 'flow', surface, component: 'AbovePrompt', props })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.unmount()
  }
})

/** Decode a frame's PNG (stored deflate, as svg.ts writes it) back to its pixels. */
function decodeSvgPng(svg: string): { width: number; height: number; rgba: Uint8Array } {
  const b64 = /base64,([^"]+)"/.exec(svg)![1]!
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let o = 8
  let width = 0
  let height = 0
  const data: number[] = []
  while (o < bytes.length) {
    const length = view.getUint32(o)
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
    const body = bytes.subarray(o + 8, o + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(o + 8)
      height = view.getUint32(o + 12)
    } else if (type === 'IDAT') {
      let k = 2
      for (;;) {
        const final = body[k]! & 1
        const n = body[k + 1]! | (body[k + 2]! << 8)
        for (let j = 0; j < n; j++) data.push(body[k + 5 + j]!)
        k += 5 + n
        if (final) break
      }
    }
    o += 12 + length
  }
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(data[y * (width * 4 + 1)]).toBe(0) // no filter
    rgba.set(data.slice(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return { width, height, rgba }
}

test('on desktop the band is one Svg sized to its cells', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow', surface: 'desktop', ...BAND })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg?.props.width).toBe(60 * 8)
  expect(svg?.props.height).toBe(5 * 19)
  const png = decodeSvgPng(svg?.props.source as string)
  expect([png.width, png.height]).toEqual([120, 20]) // 2 x 4 pixels a cell
  await ui.unmount()
})

test('desktop: every scene, in every size, fits the Svg limit and decodes to its grid', async () => {
  for (const style of STYLES) {
    for (const [columns, rows] of [[250, 5], [41, 45], [40, 120]] as const) {
      const s = makeScene(style, 7)
      s.strength = 10
      s.coverageBoost = 60
      s.ensure(columns, rows)
      for (let i = 0; i < 20; i++) s.step()
      const grid = s.grid()
      const svg = frameSvg(grid)
      expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
      const png = decodeSvgPng(svg)
      expect(png.width % columns).toBe(0)
      expect(png.height % rows).toBe(0)
      // A full block's pixels are its color, opaque.
      const sx = png.width / columns
      const sy = png.height / rows
      for (let i = 0; i < columns * rows; i++) {
        if (grid.codePoint(i) !== 0x2588) continue
        const o = (Math.floor(i / columns) * sy * png.width + (i % columns) * sx) * 4
        const fg = grid.foreground(i)
        expect([...png.rgba.subarray(o, o + 4)]).toEqual([(fg >> 16) & 255, (fg >> 8) & 255, fg & 255, 255])
        break
      }
    }
  }
})

test('a pane wider than it is tall still gets the tall layouts, not the 5-row band\'s', () => {
  expect(isTall(250, 5)).toBe(false) // the band
  expect(isTall(13, 30)).toBe(true) // the spine
  expect(isTall(76, 45)).toBe(true) // a desktop pane dragged wide
})

test('desktop: quadrants, eighths, shades and braille land on their own pixels', () => {
  expect(coverage(0x2598)).toBe(0b00000101) // upper left quadrant: x0 of rows 0-1
  expect(coverage(0x2584)).toBe(0b11110000) // lower half
  expect(coverage(0x2582)).toBe(0b11000000) // lower quarter: the bottom row
  expect(coverage(0x258c)).toBe(0b01010101) // left half: the left column
  expect(coverage(0x2801)).toBe(0b00000001) // braille dot 1, top left
  expect(coverage(0x2880)).toBe(0b10000000) // braille dot 8, bottom right
  expect(coverage(0x41)).toBe(-1) // a letter: no block shape
})

test('PixelScene: paints pixels into glyphs, leaves the rest clear, lays specks over, blanks at 0', () => {
  let seen: Dials | undefined
  class Probe extends PixelScene {
    paint(px: Painter, d: Dials) {
      seen = d
      px.rect(0, 0, 2, 2, 0xff0000) // cell 0: all red
      px.set(0, 2, 0x00ff00) // cell 4 (row 1): one green pixel, top left
      px.dot(5, 1, 0xffffff) // cell 2: a speck
    }
  }
  const s = new Probe()
  s.strength = 5
  s.ensure(4, 3)
  s.step()
  const g = s.grid()
  expect(g.codePoint(0)).toBe(0x20) // one flat color: a space on that background
  expect(g.background(0)).toBe(0xff0000)
  expect(g.codePoint(4)).toBe(0x2598) // ▘ green, the rest the terminal's
  expect(g.foreground(4)).toBe(0x00ff00)
  expect(g.background(4)).toBe(DEFAULT)
  expect(g.codePoint(2)).toBe(0x2800 | 0x10) // braille dot at column 1, row 1
  expect(g.codePoint(1)).toBe(0x20) // untouched: blank, the terminal's own
  expect(g.background(1)).toBe(DEFAULT)
  expect(seen?.level).toBe(5)
  expect(seen?.tall).toBe(false)
  // The level glides toward a new dial rather than jumping...
  s.strength = 10
  s.step()
  expect(s.grid() && seen!.level).toBeGreaterThan(5)
  expect(seen!.level).toBeLessThan(6)
  // ...but 0 is off at once.
  s.strength = 0
  const off = s.grid().words
  for (let i = 0; i < off.length; i += 3) expect(off[i]).toBe(0x20)
})

test('every scene has a unique lowercase name, a blurb, and builds', () => {
  expect(new Set(STYLES).size).toBe(STYLES.length)
  for (const d of SCENES) {
    expect(d.name).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(d.blurb.length).toBeGreaterThan(0)
    expect(styleNamed(d.name)).toBe(d.name)
    for (const a of d.aliases ?? []) expect(styleNamed(a)).toBe(d.name)
    const s = makeScene(d.name, 1)
    s.ensure(40, 5)
    s.step()
    expect(s.grid().columns).toBe(40)
  }
})

test('desktop: shades fill the whole cell, blended, rather than a dither', () => {
  const g = new Cells(1, 1)
  g.set(0, 0x2592, 0xff8800, DEFAULT) // ▒ over the terminal's own color
  const { rgba } = gridPixels(g, 2, 4)
  for (let i = 0; i < 8; i++) expect([...rgba.subarray(i * 4, i * 4 + 4)]).toEqual([0xff, 0x88, 0x00, 140])
  g.set(0, 0x2591, 0xffffff, 0x000000) // ░ over black: a dim grey
  expect([...gridPixels(g, 2, 4).rgba.subarray(0, 4)]).toEqual([77, 77, 77, 255])
})

test('desktop: the smaller pixel sizes blend what they cover, so sparse glyphs dim rather than vanish', () => {
  const lit = (cp: number, sx: number, sy: number) => {
    const g = new Cells(1, 1)
    g.set(0, cp, 0xff8800, DEFAULT)
    const { rgba } = gridPixels(g, sx, sy)
    let n = 0
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) n++
    return n
  }
  for (const [sx, sy] of [[2, 2], [1, 2], [1, 1]] as const) {
    expect(lit(0x2591, sx, sy)).toBeGreaterThan(0) // ░
    expect(lit(0x2801, sx, sy)).toBeGreaterThan(0) // braille dot 1, top left
    expect(lit(0x2804, sx, sy)).toBeGreaterThan(0) // braille dot 3, row 2
    expect(lit(0x2590, sx, sy)).toBeGreaterThan(0) // ▐ right half
    expect(lit(0x2808, sx, sy)).toBeGreaterThan(0) // braille dot 4, right column
  }
})

test('desktop: a pane too big for 1 × 2 still draws, at fewer pixels, never blank', () => {
  for (const [columns, rows] of [[200, 80], [512, 256]] as const) {
    const g = new Cells(columns, rows)
    for (let i = 0; i < columns * rows; i++) g.set(i, 0x2588, 0x334455, DEFAULT)
    const svg = frameSvg(g)
    expect(svg.length).toBeLessThanOrEqual(SVG_LIMIT)
    const png = decodeSvgPng(svg)
    expect(png.width).toBeGreaterThan(columns / 4)
    expect([...png.rgba.subarray(0, 4)]).toEqual([0x33, 0x44, 0x55, 255])
  }
})

test('two drivers on one cfg keep their own scenes, and both follow a change of scene', () => {
  const cfg = readConfig({ style: 'fire', mode: 'manual', level: 10 })
  const activity = new Activity()
  const terminal = new SceneDriver(cfg, activity)
  const desktop = new SceneDriver(cfg, activity)
  expect(terminal.scene).not.toBe(desktop.scene)
  terminal.dial().ensure(120, 5)
  desktop.dial().ensure(76, 45)
  for (let i = 0; i < 40; i++) {
    terminal.dial().step()
    desktop.dial().step()
  }
  // Each kept its own size, so neither was rebuilt: the terminal's fire has built up.
  const words = terminal.scene.grid().words
  let lit = 0
  for (let i = 0; i < words.length; i += 3) if (words[i] !== 0x20) lit++
  expect(lit).toBeGreaterThan(50)
  terminal.apply({ style: 'surf' })
  expect(terminal.scene).toBe(terminal.sceneFor('surf'))
  expect(desktop.scene).toBe(desktop.sceneFor('surf'))
  expect(terminal.scene).not.toBe(desktop.scene)
})

test('a desktop view that stops rendering (its window closed) is forgotten: no more redraws asked for', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const desk = await $.ui.mount({ plugin: 'flow', surface: 'desktop', requestId: 'desk', ...BAND })
  seen.invalidates = 0
  await clock.advance(1000)
  expect(seen.invalidates).toBeGreaterThan(5) // while it's there, every frame asks for a redraw
  await desk.unmount()
  await clock.advance(5000)
  seen.invalidates = 0
  await clock.advance(3000)
  expect(seen.invalidates).toBeLessThan(2)
})

test('rockets: a new size while the split screen is open closes it cleanly (no garbage cells)', () => {
  const f = makeScene('starship', 3)
  f.strength = 1
  f.ensure(120, 5)
  for (let i = 0; i < 30; i++) f.step()
  let open = false
  for (let i = 0; i < 600 && !open; i++) {
    f.strength = 10
    f.step()
    f.grid()
    open = (f as unknown as { splitW: number }).splitW > 2
  }
  expect(open).toBe(true)
  f.ensure(18, 50)
  for (let i = 0; i < 5; i++) {
    f.strength = 10
    f.step()
    const w = f.grid().words
    for (let k = 0; k < w.length; k += 3) expect(w[k]).toBeGreaterThan(0)
  }
})

test("a pending scene under an old name (colony) is written through as its new one (avalon), not dropped", async () => {
  const store = new Map<string, unknown>([['overrides', { style: 'colony' }]])
  const config: Record<string, unknown> = {}
  const session = {
    store: {
      get: async (k: string) => structuredClone(store.get(k)),
      set: async (k: string, v: unknown) => store.set(k, structuredClone(v)),
      delete: async (k: string) => store.delete(k),
    },
    config: {
      set: async ({ key, value }: { key: string; value: unknown }) => ((config[key] = value), { value }),
    },
  } as never
  expect(await migrateOverrides(session)).toEqual({ style: 'avalon' })
  expect(config['flow.style']).toBe('avalon')
  expect(store.has('overrides')).toBe(false)
  // A session's own settings read old names the same way.
  expect(readOwn({ style: 'colony', idle: 'dark', level: 42, junk: 1 })).toEqual({ style: 'avalon', idle: 0 })
})

test("a desktop view of the band doesn't stop the terminal's blits", async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const seen = engine(on)
  await start($)
  const term = await $.ui.mount({ plugin: 'flow', surface: 'terminal', requestId: 'term', ...BAND })
  await $.ui.mount({ plugin: 'flow', surface: 'desktop', requestId: 'desk', ...BAND })
  seen.blits.length = 0
  await clock.advance(2000)
  expect(seen.blits.length).toBeGreaterThan(3)
  expect(seen.blits.every(id => id === 'term')).toBe(true)
  await term.unmount()
})

test('with idle dark, an idle session gives the band back', { options: { idle: 'dark' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount({ plugin: 'flow', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

// ── pi ───────────────────────────────────────────────────────────────────

test('pi: the grid as 24-bit ANSI lines, one cell per glyph, reset at the end', async () => {
  const f = makeScene('fire', 3)
  f.ensure(30, 5)
  for (let i = 0; i < 30; i++) f.step()
  const lines = gridToAnsi(f.grid())
  expect(lines.length).toBe(5)
  for (const line of lines) {
    const visible = line.replace(/\x1b\[[0-9;]*m/g, '')
    expect(visible.length).toBe(30) // every glyph is one cell; pi needs lines to fit the width
    // No color left on at the end: the last style change in the line is a reset.
    const styles = line.match(/\x1b\[[0-9;]*m/g) ?? []
    if (styles.length) expect(styles[styles.length - 1]).toBe('\x1b[0m')
  }
  expect(lines.some(l => /\x1b\[38;2;\d+;\d+;\d+m/.test(l))).toBe(true)
})

test('pi: scenes keep their backgrounds; every cell decodes back to its grid colors', async () => {
  const DEFAULT = 0x01000000
  for (const [style, night] of [['surf', true], ['ski', false], ['balloon', false], ['falcon', true], ['fire', false]] as const) {
    const f = makeScene(style, 3)
    f.night = night
    f.strength = 8
    f.ensure(40, 4)
    for (let i = 0; i < 40; i++) f.step()
    const grid = f.grid()
    const lines = gridToAnsi(grid)
    for (let r = 0; r < grid.rows; r++) {
      let fg = DEFAULT
      let bg = DEFAULT
      let x = 0
      for (const part of lines[r]!.split(/(\x1b\[[0-9;]*m)/)) {
        const sgr = /^\x1b\[([0-9;]*)m$/.exec(part)
        if (sgr) {
          const n = sgr[1]!.split(';').map(Number)
          if (n[0] === 0) fg = bg = DEFAULT
          else if (n[0] === 38) fg = (n[2]! << 16) | (n[3]! << 8) | n[4]!
          else if (n[0] === 48) bg = (n[2]! << 16) | (n[3]! << 8) | n[4]!
          continue
        }
        for (const ch of part) {
          const i = r * grid.columns + x++
          expect(ch.codePointAt(0)).toBe(grid.codePoint(i))
          expect(fg).toBe(grid.foreground(i))
          expect(bg).toBe(grid.background(i))
        }
      }
      expect(x).toBe(grid.columns)
    }
  }
})

test("pi: thinking levels map onto the effort floors; edits count pi's input shapes", async () => {
  expect(effortOf('off')).toBe('low')
  expect(effortOf('minimal')).toBe('low')
  expect(effortOf('high')).toBe('high')
  expect(effortOf('max')).toBe('max')
  expect(effortOf(undefined)).toBeUndefined()
  expect(piLinesWritten('write', { path: 'a', content: 'x\ny' })).toBe(2)
  expect(piLinesWritten('edit', { path: 'a', edits: [{ oldText: 'a', newText: 'b\nc' }, { oldText: 'd', newText: 'e' }] })).toBe(3)
  expect(piLinesWritten('edit', { path: 'a', oldText: 'a', newText: 'b' })).toBe(1)
  expect(piLinesWritten('bash', { command: 'ls' })).toBeUndefined()
})

test('settings: the shared /flow grammar applies the same changes everywhere', async () => {
  const cfg = readConfig(undefined)
  expect(changesFor(parseFlowArgs('style'), cfg)).toEqual({ style: 'warp' })
  expect(changesFor(parseFlowArgs('idle 0'), cfg)).toEqual({ idle: 0, mode: 'auto' })
  expect(changesFor(parseFlowArgs(''), cfg)).toBeUndefined()
  expect(statusText({ ...cfg, mode: 'manual', level: 3 }, 3, 'normal', { hour: 12, minute: 0 }).split('\n')[0]).toBe('fire, holding 3/10')
})

test('balloon: sits on the grass at 1, climbs to space at 10, eases back down', async () => {
  const b = new Balloon(1)
  b.ensure(60, 5)
  b.strength = 1
  for (let i = 0; i < 200; i++) b.step()
  expect(b.altitude).toBe(0)
  const ground = decode(b.frame())
  expect(ground[(4 * 60 + 0) * 3]).toBe(0x2580) // ▀ grass under the basket

  b.strength = 10
  const climb: number[] = []
  for (let i = 0; i < 300; i++) {
    b.step()
    if (i % 50 === 0) climb.push(b.altitude)
  }
  for (let i = 1; i < climb.length; i++) expect(climb[i]!).toBeGreaterThan(climb[i - 1]!) // a climb, not a jump
  expect(b.altitude).toBeGreaterThan(120)

  b.strength = 3
  for (let i = 0; i < 400; i++) b.step()
  expect(b.altitude).toBeLessThan(16) // a quiet spell brings it back down
})

test('spine: the balloon really climbs a tall column; the ground scrolls away only near the top', async () => {
  const b = new Balloon(5)
  b.ensure(18, 30)
  const crownRow = () => {
    const words = decode(b.frame())
    for (let r = 0; r < 30; r++) for (let x = 0; x < 18; x++) if (words[(r * 18 + x) * 3] === 0x2586) return r // ▆
    return -1
  }
  const isGroundBelow = () => {
    const words = decode(b.frame())
    for (let x = 0; x < 18; x++) if (words[(29 * 18 + x) * 3] !== 0x2580) return false
    return true
  }
  b.strength = 1
  for (let i = 0; i < 200; i++) b.step()
  const resting = crownRow()
  expect(isGroundBelow()).toBe(true)
  b.strength = 3
  for (let i = 0; i < 300; i++) b.step()
  expect(crownRow()).toBeLessThan(resting) // it rose up the screen
  expect(isGroundBelow()).toBe(true) // with the grass still below
  b.strength = 10
  for (let i = 0; i < 400; i++) b.step()
  expect(isGroundBelow()).toBe(false) // high enough that the world scrolled away
})

test('every style fills a tall spine', async () => {
  for (const style of STYLES) {
    const f = makeScene(style, 9)
    f.strength = 10
    f.ensure(18, 30)
    for (let i = 0; i < 120; i++) f.step()
    const words = decode(f.frame())
    const litRows = new Set<number>()
    for (let i = 0; i < words.length; i += 3) if (words[i] !== 0x20) litRows.add(Math.floor(i / 3 / 18))
    expect(litRows.size).toBeGreaterThan(12) // not just a strip at the bottom
  }
})

test('settings: layout parses, toggles, and shows', async () => {
  expect(parseFlowArgs('spine')).toEqual({ kind: 'layout', layout: 'spine' })
  expect(parseFlowArgs('layout band')).toEqual({ kind: 'layout', layout: 'band' })
  for (const w of ['horizontal', 'bar', 'flat']) expect(parseFlowArgs(w)).toEqual({ kind: 'layout', layout: 'band' })
  for (const w of ['portrait', 'vertical', 'side']) expect(parseFlowArgs(w)).toEqual({ kind: 'layout', layout: 'spine' })
  expect(parseFlowArgs('layout vertical')).toEqual({ kind: 'layout', layout: 'spine' })
  expect(parseFlowArgs('layout sideways').kind).toBe('error')
  const cfg = readConfig({ layout: 'spine' })
  expect(cfg.layout).toBe('spine')
  expect(changesFor(parseFlowArgs('layout'), cfg)).toEqual({ layout: 'band' })
  expect(statusText(cfg, 1, 'normal', { hour: 12, minute: 0 })).toContain('spine')
  expect(readConfig({ layout: 'diagonal' }).layout).toBe('band')
})

test('balloon: a rebuilt balloon (a settings reload) resumes in the air, not on the ground', async () => {
  const before = new Balloon(2)
  before.ensure(60, 5)
  before.strength = 8
  for (let i = 0; i < 300; i++) before.step()
  const cruising = before.altitude

  const after = new Balloon(3) // what a reload builds
  after.ensure(60, 5)
  after.seed(cruising)
  after.strength = 10 // the change that caused the reload
  after.step()
  expect(after.altitude).toBeGreaterThan(cruising) // carries on climbing from where it was
  after.seed(Number.NaN)
  expect(after.altitude).toBeGreaterThan(cruising) // a bad saved value is ignored
})

test('avalon: the ship coasts among still stars at 1; at 10 the stars blur past in streaks', async () => {
  const streaks = (level: number) => {
    const c = new Colony(4)
    c.ensure(90, 5)
    c.strength = level
    for (let i = 0; i < 60; i++) c.step()
    const words = decode(c.frame())
    let ship = 0
    let streak = 0
    for (let i = 0; i < words.length; i += 3) {
      const x = (i / 3) % 90
      // The ship: braille-dot vector lines, about a third of the way across.
      if (words[i]! >= 0x2801 && words[i]! <= 0x28ff && x >= 24 && x <= 40) ship++
      if (words[i] === 0x2500) streak++ // ─ a star's trail
    }
    return { ship, streak }
  }
  const coasting = streaks(1)
  const warp = streaks(10)
  expect(coasting.ship).toBeGreaterThan(0)
  expect(coasting.streak).toBe(0) // at 1 the stars are points
  expect(warp.streak).toBeGreaterThan(60) // at 10 they blur past
})

test('settings: starfield is now warp; the old name still works', async () => {
  expect(readConfig({ style: 'starfield' }).style).toBe('warp')
  expect(parseFlowArgs('style starfield')).toEqual({ kind: 'style', name: 'warp' })
  expect(parseFlowArgs('style colony')).toEqual({ kind: 'style', name: 'avalon' })
  expect(parseFlowArgs('interstellar')).toEqual({ kind: 'style', name: 'avalon' })
  expect(parseFlowArgs('sea night')).toEqual({ kind: 'style', name: 'surf', time: 'night' })
})

test('balloon: a sky behind it, day blue low down, darkening into the black of space', async () => {
  const blue = (c: number) => (c & 0xff) > ((c >> 16) & 0xff) // more blue than red
  const brightness = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255)
  expect(blue(skyColor(2))).toBe(true)
  expect(brightness(skyColor(80))).toBeLessThan(brightness(skyColor(5))) // darker with height
  expect(skyColor(140)).toBe(0x000000) // space is painted black, darker than any atmosphere
  for (let y = 0; y < 140; y++) expect(brightness(skyColor(y + 1))).toBeLessThan(brightness(skyColor(y)) + 1) // never lightens going up

  const b = new Balloon(6)
  b.ensure(40, 5)
  b.strength = 1
  for (let i = 0; i < 100; i++) b.step()
  const day = decode(b.frame())
  expect(blue(day[2]!)).toBe(true) // the top-left cell's background is sky
  b.strength = 10
  for (let i = 0; i < 500; i++) b.step()
  const space = decode(b.frame())
  expect(space[2]).toBe(0x000000) // at 10 the top row is the black of space
})

test('subagents running in the background lift the scene even with no turn (e.g. after a reload)', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  engine(on)
  const running = [1, 2, 3].map(i => ({ id: `a${i}`, description: 'cloud painter', type: 'subagent', status: 'running' }))
  on('agent.list', () => ({ value: running as never }))
  await start($) // a fresh load: no turn known, nothing remembered
  await clock.advance(6000) // one idle poll at most
  const text = await flow($)
  expect(text).not.toContain('now 1/10') // three subagents lift it off the pilot lights
})

test('a rocket picked while the level is flying starts in that stage, not on the pad', async () => {
  for (const level of [4, 10]) {
    // state and orbit are private (Falcon & { state } is never): reach them past the class's own type.
    const r = new Falcon(3) as unknown as Pick<Falcon, 'ensure' | 'strength' | 'step'> & { state: string; orbit: number }
    r.ensure(60, 5)
    r.strength = level
    r.step()
    expect(r.state).toBe('fly')
    expect(r.orbit).toBe(level >= 8 ? 1 : 0) // no launch and race up to orbit
  }
  const parked = new Falcon(3) as unknown as Pick<Falcon, 'ensure' | 'strength' | 'step'> & { state: string }
  parked.ensure(60, 5)
  parked.strength = 1
  parked.step()
  expect(parked.state).toBe('rest') // level 1 sits on the pad
})

test('rockets play every stage on the way up and down, about a second each', async () => {
  const r = new Falcon(3)
  r.ensure(60, 30)
  r.strength = 1
  r.step() // a fresh start resumes as asked: on the pad
  const seen: number[] = []
  for (let i = 0; i < 14 * 12; i++) {
    r.strength = 10 // what the dial asks for, every frame
    r.step()
    if (seen[seen.length - 1] !== r.strength) seen.push(r.strength)
  }
  expect(seen).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]) // no stage skipped
  const down: number[] = []
  for (let i = 0; i < 14 * 12; i++) {
    r.strength = 1
    r.step()
    if (down[down.length - 1] !== r.strength) down.push(r.strength)
  }
  expect(down).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
  r.strength = 0
  r.step()
  expect(r.strength).toBe(0) // off is instant
})

test('/flow ignores words that only exist on every object (constructor, __proto__)', async () => {
  for (const args of ['constructor', '__proto__', 'idle constructor', 'surf constructor', 'night __proto__']) {
    expect(parseFlowArgs(args).kind).toBe('error')
  }
})

// ── Per-session settings ─────────────────────────────────────────────────

type EndInput = { reason: string; sessionId: string; resume: { id: string } }
/** End the session as the engine does (a /clear, a resume, an exit), the process going on. */
async function endSession($: unknown, reason: string, id: string) {
  await ($ as { session: { end: (e: EndInput) => Promise<unknown> } }).session.end({ reason, sessionId: id, resume: { id } })
}

test('sessions: /flow changes only the session it runs in; each resumes with its own, a new one starts on the defaults', { options: { style: 'surf' } }, async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on)
  seen.session = 'a'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, auto/)
  const picked = await flow($, 'ski night')
  expect(picked.split('\n')[0]).toBe('ski, night · `/flow next` for another')
  expect(picked).toContain('just this session · `/flow save` makes it your default')
  expect(store.get(sessionKey('a'))).toMatchObject({ own: { style: 'ski', time: 'night' } })
  expect(store.has('overrides')).toBe(false) // nothing shared...
  expect(seen.config).toEqual([]) // ...and /config, the defaults, untouched
  // Session B (another process on the same store) starts on the defaults, and picks its own.
  seen.session = 'b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, auto/)
  await flow($, 'bubbles')
  await flow($, 'sound on')
  // A resumed: its own back, and the status says which are its own.
  seen.session = 'a'
  await start($)
  const a = await flow($)
  expect(a.split('\n')[0]).toMatch(/^ski, auto, now \S+ \(idle glow\), night$/)
  expect(a).toContain('just this session (your default: surf, day and night by the clock) · `/flow save` makes this the default · `/flow reset` goes back')
  // B resumed: its own.
  seen.session = 'b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^bubbles, .*sound on$/)
  // A brand new session: the defaults, with nothing of its own.
  seen.session = 'c'
  await start($)
  const c = await flow($)
  expect(c.split('\n')[0]).toMatch(/^surf, auto/)
  expect(c).not.toContain('just this session')
  expect(store.has(sessionKey('c'))).toBe(false)
  expect(seen.config).toEqual([])
})

test('sessions: a /clear carries the settings on to the new conversation; a resume from inside shows the resumed one\'s own, or the defaults', async ($, on) => {
  const clock = mock.clock(on)
  const store = memoryStore(on, { [sessionKey('b')]: storedRecord({ style: 'surf', layout: 'band' }, 0) })
  const seen = engine(on)
  seen.session = 'a'
  await start($)
  await flow($, 'ski')
  // /clear: the conversation ends and the process goes on under a new id, with no session.start.
  await endSession($, 'clear', 'a')
  seen.session = 'c'
  await clock.advance(1000)
  expect(store.get(sessionKey('c'))).toMatchObject({ own: { style: 'ski' } }) // kept under the new id at once
  expect((await flow($)).split('\n')[0]).toMatch(/^ski/)
  // /resume b from inside: b's own, picked up by the next read of the id (no /flow needed).
  await endSession($, 'resume', 'c')
  seen.session = 'b'
  await clock.advance(1000)
  expect(store.get(sessionKey('b'))).toMatchObject({ own: { style: 'surf' }, at: clock.now() }) // marked used
  expect((await flow($)).split('\n')[0]).toMatch(/^surf/)
  // /resume d, which kept nothing: the defaults, as it would show started afresh.
  await endSession($, 'resume', 'b')
  seen.session = 'd'
  expect((await flow($)).split('\n')[0]).toMatch(/^fire/)
  expect(store.has(sessionKey('d'))).toBe(false)
  // c, reloaded (a /config change, an update): still its own.
  seen.session = 'c'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^ski/)
})

test('sessions: /flow save makes this session\'s settings the default (/config); /flow reset goes back to it', async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on, { blits: [], config: [], rows: {} })
  await start($)
  expect((await flow($, 'save')).split('\n\n')[0]).toBe('already your default: new sessions start this way')
  await flow($, 'surf')
  await flow($, '5')
  expect(store.get(sessionKey('session-a'))).toMatchObject({ own: { style: 'surf', mode: 'manual', level: 5 } })
  expect((await flow($, 'save')).split('\n\n')[0]).toBe('saved as your default: new sessions start with surf, holding 5/10')
  expect(seen.config).toContainEqual(['flow.style', 'surf'])
  expect(seen.config).toContainEqual(['flow.mode', 'manual'])
  expect(seen.config).toContainEqual(['flow.level', 5])
  expect(seen.config).toHaveLength(3) // only what differed
  expect(store.has(sessionKey('session-a'))).toBe(false) // nothing of its own now: it is the default
  expect(await flow($)).not.toContain('just this session')
  // Something else, then back to the default.
  await flow($, 'ski')
  expect((await flow($)).split('\n')[1]).toContain('your default: surf')
  expect((await flow($, 'reset')).split('\n\n')[0]).toBe('back to your default: surf')
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, holding 5\/10/)
  expect(store.has(sessionKey('session-a'))).toBe(false)
  expect((await flow($, 'reset')).split('\n\n')[0]).toBe('already on your default')
  // A new session starts on what was saved (/config's rows: the options a new process loads with).
  seen.session = 'session-b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, holding 5\/10/)
})

test('sessions: a /config change made in the session is the default, and that row is no longer the session\'s own', async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on)
  engine(on)
  await start($)
  await flow($, 'surf')
  await flow($, 'sound on')
  const set = $.config.set as unknown as (e: object) => Promise<unknown>
  await set({ key: 'flow.style', value: 'ski', previous: 'fire', provider: { plugin: 'flow', tier: 'user' }, origin: { kind: 'composer' } })
  expect(store.get(sessionKey('session-a'))).toEqual({ own: { sound: 'on' }, at: 0 })
  const status = await flow($)
  expect(status.split('\n')[0]).toMatch(/^ski, .*sound on$/)
  expect(status).toContain('your default: sound off')
})

test('sessions: /flow changes pending from before (shared by every session) are written to /config once and show; nothing is written at the end', async ($, on) => {
  mock.clock(on)
  const store = memoryStore(on, { overrides: { style: 'ski', idle: 'dark' } })
  const seen = engine(on)
  await start($)
  expect(seen.config).toContainEqual(['flow.style', 'ski'])
  expect(seen.config).toContainEqual(['flow.idle', 'dark'])
  expect(store.has('overrides')).toBe(false)
  const status = await flow($)
  expect(status.split('\n')[0]).toMatch(/^ski, auto, now \S+ \(idle dark\)/)
  expect(status).not.toContain('just this session') // the defaults now
  await flow($, 'surf')
  const writes = seen.config.length
  await endSession($, 'prompt_input_exit', 'session-a')
  expect(seen.config).toHaveLength(writes)
  expect(store.get(sessionKey('session-a'))).toMatchObject({ own: { style: 'surf' } })
})

test('sessions: only the most recently used are kept, none unused past two months, and always this one', async ($, on) => {
  const day = 24 * 60 * 60 * 1000
  const now = 400 * day
  const clock = mock.clock(on, { now })
  const entries: Record<string, unknown> = { tips: { scenesTold: true } }
  for (let i = 0; i < SESSIONS_KEPT + 20; i++) entries[sessionKey(`s${i}`)] = storedRecord({ style: 'surf' }, now - i * 1000)
  entries[sessionKey('old')] = storedRecord({ style: 'ski' }, now - 61 * day)
  entries[sessionKey('me')] = storedRecord({ style: 'bubbles' }, now - 300 * day) // resumed after a long while
  const store = memoryStore(on, entries)
  const seen = engine(on)
  seen.session = 'me'
  await start($)
  await clock.settle()
  const kept = [...store.keys()].filter(k => k.startsWith('session:'))
  expect(kept).toHaveLength(SESSIONS_KEPT)
  expect(kept).toContain(sessionKey('me'))
  expect(kept).toContain(sessionKey('s0'))
  expect(kept).not.toContain(sessionKey('old'))
  expect(kept).not.toContain(sessionKey(`s${SESSIONS_KEPT + 19}`))
  expect(store.has('tips')).toBe(true)
  expect((await flow($)).split('\n')[0]).toMatch(/^bubbles/)
})

test('sessions: the pure parts (differences, a move to another session, pruning, the words)', () => {
  const defaults = readConfig({ style: 'surf' })
  const cfg = withOwn(defaults, { style: 'ski', level: 3 })
  expect(cfg).toEqual({ ...defaults, style: 'ski', level: 3 })
  expect(differences(cfg, defaults)).toEqual({ style: 'ski', level: 3 })
  // A held level in auto mode doesn't show, so it isn't named as the session's own.
  expect(statusText(withOwn(defaults, { level: 3 }), 2, 'normal', { hour: 12, minute: 0 }, defaults)).not.toContain('just this session')
  expect(statusText(cfg, 2, 'normal', { hour: 12, minute: 0 }, defaults)).toContain('(your default: surf)')
  // Only the change that first sets the session apart says so.
  expect(ownHint(defaults, cfg, defaults)).toContain('/flow save')
  expect(ownHint(cfg, { ...cfg, style: 'fire' }, defaults)).toBe('')
  expect(ownHint(cfg, defaults, defaults)).toBe('')
  expect(savedText(cfg, defaults, true, ['level'])).toBe('saved as your default: new sessions start with ski  (not saved: /config refused level)')
  expect(savedText(cfg, defaults, false, ['style'])).toBe('not saved: /config refused style')
  expect(resetText({ ...defaults, sound: 'on', layout: 'spine' }, defaults)).toBe('back to your default: band, sound off')
  // Moving to another session: its own; a resumed one with none, the defaults; else (a /clear) carried on.
  const record = { own: { style: 'bubbles' as const }, at: 5 }
  expect(ownAfterSwitch(record, { style: 'ski' }, 'clear')).toEqual({ own: { style: 'bubbles' }, carried: false })
  expect(ownAfterSwitch(undefined, { style: 'ski' }, 'resume')).toEqual({ own: {}, carried: false })
  expect(ownAfterSwitch(undefined, { style: 'ski' }, 'clear')).toEqual({ own: { style: 'ski' }, carried: true })
  expect(ownAfterSwitch(undefined, {}, undefined)).toEqual({ own: {}, carried: false })
  // Stored records read back; junk is no record's own.
  expect(readRecord(storedRecord({ idle: 0, style: 'avalon' }, 7))).toEqual({ own: { idle: 0, style: 'avalon' }, at: 7 })
  expect(readRecord({ own: 'x', at: 'y' })).toEqual({ own: {}, at: 0 })
  expect(readRecord(null)).toBeUndefined()
  // Pruning: past the kept count by last use, or too old; never the one asked to keep.
  const recs = Array.from({ length: SESSIONS_KEPT + 2 }, (_, i) => ({ key: `k${i}`, at: 1000 - i }))
  expect(staleSessions(recs, 1000)).toEqual([`k${SESSIONS_KEPT}`, `k${SESSIONS_KEPT + 1}`])
  expect(staleSessions(recs, 1000, `k${SESSIONS_KEPT + 1}`)).toEqual([`k${SESSIONS_KEPT - 1}`, `k${SESSIONS_KEPT}`])
  expect(staleSessions([{ key: 'a', at: 0 }, { key: 'b', at: SESSION_KEPT_MS }], SESSION_KEPT_MS + 1)).toEqual(['a'])
  // The grammar.
  expect(parseFlowArgs('save')).toEqual({ kind: 'save' })
  expect(parseFlowArgs('reset')).toEqual({ kind: 'reset' })
  expect(parseFlowArgs('default').kind).toBe('error')
  expect(changesFor(parseFlowArgs('save'), cfg)).toBeUndefined()
  expect(helpText()).toContain('/flow save')
  expect(helpText("pi's", false)).toContain('/flow reset')
})

test('pi: a session\'s own settings are its latest flow entry on the branch', () => {
  const entry = (id: string, data: unknown, customType = 'flow') => ({ type: 'custom', id, customType, data })
  expect(ownInSession([])).toEqual({})
  expect(ownInSession([entry('1', { own: { style: 'surf' } }), { type: 'message', id: '2' }, entry('3', { own: { style: 'ski', sound: 'on' } }), entry('4', { own: {} }, 'other')])).toEqual({ style: 'ski', sound: 'on' })
  expect(ownInSession([entry('1', { own: { style: 'surf' } }), entry('2', { own: {} })])).toEqual({})
})

// ── The defaults, read afresh ────────────────────────────────────────────

/** One store and one /config, shared by every session (process) on the machine. */
type Shared = { store: Map<string, unknown>; rows: Record<string, unknown> }

/**
 * A Claude Code session in a process of its own, over the shared store and
 * /config: the plugin's `/flow` and its opening of the session, through a
 * host answering just what they call. Nothing here reloads the module when
 * /config changes: whether a host does is its own business.
 */
function sceneSession(shared: Shared, id: string) {
  const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  const $ = {
    session: { id: async () => id },
    store: {
      get: async (k: string) => json(shared.store.get(k)),
      set: async (k: string, v: unknown) => void shared.store.set(k, json(v)),
      delete: async (k: string) => void shared.store.delete(k),
      keys: async () => [...shared.store.keys()],
    },
    config: {
      list: async () => configRows(shared.rows),
      set: async ({ key, value }: { key: string; value: unknown }) => ((shared.rows[key] = value), { value }),
    },
    clock: { now: async () => 0 },
    ui: { invalidate: () => {}, open: async () => ({ isPlaced: true }), close: async () => undefined, panes: async () => [] },
  } as unknown as EngineInterface
  const driver = new SceneDriver(readConfig(undefined), new Activity())
  const ctx: SceneCtx = {
    driver,
    session: { id: undefined, defaults: readConfig(undefined), own: {}, ended: undefined, watch: 0 },
    applyLocal: changes => driver.apply(changes),
    leftSpine: () => {},
  }
  return {
    cfg: driver.cfg,
    open: () => openSession($, ctx, readConfig(undefined)),
    /** `/flow <args>`, its reply without a tip under it. */
    flow: async (args: string) => ((await runScene($, { args } as never, ctx)).text ?? '').split('\n\n')[0]!,
  }
}

test('sessions: two at once on one store and one /config: B saves, then A changes and saves exactly what it shows', async () => {
  const shared: Shared = { store: new Map(), rows: {} }
  const a = sceneSession(shared, 'a')
  const b = sceneSession(shared, 'b')
  await a.open()
  await b.open()
  await b.flow('surf')
  expect(await b.flow('save')).toBe('saved as your default: new sessions start with surf')
  expect(shared.rows['flow.style']).toBe('surf')
  expect(a.cfg.style).toBe('fire') // A carries on as it was
  // A, its defaults read afresh: it still shows the fire, its own now, and saves what it shows.
  expect(await a.flow('night')).toMatch(/^night until `\/flow clock`/)
  expect(await a.flow('save')).toBe('saved as your default: new sessions start with fire, night')
  expect(shared.rows).toMatchObject({ 'flow.style': 'fire', 'flow.time': 'night' })
  expect(a.cfg).toMatchObject({ style: 'fire', time: 'night' })
  expect(shared.store.has(sessionKey('a'))).toBe(false)
  // A new session, and A resumed: exactly as A shows.
  const c = sceneSession(shared, 'c')
  await c.open()
  expect(c.cfg).toEqual(a.cfg)
  const a2 = sceneSession(shared, 'a')
  await a2.open()
  expect(a2.cfg).toEqual(a.cfg)
  // B, still running, still shows the surf by day: its own now, and the status says the default moved.
  expect((await b.flow('')).split('\n')[1]).toBe('just this session (your default: fire, night) · `/flow save` makes this the default · `/flow reset` goes back')
  expect(b.cfg).toMatchObject({ style: 'surf', time: 'clock' })
  const b2 = sceneSession(shared, 'b')
  await b2.open()
  expect(b2.cfg).toEqual(b.cfg)
  // Reset goes to the default as it is now.
  expect(await b.flow('reset')).toBe('back to your default: fire, night')
  expect(b.cfg).toEqual(a.cfg)
})

test('sessions: the defaults changing under a running session (another one\'s save) leave it as it is, kept for a resume, with no /flow run there', async ($, on) => {
  const clock = mock.clock(on)
  const store = memoryStore(on)
  const seen = engine(on, { blits: [], config: [], rows: {} })
  seen.session = 'a'
  await start($)
  // Another session saves surf: /config's rows change under this one, which isn't reloaded.
  seen.rows!['flow.style'] = 'surf'
  await clock.advance(30_000) // read afresh every 30 s
  expect(store.get(sessionKey('a'))).toMatchObject({ own: { style: 'fire' } })
  // And when the session ends.
  seen.rows!['flow.sound'] = 'on'
  await endSession($, 'prompt_input_exit', 'a')
  expect(store.get(sessionKey('a'))).toEqual({ own: { style: 'fire', sound: 'off' }, at: clock.now() })
  // Resumed: as it was, and it says how the default differs.
  await start($)
  const status = await flow($)
  expect(status.split('\n')[0]).toMatch(/^fire, auto/)
  expect(status.split('\n')[0]).not.toContain('sound on')
  expect(status).toContain('just this session (your default: surf, sound on)')
  // A new session starts on the defaults as they are.
  seen.session = 'b'
  await start($)
  expect((await flow($)).split('\n')[0]).toMatch(/^surf, .*sound on$/)
  // Saved from the first again: /config takes all it shows, so new sessions start just so.
  seen.session = 'a'
  await start($)
  expect((await flow($, 'save')).split('\n\n')[0]).toBe('saved as your default: new sessions start with fire, sound off')
  expect(seen.rows).toMatchObject({ 'flow.style': 'fire', 'flow.sound': 'off' })
})

test('pi: two sessions on one flow.json: B saves, then A changes and saves exactly what it shows', async () => {
  let json: Record<string, unknown> = {}
  const file = {
    load: async () => readConfig(json),
    save: async (changes: Own) => {
      json = { ...json, ...storedOwn(changes) }
    },
  }
  const sessionOf = (): SessionEntries & { entries: PiSessionEntry[] } => {
    const entries: PiSessionEntry[] = []
    return { entries, branch: () => entries, keep: data => void entries.push({ type: 'custom', id: String(entries.length), customType: 'flow', data }) }
  }
  /** `/flow <args>` as the adapter runs it: flow.json read afresh first. */
  const run = async (s: PiSettings, entries: SessionEntries, args: string) => {
    await s.refresh(entries)
    const cmd = parseFlowArgs(args)
    if (cmd.kind === 'save') return (await s.save(entries)).text
    if (cmd.kind === 'reset') return s.reset(entries)
    return s.change(changesFor(cmd, s.cfg) ?? {}, entries)
  }
  const sa = sessionOf()
  const sb = sessionOf()
  const a = new PiSettings(readConfig(undefined), file)
  const b = new PiSettings(readConfig(undefined), file)
  await a.open(sa)
  await b.open(sb)
  await run(b, sb, 'surf')
  expect(await run(b, sb, 'save')).toBe('saved as your default: new sessions start with surf')
  expect(json.style).toBe('surf')
  expect(a.cfg.style).toBe('fire')
  await run(a, sa, 'night')
  expect(await run(a, sa, 'save')).toBe('saved as your default: new sessions start with fire, night')
  expect(json).toMatchObject({ style: 'fire', time: 'night' })
  expect(a.cfg).toMatchObject({ style: 'fire', time: 'night' })
  expect(ownInSession(sa.entries)).toEqual({})
  // A new session, and A resumed: exactly as A shows.
  const c = new PiSettings(readConfig(undefined), file)
  await c.open(sessionOf())
  expect(c.cfg).toEqual(a.cfg)
  const a2 = new PiSettings(readConfig(undefined), file)
  await a2.open(sa)
  expect(a2.cfg).toEqual(a.cfg)
  // B kept the surf by day as its own (for a resume too); reset goes to the default as it is now.
  await b.refresh(sb)
  expect(ownInSession(sb.entries)).toEqual({ style: 'surf', time: 'clock' })
  expect(statusText(b.cfg, 1, 'normal', { hour: 12, minute: 0 }, b.defaults)).toContain('(your default: fire, night)')
  expect(await run(b, sb, 'reset')).toBe('back to your default: fire, night')
  expect(b.cfg).toEqual(a.cfg)
  // An older pi without session entries: one set for every session, in flow.json, as before.
  const old = new PiSettings(readConfig(undefined), file)
  await old.open(undefined)
  await old.change({ style: 'ski' }, undefined)
  expect(json.style).toBe('ski')
})

test('sessions: what a session shows that the defaults no longer hold becomes its own; what it set, or shows as the default, stays as it was', () => {
  const was = readConfig(undefined)
  const now = readConfig({ style: 'surf', sound: 'on', level: 3 })
  const shown = withOwn(was, { level: 5 })
  expect(pinShown(shown, { level: 5 }, now)).toEqual({ own: { level: 5, style: 'fire', sound: 'off' }, pinned: true })
  expect(pinShown(withOwn(now, { level: 5 }), { level: 5 }, now)).toEqual({ own: { level: 5 }, pinned: false })
})

test('ski: the skier never drops out of its own cells, even with fast scenery behind it at night', async () => {
  const HAT = 0xffd23f
  const JACKET = 0xe8302c
  const PANTS = 0x1f2a50
  for (const night of [false, true]) {
    const f = makeScene('ski', 7) as ReturnType<typeof makeScene> & { skiers: { fx: number }[]; d: number }
    f.strength = 10
    f.night = night
    f.ensure(60, 5)
    for (let i = 0; i < 200; i++) f.step()
    for (let k = 0; k < 200; k++) {
      f.step()
      const g = f.grid()
      const cell = Math.round((f.skiers[0]!.fx - f.d) / 2)
      const seen = new Set<number>()
      for (let r = 0; r < 5; r++)
        for (let c = cell - 3; c <= cell + 3; c++) seen.add(g.foreground(r * 60 + c)).add(g.background(r * 60 + c))
      expect(seen.has(HAT) && seen.has(JACKET) && seen.has(PANTS)).toBe(true)
    }
  }
})


test('avalon: each strike is sent ahead of its flash by the player start-up time, once a rock', () => {
  const f = makeScene('avalon', 3) as unknown as { ensure(c: number, r: number): void; step(): void; strength: number; hits: { age: number }[]; sounds: { kind: string }[] }
  f.ensure(120, 5)
  f.strength = 10
  const sent: number[] = []
  const flashed: number[] = []
  for (let i = 0; i < 3000; i++) {
    f.step()
    for (const e of f.sounds) if (e.kind === 'hit') sent.push(i)
    f.sounds.length = 0
    // (Old flashes age out as new ones land: count the new ones by their age.)
    for (const h of f.hits) if (h.age === 0) flashed.push(i)
  }
  expect(sent.length).toBeGreaterThan(20)
  expect(sent.length).toBe(flashed.length)
  const leads = sent.map((at, n) => flashed[n]! - at)
  const want = PLAYER_LEAD_MS / 70
  for (const l of leads) expect(l >= 0 && l <= Math.ceil(want) + 1).toBe(true)
  expect(leads.filter(l => Math.abs(l - want) <= 1.5).length).toBeGreaterThan(leads.length * 0.8)
})

test('train: waits at a red signal at 1; when the work starts the horn sounds and it pulls away; its speed climbs with the level, steeply at the top; idle again, it pulls up', () => {
  const t = makeScene('train', 3) as Train
  const heard = (frames: number, level: number) => {
    t.strength = level
    const kinds: string[] = []
    for (let i = 0; i < frames; i++) {
      t.step()
      kinds.push(...t.sounds.map(e => e.kind))
      t.sounds.length = 0
    }
    return kinds
  }
  t.ensure(120, 5)
  heard(60, 1)
  expect(t.standing).toBe(true)
  expect(heard(40, 5)).toContain('horn')
  expect(t.standing).toBe(false)
  // Each level runs faster than the one below, the top far faster than the middle.
  const speeds: number[] = []
  for (const level of [2, 3, 5, 7, 8, 9, 10]) {
    heard(400, level)
    speeds.push(t.speed)
  }
  for (let i = 1; i < speeds.length; i++) expect(speeds[i]!).toBeGreaterThan(speeds[i - 1]!)
  expect(speeds.at(-1)!).toBeGreaterThan(speeds[2]! * 5)
  // From a stand to the top in a sensible time (a train gathers speed; not a minute of it).
  heard(3000, 1)
  expect(t.standing).toBe(true)
  heard(12, 10)
  heard(170, 10)
  expect(t.speed).toBeGreaterThan(speeds.at(-1)! * 0.95)
  // The work done, it slows and comes to a stand, and stays there.
  heard(3000, 1)
  expect(t.standing).toBe(true)
  expect(t.speed).toBe(0)
})

test('train: subagents run alongside, drawing up from out of sight, and fall back out of it when they finish', () => {
  for (const [columns, rows] of [[160, 5], [22, 60]] as const) {
    const t = makeScene('train', 4) as Train
    t.strength = 6
    t.ensure(columns, rows)
    for (let i = 0; i < 20; i++) t.step()
    t.coverageBoost = 30
    for (let i = 0; i < 4; i++) t.step()
    expect(t.company).toBe(0) // still out of sight: nothing pops in
    for (let i = 0; i < 600; i++) t.step()
    expect(t.company).toBe(2)
    t.coverageBoost = 0
    for (let i = 0; i < 600; i++) t.step()
    expect(t.company).toBe(0)
  }
})
