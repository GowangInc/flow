// REVISION: flow-v123-train-faster
//
// Soundscapes. Claude Code's `$.audio.play` plays a clip (macOS `afplay`) at a
// gain set when it starts; it can't loop smoothly or change a clip as it
// plays. So nothing loops:
//
// - A bed: one stream a scene. Claude Code plays at most four clips at once
//   for a plugin (it refuses the fifth), so a scene's layers (`LAYERS`, each
//   tuned against real recordings) are mixed ahead, by scripts/make-sounds.ts,
//   into one take for each of its moods (`MOODS`: a band of the level, the
//   balloon's burner, a rocket's phase). Long takes (BED_MS), each crossfading
//   into the next (`bedStep`); when the mood or the level changes, a fresh take
//   crossfades in rather than wait for the next. That leaves two plays at least
//   for events.
// - Events: what happens on screen (a stage separating, a sonic boom, the
//   catch, splashdown) plays its clip at once (`EVENTS`); small, dense ones
//   (a bubble bursting, a spark) are synthesized here and gathered a quarter
//   second at a time into one clip (`burst`), each at its moment.
//
// Pure: no engine imports, unit-tested directly.

import { Rng, toBase64 } from './cells'
import { BED_GAINS, SOUND_FILES } from './sound-files'
import type { Tint } from './styles'

const RATE = 22050
const TAU = Math.PI * 2

/**
 * A bed take's length, and the crossfade at each end. A layer's next take
 * starts as the one playing begins to fade (BED_EVERY_MS after it), up to
 * half a second sooner at random (BED_MIN_MS) so no seam keeps a beat: the
 * overlap only grows, never opens a gap, though a clip starts on the first
 * frame after it's due and afplay takes a moment to start.
 */
export const BED_MS = 14000
export const BED_FADE_MS = 3000
export const BED_EVERY_MS = BED_MS - BED_FADE_MS
export const BED_MIN_MS = BED_EVERY_MS - 500
/** The most clips Claude Code plays at once for a plugin: it refuses another. */
export const MAX_PLAYS = 4

/** How many takes each mood's bed has (a take never follows the one before it). */
export const BED_TAKES = 3

/**
 * How long afplay takes to start a clip (it loads its frameworks first): about
 * a third of a second, plus the frame before the loop sees the event. A scene
 * that can see a moment coming (a rock about to strike) sends its sound this
 * far ahead, in frames (`leadFrames`), so it lands on the flash.
 */
export const PLAYER_LEAD_MS = 380

/** How long afplay holds its place in the player after its clip ends (draining) before it exits. */
export const PLAYER_DRAIN_MS = 900

/** The most events a scene holds for the adapter to take each frame (one that never takes them stays bounded). */
export const EVENTS_HELD = 16

/** Pushes an event onto a scene's queue unless it's full. */
export function hear(queue: SoundEvent[], e: SoundEvent): void {
  if (queue.length < EVENTS_HELD) queue.push(e)
}

/** PLAYER_LEAD_MS in frames at a scene's pace (SceneDriver.pace: 70 ms a frame, 125 when calm). */
export function leadFrames(strength: number, tint: Tint): number {
  return PLAYER_LEAD_MS / (strength <= 1 && tint === 'normal' ? 125 : 70)
}

/** Something that happened on screen, to be heard: what, and how big (0..1). */
export type SoundKind =
  | 'pop' // a bubble bursting
  | 'crack' // a spark off the fire
  | 'hit' // a rock blowing up on the shield
  | 'chuff' // the steam engine's exhaust
  | 'clank' // the trip hammer falling
  | 'ignite' // a rocket lighting up on the pad
  | 'sep' // stages separating
  | 'boom' // the Ship's end at sea
  | 'splash' // coming down in the sea
  | 'clang' // the chopsticks closing on a booster
  | 'sonic' // a returning booster's sonic boom
  | 'chute' // parachutes opening
  | 'thud' // touching down on legs
  | 'crash' // a wave breaking
  | 'lap' // a small wave on a calm sea
  | 'swish' // a ski turn
  | 'horn' // a train's horn: pulling away, or before a level crossing
export type SoundEvent = { kind: SoundKind; v: number }

/** What a scene is doing now, for its bed: each 0..1 (a scene reports the ones it has). */
export type Ambience = {
  /** Engines burning: a rocket's throttle, out of orbit. */
  roar?: number
  /** Fuel venting on the pad. */
  vent?: number
  /** Air rushing past: falling, climbing, carving. */
  wind?: number
  /** In orbit: near silence. */
  space?: number
  /** A balloon's burner lit. */
  burner?: number
  /** Down in the sea (a capsule or a Ship), or carried over it. */
  sea?: number
  /** The swell, and a wave's lip pitching over. */
  swell?: number
  curl?: number
}

/** Everything a clip is drawn from. */
export type SoundMood = { scene: string; level: number; tint: Tint; night: boolean; amb: Ambience }

/** A clip being drawn: samples, and the tools the recipes mix with. */
class Mix {
  readonly buf: Float32Array
  readonly rng: Rng
  readonly n: number
  constructor(seconds: number, seed: number) {
    this.n = Math.max(1, Math.floor(seconds * RATE))
    this.buf = new Float32Array(this.n)
    // (Seeds come from a counter, and xorshift's first draws from neighbouring
    // seeds climb together: hash it, or every burst's pops would drift in pitch
    // in a slow sawtooth.)
    this.rng = new Rng(Math.floor(unit(seed) * 4294967296))
    for (let i = 0; i < 4; i++) this.rng.int()
  }

  white(): number {
    return this.rng.f() * 2 - 1
  }

  /** Filtered noise across the clip: `lo` low-passes, `hi` takes off what's under it (one-pole coefficients); `amp(t)` shapes it. */
  noise(lo: number, hi: number, amp: (t: number) => number, from = 0, to = this.n): void {
    let a = 0
    let b = 0
    for (let i = from; i < to; i++) {
      const w = this.white()
      a += lo * (w - a)
      b += hi * (a - b)
      this.buf[i]! += (a - b) * amp((i - from) / RATE)
    }
  }

  /** A resonant band of noise (a 2-pole filter), its centre `hz(t)`, sharpness `q`. */
  ring(hz: (t: number) => number, q: number, amp: (t: number) => number): void {
    let y1 = 0
    let y2 = 0
    const r = 1 - 1 / q
    for (let i = 0; i < this.n; i++) {
      const t = i / RATE
      const c = 2 * r * Math.cos((TAU * hz(t)) / RATE)
      const y = this.white() * (1 - r) + c * y1 - r * r * y2
      y2 = y1
      y1 = y
      this.buf[i]! += y * amp(t)
    }
  }

  /** A tone gliding by `hz(t)`, shaped by `amp(t)` (phase kept continuous through the glide). */
  tone(hz: (t: number) => number, amp: (t: number) => number, from = 0, len = this.n / RATE): void {
    let ph = this.rng.f() * TAU
    const i1 = Math.min(this.n, from + Math.floor(len * RATE))
    for (let i = from; i < i1; i++) {
      const t = (i - from) / RATE
      ph += (TAU * hz(t)) / RATE
      this.buf[i]! += Math.sin(ph) * amp(t)
    }
  }

  /** An event's voice at `at` seconds, `len` long: `voice(dt)` per sample. */
  at(at: number, len: number, voice: (dt: number) => number): void {
    const i0 = Math.floor(at * RATE)
    const i1 = Math.min(this.n, i0 + Math.floor(len * RATE))
    for (let i = Math.max(0, i0); i < i1; i++) this.buf[i]! += voice((i - i0) / RATE)
  }

  /** `per` events a second scattered through the clip. */
  sprinkle(per: number, len: number, voice: (dt: number, x: number) => number): void {
    const seconds = this.n / RATE
    const count = Math.floor(per * seconds + this.rng.f())
    for (let j = 0; j < count; j++) {
      const x = this.rng.f()
      this.at(this.rng.f() * seconds, len, dt => voice(dt, x))
    }
  }

  /** Faded in and out over `fade` seconds (equal power), soft-clipped, as base64 WAV. */
  wav(fade: number): string {
    const b = this.buf
    const f = Math.floor(fade * RATE)
    for (let i = 0; i < f && i < this.n; i++) {
      const k = Math.sin(((i / f) * Math.PI) / 2)
      b[i]! *= k
      b[this.n - 1 - i]! *= k
    }
    const out = new Uint8Array(44 + this.n * 2)
    const v = new DataView(out.buffer)
    const str = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i)
    }
    str(0, 'RIFF')
    v.setUint32(4, 36 + this.n * 2, true)
    str(8, 'WAVE')
    str(12, 'fmt ')
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
    v.setUint16(22, 1, true)
    v.setUint32(24, RATE, true)
    v.setUint32(28, RATE * 2, true)
    v.setUint16(32, 2, true)
    v.setUint16(34, 16, true)
    str(36, 'data')
    v.setUint32(40, this.n * 2, true)
    // Soft clipping: loud stays loud without the harshness of a hard limit.
    for (let i = 0; i < this.n; i++) v.setInt16(44 + i * 2, Math.tanh(b[i]! * 1.4) * 0.92 * 32767, true)
    return toBase64(out)
  }
}

const decay = (dt: number, tau: number) => Math.exp(-dt / tau)

/** A clip to play and how loud (linear gain, 0..4). */
export type Play = { asset: string; gain: number }

/** One layer of a scene's bed: a clip with `variants` takes, at a gain from the mood (`s`: the level, 0..1). */
type Layer = { clip: string; variants: number; gain: (s: number, m: SoundMood) => number }

/** A rocket's bed: venting on the pad, the roar and its crackle (deeper for Starship), wind on the way down, the quiet of orbit. */
const rocketLayers = (roar: string): Layer[] => [
  { clip: roar, variants: BED_TAKES, gain: (s, m) => 1.0 * (m.amb.roar ?? 0) * (1 - 0.85 * (m.amb.space ?? 0)) },
  { clip: 'rocket/crackle', variants: BED_TAKES, gain: (s, m) => 1.0 * (m.amb.roar ?? 0) * (1 - (m.amb.space ?? 0)) },
  { clip: 'rocket/vent', variants: BED_TAKES, gain: (s, m) => 0.16 * (m.amb.vent ?? 0) },
  { clip: 'rocket/wind', variants: BED_TAKES, gain: (s, m) => 0.8 * (m.amb.wind ?? 0) },
  { clip: 'rocket/space', variants: BED_TAKES, gain: (s, m) => ((m.amb.space ?? 0) > 0.3 ? 0.35 * (m.amb.space ?? 0) : 0) },
  { clip: 'surf/wash', variants: BED_TAKES, gain: (s, m) => 0.5 * (m.amb.sea ?? 0) },
]

/**
 * Each scene's master volume by level (`s`, 0..1), so every scene sits on the
 * same loudness curve as heard on a laptop (A-weighted, the speakers' bass
 * roll-off counted): about -36 dB at level 1, -28 at 5, -22 at 10. Applied to
 * its bed, its events and its bursts.
 */
const MASTER: Record<string, (s: number) => number> = {
  fire: () => 1.2,
  warp: s => 0.5 + 0.7 * s,
  avalon: s => 0.45 + 1.35 * s,
  balloon: s => 0.6 + 1.1 * s,
  engine: () => 0.5,
  falcon: () => 1.3,
  starship: () => 1.3,
  surf: s => 0.25 + 0.6 * s,
  ski: () => 1.4,
  bubbles: s => 1 - 1.1 * Math.max(0, s - 0.5),
  train: s => 0.2 + 0.38 * Math.sqrt(s),
}

/** A scene's master volume at a level (0..10). */
export function master(scene: string, level: number): number {
  return (MASTER[scene] ?? (() => 1))(Math.max(0, Math.min(1, level / 10)))
}

/** Each scene's bed, as layers of clips. */
export const LAYERS: Record<string, Layer[]> = {
  fire: [
    // Flames licking, crackle thickening with the level (three densities crossfading), a roar from 7 up.
    { clip: 'fire/flames', variants: BED_TAKES, gain: s => 0.1 + 0.32 * s * s },
    { clip: 'fire/crackleLo', variants: BED_TAKES, gain: s => 0.6 * Math.max(0, 1 - Math.abs(s - 0.1) / 0.35) },
    { clip: 'fire/crackleMid', variants: BED_TAKES, gain: s => 0.9 * Math.max(0, 1 - Math.abs(s - 0.5) / 0.35) },
    { clip: 'fire/crackleHi', variants: BED_TAKES, gain: s => 0.85 * Math.max(0, 1 - Math.abs(s - 0.9) / 0.35) },
    { clip: 'fire/roar', variants: BED_TAKES, gain: s => (s > 0.6 ? (s - 0.6) * 1.5 : 0) },
  ],
  surf: [
    // The wash, fuller as the swell builds; foam hissing on top of a big sea (each wave is an event).
    { clip: 'surf/wash', variants: BED_TAKES, gain: (s, m) => 0.5 - 0.2 * (m.amb.swell ?? s) },
    { clip: 'surf/rumble', variants: BED_TAKES, gain: (s, m) => 0.6 * (m.amb.swell ?? s) * (m.amb.swell ?? s) },
    { clip: 'surf/foam', variants: BED_TAKES, gain: (s, m) => 0.07 + 0.16 * (m.amb.swell ?? s) * (m.amb.swell ?? s) },
  ],
  bubbles: [
    // A fizz throughout; the boil coming up from 5; big bubbles gloop-ing at the top (each bubble bursting is an event).
    { clip: 'bubbles/water', variants: BED_TAKES, gain: s => 0.045 + 0.08 * s },
    { clip: 'bubbles/fizz', variants: BED_TAKES, gain: s => 0.12 + 0.3 * s },
    { clip: 'bubbles/boil', variants: BED_TAKES, gain: s => (s > 0.4 ? (s - 0.4) * 1.3 : 0) },
    { clip: 'bubbles/gloop', variants: BED_TAKES, gain: s => (s > 0.6 ? (s - 0.6) * 1.6 : 0) },
  ],
  engine: [
    // The machinery's rumble and the gears' chatter rising with the speed, a steam leak hissing (each chuff and the hammer are events).
    { clip: 'engine/rumble', variants: BED_TAKES, gain: s => 0.05 + 0.17 * s },
    { clip: 'engine/whir', variants: BED_TAKES, gain: s => 0.08 + 0.42 * s },
    { clip: 'engine/hiss', variants: BED_TAKES, gain: s => 0.06 + 0.12 * s },
    { clip: 'engine/gears', variants: BED_TAKES, gain: s => (s > 0.15 ? 0.05 + 0.3 * s : 0) },
  ],
  balloon: [
    // Wind stronger the higher it is (the level is its altitude), the burner while it's lit, birdsong down near the grass.
    { clip: 'balloon/wind', variants: BED_TAKES, gain: s => 0.12 + 0.45 * s },
    { clip: 'balloon/burner', variants: BED_TAKES, gain: (s, m) => 0.55 * (m.amb.burner ?? 0) },
    { clip: 'balloon/birds', variants: BED_TAKES, gain: s => (s < 0.45 ? 0.45 - s : 0) * 0.55 },
  ],
  ski: [
    // The glide and the wind both rising with speed (each turn's swish is an event).
    { clip: 'ski/glide', variants: BED_TAKES, gain: (s, m) => 0.14 + 0.3 * (m.amb.wind ?? s) },
    { clip: 'ski/wind', variants: BED_TAKES, gain: (s, m) => 0.2 + 0.45 * (m.amb.wind ?? s) },
  ],
  avalon: [
    // The hull's hum and the air handlers always; the shield fizzing more as the rocks come faster (each hit is an event).
    // (The hum backs off as the rocks come faster: their booms carry the level, and need room.)
    { clip: 'avalon/hum', variants: BED_TAKES, gain: s => 0.55 * (1 - 0.5 * s) },
    { clip: 'avalon/air', variants: BED_TAKES, gain: s => 0.12 + 0.1 * s },
    { clip: 'avalon/shield', variants: BED_TAKES, gain: s => 0.03 + 0.22 * s },
  ],
  warp: [
    // The drive's pitch rising through three speeds (crossfading), the rush sweeping faster, the stars glinting by.
    { clip: 'warp/drive1x', variants: BED_TAKES, gain: s => 0.6 * Math.max(0, 1 - Math.abs(s - 0.1) / 0.4) },
    { clip: 'warp/drive2x', variants: BED_TAKES, gain: s => 0.6 * Math.max(0, 1 - Math.abs(s - 0.5) / 0.4) },
    { clip: 'warp/drive3x', variants: BED_TAKES, gain: s => 0.65 * Math.max(0, 1 - Math.abs(s - 0.9) / 0.4) },
    { clip: 'warp/rush1', variants: BED_TAKES, gain: s => 0.25 * Math.max(0, 1 - Math.abs(s - 0.1) / 0.4) },
    { clip: 'warp/rush2', variants: BED_TAKES, gain: s => 0.4 * Math.max(0, 1 - Math.abs(s - 0.5) / 0.4) },
    { clip: 'warp/rush3', variants: BED_TAKES, gain: s => 0.55 * Math.max(0, 1 - Math.abs(s - 0.9) / 0.4) },
    { clip: 'warp/glints', variants: BED_TAKES, gain: s => 0.1 + 0.4 * s },
  ],
  falcon: rocketLayers('rocket/roar'),
  starship: rocketLayers('starship/roar'),
  train: [
    // The wheels' roll and the wind past it both rising with speed (0 standing); the diesel idling while it
    // waits, working as it runs, flat out at the top (three pitches, crossfading); the open air while it
    // stands (the horn is an event).
    { clip: 'train/rumble', variants: BED_TAKES, gain: (s, m) => ((m.amb.wind ?? s) > 0 ? 0.25 + 0.75 * (m.amb.wind ?? s) : 0) },
    { clip: 'train/rush', variants: BED_TAKES, gain: (s, m) => 0.55 * (m.amb.wind ?? s) ** 2 },
    { clip: 'train/air', variants: BED_TAKES, gain: (s, m) => ((m.amb.wind ?? s) > 0 ? 0.05 : 0.18) },
    { clip: 'train/drone1', variants: BED_TAKES, gain: (s, m) => 0.6 * Math.max(0, 1 - (m.amb.wind ?? s) / 0.3) },
    { clip: 'train/drone2', variants: BED_TAKES, gain: (s, m) => 0.35 * Math.max(0, 1 - Math.abs((m.amb.wind ?? s) - 0.42) / 0.32) },
    { clip: 'train/drone3', variants: BED_TAKES, gain: (s, m) => 0.35 * Math.max(0, 1 - Math.abs((m.amb.wind ?? s) - 0.88) / 0.3) },
  ],
}

/** Events with a clip of their own (`sounds/<clip>.m4a`), and how loud by their size. */
export const EVENTS: Partial<Record<SoundKind, { clip: string; variants: number; gain: (v: number) => number }>> = {
  ignite: { clip: 'events/ignite', variants: 1, gain: () => 1 },
  sep: { clip: 'events/sep', variants: 1, gain: () => 0.9 },
  sonic: { clip: 'events/sonic', variants: 1, gain: () => 1 },
  boom: { clip: 'events/boom', variants: 1, gain: () => 1 },
  splash: { clip: 'events/splash', variants: 1, gain: v => 0.5 + 0.5 * v },
  thud: { clip: 'events/thud', variants: 1, gain: () => 0.8 },
  chute: { clip: 'events/chute', variants: 1, gain: () => 0.7 },
  clang: { clip: 'events/clang', variants: 3, gain: () => 0.8 },
  crash: { clip: 'events/wave', variants: 3, gain: v => 0.3 + 0.9 * v },
  chuff: { clip: 'events/chuff', variants: 3, gain: v => 0.6 + 0.9 * v },
  hit: { clip: 'events/blast', variants: 3, gain: v => 1.1 + 0.2 * v },
  swish: { clip: 'events/swish', variants: 3, gain: v => 0.25 + 0.6 * v },
  clank: { clip: 'events/clank', variants: 1, gain: v => 0.25 + 0.35 * v },
  lap: { clip: 'events/lap', variants: 3, gain: v => 0.35 + 0.6 * v },
  horn: { clip: 'events/horn', variants: 3, gain: v => 0.35 + 0.6 * v },
}

/** A clip's file: one of its variants, picked by a hash of the moment and the clip (no fixed rotation to fall in step with). */
function asset(clip: string, variants: number, seed: number): string {
  if (variants <= 1) return `sounds/${clip}.m4a`
  let h = 2166136261
  for (let i = 0; i < clip.length; i++) h = Math.imul(h ^ clip.charCodeAt(i), 16777619)
  return `sounds/${clip}${1 + Math.floor(unit(seed ^ h) * variants)}.m4a`
}

/** A bed's mood: its key, and the level (0..1) and doings its mix is made for. */
export type BedMood = { key: string; s: number; amb: Ambience }

/** The bands of the level a bed is mixed for, and the level each band's mix is made at. */
export const BAND_S = [0.15, 0.42, 0.68, 0.92] as const
const band = (level: number): number => (level < 3 ? 0 : level < 5.5 ? 1 : level < 8 ? 2 : 3)
const byLevel = (m: SoundMood): BedMood => {
  const b = band(m.level)
  return { key: `l${b}`, s: BAND_S[b]!, amb: {} }
}
const on = (x: number | undefined, at = 0.5): number => ((x ?? 0) >= at ? 1 : 0)
const rocketMood = (m: SoundMood): BedMood => {
  const a = m.amb
  const r = on(a.roar, 0.3)
  const sp = on(a.space)
  const v = on(a.vent)
  const w = (a.wind ?? 0) < 0.2 ? 0 : (a.wind ?? 0) < 0.7 ? 1 : 2
  const e = on(a.sea)
  return { key: `r${r}s${sp}v${v}w${w}e${e}`, s: 0.5, amb: { roar: r, space: sp, vent: v, wind: [0, 0.45, 1][w], sea: e } }
}

/** Each scene's moods: which one this moment is in (scripts/make-sounds.ts mixes a bed for every one a scene reaches). */
export const MOODS: Record<string, (m: SoundMood) => BedMood> = {
  fire: byLevel,
  warp: byLevel,
  avalon: byLevel,
  engine: byLevel,
  bubbles: byLevel,
  surf: byLevel,
  ski: m => {
    const b = band(10 * (m.amb.wind ?? m.level / 10))
    return { key: `w${b}`, s: BAND_S[b]!, amb: { wind: BAND_S[b] } }
  },
  // The train by its speed (amb.wind: the level that runs at it), standing still its own mood.
  train: m => {
    const w = m.amb.wind ?? m.level / 10
    if (w < 0.02) return { key: 'v0', s: 0, amb: { wind: 0 } }
    const b = band(10 * w)
    return { key: `v${b + 1}`, s: BAND_S[b]!, amb: { wind: BAND_S[b] } }
  },
  balloon: m => {
    const b = band(m.level)
    const u = on(m.amb.burner)
    return { key: `l${b}b${u}`, s: BAND_S[b]!, amb: { burner: u } }
  },
  falcon: rocketMood,
  starship: rocketMood,
}

/** A layer's gain in a mood's mix (the mix is made at these, before the scene's master volume). */
export function layerGain(scene: string, layer: number, mood: BedMood): number {
  const l = LAYERS[scene]?.[layer]
  return l ? l.gain(mood.s, { scene, level: mood.s * 10, tint: 'normal', night: false, amb: mood.amb }) : 0
}

/** The moods each scene's beds were mixed for (the manifest's), so a moment never asks for one there isn't. */
const MIXED = new Map<string, string[]>()
for (const k of Object.keys(BED_GAINS)) {
  const [scene, key] = k.split('/') as [string, string]
  MIXED.set(scene, [...(MIXED.get(scene) ?? []), key])
}

/** The mixed mood nearest `key` (keys are a letter and a digit each; the one differing least). */
function nearest(scene: string, key: string): string | undefined {
  const keys = MIXED.get(scene)
  if (!keys?.length) return undefined
  if (keys.includes(key)) return key
  const digits = (k: string) => [...k].filter(c => c >= '0' && c <= '9').map(Number)
  const want = digits(key)
  let best = keys[0]!
  let cost = Infinity
  for (const k of keys) {
    const d = digits(k)
    const c = d.length === want.length ? d.reduce((a, x, i) => a + Math.abs(x - want[i]!), 0) : Infinity
    if (c < cost) [best, cost] = [k, c]
  }
  return best
}

/** The clips of a scene's bed for this moment (none for a scene without one: it's silent). */
export function bedPlays(mood: SoundMood, seed: number): Play[] | undefined {
  if (!bedLayers(mood.scene)) return undefined
  const p = bedPlay(mood, 0, seed)
  return p ? [p] : []
}

/** The scene's bed's next take for this mood (undefined when it's silent now), never one of those in `not`. */
export function bedPlay(mood: SoundMood, _stream: number, seed: number, not: string[] = []): Play | undefined {
  const spec = MOODS[mood.scene]
  const key = spec && nearest(mood.scene, spec(mood).key)
  if (!key) return undefined
  const gain = master(mood.scene, mood.level) * (BED_GAINS[`${mood.scene}/${key}`] ?? 0)
  if (gain <= 0.01) return undefined
  let a = asset(`${mood.scene}/bed-${key}`, BED_TAKES, seed)
  for (let k = 1; not.includes(a) && k < 64; k++) a = asset(`${mood.scene}/bed-${key}`, BED_TAKES, seed + k * 7919)
  return { asset: a, gain: Math.min(1.4, gain) }
}

/** How many bed streams a scene has: one, or none (silent). */
export function bedLayers(scene: string): number {
  return MIXED.has(scene) ? 1 : 0
}

/** When a layer's next take is due after this one: BED_MIN_MS to BED_EVERY_MS, at random. */
export function bedGap(seed: number): number {
  const h = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0
  return BED_MIN_MS + ((h >>> 8) % (BED_EVERY_MS - BED_MIN_MS + 1))
}

/** A bed's take playing now: its clip and gain, when it started, when the next is due, the take it's replacing (stopped `hold` ms in: once this one has faded in, or sooner when the old one is the louder), and from when it plays alone. */
export type BedTake = { id: number; asset: string; gain: number; at: number; due: number; retire?: number; hold: number; alone: number }

/**
 * One frame of a scene's bed: which takes to start (`play`, each with an id
 * for stopping it later) and which to stop. `takes` is the caller's, kept
 * between frames (one slot a layer). A layer renews as its take fades; it
 * starts afresh when its gain has moved by more than 3 dB (at most once a
 * crossfade), the old take stopped when the new one is in (sooner when the
 * level fell, so it falls promptly); it stops when it
 * falls silent (a rocket's engines cutting off, the burner's valve closing).
 */
export function bedStep(
  takes: (BedTake | undefined)[],
  mood: SoundMood,
  clock: number,
  seed: number,
): { play: (Play & { id: number })[]; stop: number[] } {
  const play: (Play & { id: number })[] = []
  const stop: number[] = []
  for (let i = 0; i < bedLayers(mood.scene); i++) {
    const t = takes[i]
    if (t?.retire !== undefined && clock - t.at >= t.hold) {
      stop.push(t.retire)
      t.retire = undefined
    }
    const want = bedPlay(mood, i, seed * 32 + i, t ? [t.asset] : [])
    if (!want) {
      if (t) stop.push(t.id, ...(t.retire !== undefined ? [t.retire] : []))
      takes[i] = undefined
      continue
    }
    const due = !t || clock >= t.due
    const mix = (asset: string) => asset.replace(/\d\.m4a$/, '')
    // (Only once the take before has gone, so the bed never holds more than two of the player's few plays.)
    const moved = !!t && clock >= t.alone && clock - t.at >= BED_FADE_MS && (mix(want.asset) !== mix(t.asset) || want.gain > t.gain * 1.4 || want.gain < t.gain / 1.4)
    if (!due && !moved) continue
    const id = seed * 32 + i
    const from = t && !moved ? t.due : clock
    const hold = moved && want.gain < t!.gain ? BED_FADE_MS / 3 : BED_FADE_MS
    // (A take holds its place in the player till afplay exits: stopped, a moment after; played out, its drain after.)
    const alone = moved ? clock + hold + 100 : t ? t.at + BED_MS + PLAYER_DRAIN_MS : clock
    takes[i] = { id, asset: want.asset, gain: want.gain, at: clock, due: Math.max(clock + BED_MIN_MS, from + bedGap(id)), retire: moved ? t!.id : undefined, hold, alone }
    play.push({ ...want, id })
  }
  return { play, stop }
}

/** An event's clip at the scene's volume, or undefined when it's synthesized (gathered into a `burst`). */
export function eventPlay(e: SoundEvent, seed: number, scene: string, level: number): Play | undefined {
  const c = EVENTS[e.kind]
  // (Clips peak near full scale and afplay's gain multiplies: past ~1.4 it clips.)
  return c && { asset: asset(c.clip, c.variants, seed), gain: Math.min(1.4, c.gain(e.v) * master(scene, level)) }
}

/** Each event's voice: how long it rings, and its sound. */
const VOICES: Record<SoundKind, { len: number; voice: (m: Mix, dt: number, v: number, x: number) => number }> = {
  pop: {
    // A bubble bursting rings at its resonance (lower for a bigger one), the pitch rising as it dies away.
    len: 0.08,
    voice: (m, dt, v, x) => {
      const f = (650 + 2400 * (1 - v) * (1 - v)) * (0.65 + 0.7 * x)
      const tau = 7 / f
      return Math.sin(TAU * f * dt * (1 + 0.35 * (1 - Math.exp(-dt / tau)))) * decay(dt, tau) * (0.2 + 0.12 * v)
    },
  },
  crack: { len: 0.03, voice: (m, dt, v) => m.white() * decay(dt, 0.0025) * (0.12 + 0.12 * v) },
  hit: {
    len: 0.35,
    voice: (m, dt, v) => Math.sin(TAU * (1100 - 1800 * dt) * dt) * decay(dt, 0.08) * (0.3 + 0.3 * v) + m.white() * decay(dt, 0.03) * 0.25 * (0.5 + v),
  },
  chuff: { len: 0.25, voice: (m, dt, v) => m.white() * decay(dt, 0.06) * Math.min(1, dt * 120) * (0.4 + 0.3 * v) },
  clank: { len: 0.3, voice: (m, dt) => (Math.sin(TAU * 620 * dt) + 0.7 * Math.sin(TAU * 1013 * dt) + 0.4 * Math.sin(TAU * 1720 * dt)) * decay(dt, 0.07) * 0.18 },
  ignite: { len: 2.2, voice: (m, dt) => m.white() * Math.min(1, dt / 1.2) * decay(Math.max(0, dt - 1.4), 0.35) * 0.7 },
  sep: { len: 0.9, voice: (m, dt) => Math.sin(TAU * 58 * dt) * decay(dt, 0.25) * 0.7 + m.white() * decay(dt, 0.02) * 0.5 },
  boom: { len: 1.8, voice: (m, dt) => (Math.sin(TAU * 42 * dt) * 0.7 + m.white() * 0.8) * decay(dt, 0.45) * Math.min(1, dt * 40) },
  splash: { len: 1.0, voice: (m, dt) => m.white() * decay(dt, 0.25) * Math.min(1, dt * 30) * 0.6 },
  clang: {
    len: 0.9,
    voice: (m, dt) => (Math.sin(TAU * 310 * dt) + 0.8 * Math.sin(TAU * 467 * dt) + 0.5 * Math.sin(TAU * 791 * dt)) * decay(dt, 0.22) * 0.3,
  },
  chute: { len: 0.5, voice: (m, dt) => m.white() * Math.sin(Math.PI * Math.min(1, dt / 0.5)) * 0.35 },
  thud: { len: 0.4, voice: (m, dt) => Math.sin(TAU * 70 * dt) * decay(dt, 0.1) * 0.6 + m.white() * decay(dt, 0.015) * 0.3 },
  sonic: { len: 1.2, voice: (m, dt) => (dt < 0.14 ? 1 - dt / 0.07 : 0) * 0.8 + m.white() * decay(dt, 0.4) * 0.3 },
  lap: { len: 1.6, voice: (m, dt, v) => m.white() * Math.min(1, dt / 0.6) * decay(dt, 0.5) * (0.15 + 0.2 * v) },
  crash: { len: 1.6, voice: (m, dt, v) => m.white() * Math.min(1, dt / 0.15) * decay(dt, 0.45) * (0.35 + 0.35 * v) },
  swish: { len: 0.35, voice: (m, dt, v) => m.white() * Math.sin(Math.PI * Math.min(1, dt / 0.35)) * (0.15 + 0.25 * v) },
  horn: { len: 1.2, voice: (m, dt) => (Math.sin(TAU * 311 * dt) + Math.sin(TAU * 370 * dt) + Math.sin(TAU * 466 * dt)) * Math.min(1, dt / 0.04) * Math.min(1, (1.2 - dt) / 0.1) * 0.15 },
}

/** A number in [0, 1) from a seed, scattered (neighbouring seeds land far apart). */
export function unit(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 2654435761)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

/** The most events one burst draws. */
export const BURST_MAX = 96

/**
 * Gathers an event into the next burst: once it's full, each newcomer takes a
 * random place (the `seen`th of the window, seen counting from 0), so a busy
 * scene's burst is a sample from across the window, not its first moment
 * (which would flutter at the burst rate).
 */
export function gather<T>(queue: T[], seen: number, e: T, seed: number): void {
  const h = unit(seed)
  if (queue.length < BURST_MAX) {
    queue.push(e)
    return
  }
  const j = Math.floor(h * (seen + 1))
  if (j < BURST_MAX) queue[j] = e
}

/** The events gathered over a moment, each at its offset (seconds), drawn into one clip. */
export function burst(events: readonly (SoundEvent & { offset: number })[], seed: number): string | undefined {
  if (!events.length) return undefined
  let end = 0
  for (const e of events) end = Math.max(end, e.offset + VOICES[e.kind].len)
  const m = new Mix(end, seed)
  for (const e of events) {
    const { len, voice } = VOICES[e.kind]
    const x = m.rng.f()
    m.at(e.offset, len, dt => voice(m, dt, e.v, x))
  }
  return m.wav(0.005)
}
