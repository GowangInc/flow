// REVISION: flow-v118-one-bed
//
// Builds the soundscapes' clips into sounds/ (AAC, mono 22.05 kHz) and the
// manifest hooks/sound-files.ts. Each recipe makes a WAV with sox (and Node,
// for what sox can't: sparse impulses, N-waves), tuned against real
// recordings (see AGENTS.md: measure, compare, adjust). A scene's bed layers
// stay in .sound-cache/; what ships is one mix of them for each mood the scene
// reaches (sound.ts's MOODS, found by running the scene), BED_MS long with
// crossfades at both ends, since Claude Code plays at most four clips at once.
// Events are one-shots. Not part of the mod (Node): it needs sox and ffmpeg.
//
//   npm run sounds            every scene
//   npm run sounds -- fire    just these folders

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BED_EVERY_MS, BED_MS, BED_TAKES, type BedMood, LAYERS, layerGain, master, MOODS } from '../hooks/sound'
import { makeScene } from '../hooks/styles'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'sounds')
const CACHE = join(ROOT, '.sound-cache')
const RATE = 22050
const LEN = BED_MS / 1000
const XF = (BED_MS - BED_EVERY_MS) / 1000
/** The crossfade every bed clip ends with at both ends: equal power, for noise (the next clip is uncorrelated). */
const BED = ['fade', 'q', `${XF}`, `${LEN}`, `${XF}`]
/** Noise beds are made this much longer than a clip... */
const SLEN = LEN + 3
/**
 * ...and each variant trimmed from a different point, so their tremolos,
 * gusts and sweeps start at different phases (else every clip's gust would
 * land in the same place, repeating in step with the clips).
 */
const bedEnd = (t: Tools, squash = true) => [...(squash ? SQUASH : []), 'trim', `${((t.v * 1.37) % 3).toFixed(2)}`, `${LEN}`, ...BED]
/**
 * A gentle compressor for steady noise beds: about 4 dB more loudness at the
 * same -3 dBFS peak, so they can play loud without clipping (afplay's gain
 * just multiplies). Not for crackle, bubbles or sparks: their peaks are the point.
 */
const SQUASH = ['compand', '0.01,0.25', '-90,-90,-36,-20,-12,-9,0,-3', '0']
const FMT = ['-r', `${RATE}`, '-c', '1', '-b', '16']

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
/** sox: a new clip from nothing (`synth …` and effects). */
const synth = (out: string, ...args: (string | number)[]) => run('sox', ['-n', ...FMT, out, ...args.map(String)])
/** sox: inputs (mixed with -m when several) through effects. */
const fx = (inputs: string[], out: string, ...args: (string | number)[]) =>
  run('sox', [...(inputs.length > 1 ? ['-m'] : []), ...inputs, ...FMT, out, ...args.map(String)])

/** A deterministic random stream for Node-made sources. */
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

/** Writes samples (-1..1) as a WAV. */
function wav(path: string, x: Float32Array): void {
  const b = Buffer.alloc(44 + x.length * 2)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + x.length * 2, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(RATE, 24)
  b.writeUInt32LE(RATE * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(x.length * 2, 40)
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + i * 2)
  writeFileSync(path, b)
}

/**
 * Sparse impulses: `per` a second over `seconds`, each a few ms of decaying
 * noise (`len` samples), strengths from a heavy-ish tail (`tail`: lower is
 * more even): crackle, sparks, embers.
 */
function impulses(path: string, seed: number, seconds: number, per: number, len: [number, number], tail = 0.7): void {
  const r = rng(seed)
  const x = new Float32Array(Math.ceil(seconds * RATE))
  const n = Math.round(per * seconds)
  for (let j = 0; j < n; j++) {
    const at = Math.floor(r() * x.length)
    const amp = Math.min(1, 0.16 / Math.pow(r() + 0.06, tail))
    const l = len[0] + Math.floor(r() * (len[1] - len[0]))
    for (let i = 0; i < l && at + i < x.length; i++) x[at + i]! += (r() * 2 - 1) * Math.exp(-i / (l / 4)) * amp
  }
  wav(path, x)
}

/**
 * Bubble blips: `per` a second, each the ring of a bubble (a decaying tone at
 * its resonance, rising a little as it dies away) between `lo` and `hi` Hz,
 * ringing for `cycles` cycles: the sound of water bubbling.
 */
function blips(path: string, seed: number, seconds: number, per: number, lo: number, hi: number, cycles: number): void {
  const r = rng(seed)
  const x = new Float32Array(Math.ceil(seconds * RATE))
  const n = Math.round(per * seconds)
  for (let j = 0; j < n; j++) {
    const at = Math.floor(r() * x.length)
    const f0 = lo * Math.pow(hi / lo, r())
    const tau = cycles / f0
    const amp = 0.25 + 0.75 * r()
    let ph = 0
    for (let i = 0; i < tau * 5 * RATE && at + i < x.length; i++) {
      const t = i / RATE
      ph += (2 * Math.PI * f0 * (1 + 0.35 * (1 - Math.exp(-t / tau)))) / RATE
      x[at + i]! += Math.sin(ph) * Math.exp(-t / tau) * amp * Math.min(1, i / 20)
    }
  }
  wav(path, x)
}

/**
 * Birdsong: about `per` phrases a second, each a few chirps (a pitch sweep
 * with a little vibrato, 50-150 ms) at 2.5-5 kHz.
 */
function birds(path: string, seed: number, seconds: number, per: number): void {
  const r = rng(seed)
  const x = new Float32Array(Math.ceil(seconds * RATE))
  const phrases = Math.max(1, Math.round(per * seconds))
  for (let p = 0; p < phrases; p++) {
    let at = r() * (seconds - 1)
    const base = 2500 + 2000 * r()
    const chirps = 2 + Math.floor(r() * 4)
    const amp = 0.3 + 0.7 * r()
    for (let c = 0; c < chirps; c++) {
      const len = 0.05 + 0.1 * r()
      const f0 = base * (0.9 + 0.3 * r())
      const f1 = f0 * (0.7 + 0.7 * r())
      const i0 = Math.floor(at * RATE)
      let ph = 0
      for (let i = 0; i < len * RATE && i0 + i < x.length; i++) {
        const k = i / (len * RATE)
        ph += (2 * Math.PI * (f0 + (f1 - f0) * k) * (1 + 0.03 * Math.sin(2 * Math.PI * 40 * (i / RATE)))) / RATE
        x[i0 + i]! += Math.sin(ph) * Math.sin(Math.PI * k) * amp * 0.5
      }
      at += len + 0.03 + 0.08 * r()
    }
  }
  wav(path, x)
}

/** Wind as measured: deep (63-500 Hz), gusting hard and slowly, buffeting a little. */
const windRecipe = (gusts: number) => (out: string, t: Tools) => {
  synth(out + '.body.wav', 'synth', SLEN, 'brownnoise', 'synth', SLEN, 'pinknoise', 'mix', 'lowpass', 750, 'highpass', 62)
  synth(out + '.air.wav', 'synth', SLEN, 'pinknoise', 'highpass', 1500, 'gain', -18)
  fx([out + '.body.wav', out + '.air.wav'], out + '.mix.wav')
  // Gusts at random, never in a rhythm.
  turbulence(out + '.mix.wav', seedOf(out), [[gusts, 0.65], [gusts * 2.7, 0.3], [7.3, 0.12]])
  fx([out + '.mix.wav'], out, 'reverb', 25, 'gain', '-n', -3, ...bedEnd(t))
  rmSync(out + '.mix.wav')
  rmSync(out + '.body.wav')
  rmSync(out + '.air.wav')
}

/** Glints: `per` a second, short high pings (stars flashing past). */
function glints(path: string, seed: number, seconds: number, per: number): void {
  const r = rng(seed)
  const x = new Float32Array(Math.ceil(seconds * RATE))
  for (let j = 0; j < Math.round(per * seconds); j++) {
    const at = Math.floor(r() * x.length)
    const f = 2200 + 2800 * r()
    const amp = 0.2 + 0.8 * r()
    for (let i = 0; i < 0.25 * RATE && at + i < x.length; i++) x[at + i]! += Math.sin((2 * Math.PI * f * (1 - 0.15 * (i / RATE)) * i) / RATE) * Math.exp(-i / (0.04 * RATE)) * amp * 0.4
  }
  wav(path, x)
}

/** Reads a WAV this script wrote (16-bit mono). */
function readWav(path: string): Float32Array {
  const b = readFileSync(path)
  let o = 12
  while (o < b.length) {
    const id = b.toString('ascii', o, o + 4)
    const size = b.readUInt32LE(o + 4)
    if (id === 'data') {
      const x = new Float32Array(size / 2)
      for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(o + 8 + i * 2) / 32768
      return x
    }
    o += 8 + size + (size & 1)
  }
  throw new Error(`no data in ${path}`)
}

/**
 * Turbulence: the clip's loudness varied smoothly and at random, never in a
 * rhythm (a tremolo's steady throb reads as a machine, not a fire): for each
 * [rate Hz, depth], a random level every 1/rate s, eased between.
 */
function turbulence(path: string, seed: number, octaves: readonly (readonly [number, number])[]): void {
  const x = readWav(path)
  const r = rng(seed)
  const env = new Float32Array(x.length).fill(1)
  for (const [rate, depth] of octaves) {
    const step = RATE / rate
    const pts = Array.from({ length: Math.ceil(x.length / step) + 2 }, () => r() * 2 - 1)
    for (let i = 0; i < x.length; i++) {
      const u = i / step
      const k = Math.floor(u)
      const f = (1 - Math.cos(Math.PI * (u - k))) / 2
      env[i]! *= 1 + depth * (pts[k]! * (1 - f) + pts[k + 1]! * f)
    }
  }
  for (let i = 0; i < x.length; i++) x[i]! *= env[i]!
  wav(path, x)
}

/**
 * A hum: each partial (Hz, gain) is white noise through a very narrow
 * resonance (sharpness `q`), so it sounds a steady pitch but its fine detail is
 * random. Clips of it are uncorrelated, so they crossfade like noise (equal
 * power, no dip), where clips of pure tones would partly cancel wherever their
 * phases meet a little out of step (and in practice they always do: a clip
 * starts on the next frame, after afplay's start-up).
 */
function hum(path: string, seed: number, seconds: number, parts: readonly (readonly [number, number])[], q: number): void {
  const r = rng(seed)
  const settle = 3 * RATE
  const x = new Float32Array(Math.ceil(seconds * RATE))
  for (const [hz, g] of parts) {
    const rad = 1 - (Math.PI * hz) / (q * RATE)
    const c = 2 * rad * Math.cos((2 * Math.PI * hz) / RATE)
    let y1 = 0
    let y2 = 0
    const scale = g * Math.sqrt(1 - rad) * 6
    for (let i = -settle; i < x.length; i++) {
      const y = (r() * 2 - 1) * (1 - rad) + c * y1 - rad * rad * y2
      y2 = y1
      y1 = y
      if (i >= 0) x[i]! += y * scale
    }
  }
  let max = 1e-6
  for (const v of x) max = Math.max(max, Math.abs(v))
  for (let i = 0; i < x.length; i++) x[i]! *= 0.9 / max
  wav(path, x)
}

/** A stable seed from a clip's path (each variant its own turbulence). */
function seedOf(path: string): number {
  let h = 2166136261
  for (let i = 0; i < path.length; i++) h = Math.imul(h ^ path.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * A noise bed: sox makes the noise (`src`, `synth` arguments after the
 * length), its loudness is varied at random (`turb`, see turbulence: never a
 * tremolo's steady throb), then the effects (`post`) and the bed's ends.
 */
function noiseBed(out: string, t: Tools, src: (string | number)[], turb: readonly (readonly [number, number])[], post: (string | number)[] = [], peak = -3): void {
  synth(t.tmp('n.wav'), 'synth', SLEN, ...src)
  turbulence(t.tmp('n.wav'), seedOf(out), turb)
  fx([t.tmp('n.wav')], out, ...post, 'gain', '-n', peak, ...bedEnd(t))
}

/**
 * A resonance wandering at random: white noise through a narrow 2-pole band
 * whose centre drifts between `lo` and `hi` Hz, a new target every 1/`rate`
 * s, eased between: a whistling rush (a flanger or phaser would sweep in a rhythm).
 */
function wander(path: string, seed: number, seconds: number, lo: number, hi: number, rate: number, q: number): void {
  const r = rng(seed)
  const x = new Float32Array(Math.ceil(seconds * RATE))
  const step = RATE / rate
  const pts = Array.from({ length: Math.ceil(x.length / step) + 2 }, () => lo * Math.pow(hi / lo, r()))
  const rad = 1 - 1 / q
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const u = i / step
    const k = Math.floor(u)
    const f = (1 - Math.cos(Math.PI * (u - k))) / 2
    const hz = pts[k]! * (1 - f) + pts[k + 1]! * f
    const c = 2 * rad * Math.cos((2 * Math.PI * hz) / RATE)
    const y = (r() * 2 - 1) * (1 - rad) + c * y1 - rad * rad * y2
    y2 = y1
    y1 = y
    x[i] = y
  }
  let max = 1e-6
  for (const v of x) max = Math.max(max, Math.abs(v))
  for (let i = 0; i < x.length; i++) x[i]! /= max
  wav(path, x)
}

/**
 * An explosion, all noise (no oscillator, so no pitch): a blast blooming over
 * a few milliseconds (a hard click would sound like something small hitting
 * metal), its low-pass closing from `open` Hz to 200 as it dies, a punch of
 * body gone within a tenth of a second into a short rumble (a longer punch
 * or tail would bury the next strike, even one right behind it),
 * roughened throughout by random swells.
 */
function explosion(path: string, seed: number, seconds: number, open: number): void {
  const r = rng(seed)
  const x = new Float32Array(Math.ceil(seconds * RATE))
  const f = [0, 0, 0]
  const g = [0, 0, 0]
  let grit = 1
  let gritTo = 1
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE
    if (i % 400 === 0) gritTo = 0.55 + 0.9 * r()
    grit += (gritTo - grit) * 0.002
    const bloom = 1 - Math.exp(-t / 0.004)
    const env = bloom * (0.85 * Math.exp(-t / 0.06) + 0.15 * Math.exp(-t / 0.45)) * grit
    // Two bands: the blast (closing low-pass) and a body under it (low, steady).
    const hz = 200 + (open - 200) * Math.exp(-t / 0.1)
    const k = 1 - Math.exp((-2 * Math.PI * hz) / RATE)
    const kb = 1 - Math.exp((-2 * Math.PI * 450) / RATE)
    const n = r() * 2 - 1
    f[0]! += k * (n - f[0]!)
    f[1]! += k * (f[0]! - f[1]!)
    f[2]! += k * (f[1]! - f[2]!)
    g[0]! += kb * (n - g[0]!)
    g[1]! += kb * (g[0]! - g[1]!)
    g[2]! += kb * (g[1]! - g[2]!)
    x[i] = (f[2]! * 0.8 + g[2]! * 1.6) * env
  }
  let max = 1e-6
  for (const v of x) max = Math.max(max, Math.abs(v))
  for (let i = 0; i < x.length; i++) x[i]! /= max
  wav(path, x)
}

/** An N-wave (a sonic boom's pressure: a jump, a straight fall through zero, a jump back), `ms` long, at `at` s. */
function nwave(x: Float32Array, at: number, ms: number, amp: number): void {
  const i0 = Math.floor(at * RATE)
  const n = Math.floor((ms / 1000) * RATE)
  for (let i = 0; i < n && i0 + i < x.length; i++) x[i0 + i]! += amp * (1 - (2 * i) / n)
}

type Tools = { v: number; tmp: (name: string) => string }
type Recipe = { variants?: number; make: (out: string, t: Tools) => void }

/**
 * Every clip, by folder (a scene, or `events`) and name. A bed layer's
 * variants are name1..nameN; sound.ts picks among them.
 */
const RECIPES: Record<string, Record<string, Recipe>> = {
  rocket: {
    // Matched to NASA's STS-131 and Atlas V launch recordings: energy 31-250 Hz
    // falling ~6 dB/octave above, sparse sharp crackle (kurtosis ~14, ~12
    // bursts/s), a fast irregular flutter (10-15 Hz).
    roar: {
      variants: 3,
      make: (out, t) => noiseBed(out, t, ['brownnoise', 'synth', SLEN, 'pinknoise', 'mix', 'lowpass', 1100, 'bass', '+3', 60, 'overdrive', 5], [[10.5, 0.14], [15, 0.1], [0.8, 0.12]], ['reverb', 30, 40, 60]),
    },
    crackle: {
      variants: 3,
      make: (out, t) => {
        impulses(t.tmp('imp.wav'), t.v, SLEN, 40, [30, 100])
        fx([t.tmp('imp.wav')], out, 'lowpass', 5000, 'highpass', 300, 'reverb', 25, 30, 40, 'gain', '-n', -3, ...bedEnd(t, false))
      },
    },
    vent: { variants: 3, make: (out, t) => noiseBed(out, t, ['whitenoise', 'highpass', 1400, 'lowpass', 6500], [[0.45, 0.4], [3, 0.12]], ['reverb', 35], -6) },
    wind: { variants: 3, make: windRecipe(0.31) },
    space: {
      variants: 3,
      make: (out, t) => {
        hum(t.tmp('s.wav'), seedOf(out), SLEN, [[55, 0.4], [110, 0.3], [165, 0.15]], 260)
        fx([t.tmp('s.wav')], out, 'overdrive', 4, 'gain', '-n', -14, ...bedEnd(t, false))
      },
    },
  },
  starship: {
    // Bigger and deeper than Falcon: 33 Raptors.
    roar: {
      variants: 3,
      make: (out, t) => noiseBed(out, t, ['brownnoise', 'synth', SLEN, 'pinknoise', 'mix', 'lowpass', 800, 'bass', '+6', 45, 'overdrive', 7], [[9, 0.16], [13.3, 0.11], [0.7, 0.12]], ['reverb', 45, 50, 80]),
    },
  },
  fire: {
    // Matched to a campfire recording: a quiet bed of flames (peaking ~125 Hz,
    // licking at a few Hz) under sparse, sharp, bright crackles (3-7 a second at
    // a campfire, typically 6 ms long, 16x the bed, the odd one 80x).
    // (The flames lick and the roar surges at random, never in a rhythm: see turbulence.)
    flames: {
      variants: 3,
      make: (out, t) => {
        synth(t.tmp('n.wav'), 'synth', SLEN, 'brownnoise', 'synth', SLEN, 'pinknoise', 'mix', 'lowpass', 560, 'highpass', 110)
        turbulence(t.tmp('n.wav'), t.v + 200, [[1.1, 0.35], [4.5, 0.3]])
        fx([t.tmp('n.wav')], out, 'reverb', 15, 'gain', '-n', -3, ...bedEnd(t))
      },
    },
    roar: {
      variants: 3,
      make: (out, t) => {
        synth(t.tmp('n.wav'), 'synth', SLEN, 'brownnoise', 'lowpass', 240, 'bass', '+4', 70)
        turbulence(t.tmp('n.wav'), t.v + 210, [[0.7, 0.3], [2.3, 0.2], [6.5, 0.12]])
        fx([t.tmp('n.wav')], out, 'reverb', 25, 'gain', '-n', -3, ...bedEnd(t))
      },
    },
    ...Object.fromEntries(
      (
        [
          ['crackleLo', 2.5],
          ['crackleMid', 6],
          ['crackleHi', 16],
        ] as const
      ).map(([name, per]) => [
        name,
        {
          variants: 3,
          make: (out: string, t: Tools) => {
            impulses(t.tmp('imp.wav'), t.v * 7 + per, SLEN, per, [30, 160], 0.9)
            fx([t.tmp('imp.wav')], out, 'highpass', 250, 'treble', '+5', 5000, 'reverb', 12, 30, 20, 'gain', '-n', -2, ...bedEnd(t, false))
          },
        },
      ]),
    ),
  },
  surf: {
    // Matched to two beach recordings: a calm one (a wave every ~12 s, a 19%
    // swell, energy at 250-500 Hz) and a rough one (every ~5.6 s, a 51% swell,
    // heavier lows and foam hiss up at 8 kHz). The bed is the wash; each wave is
    // an event (events/wave): a swell building, the crash, the fizz running out.
    wash: { variants: 3, make: (out, t) => noiseBed(out, t, ['pinknoise', 'lowpass', 950, 'highpass', 160, 'bass', '-4', 120], [[0.37, 0.15], [1.6, 0.1]], ['reverb', 40]) },
    rumble: { variants: 3, make: (out, t) => noiseBed(out, t, ['brownnoise', 'lowpass', 220], [[0.29, 0.35], [1.1, 0.15]], ['reverb', 40]) },
    foam: { variants: 3, make: (out, t) => noiseBed(out, t, ['whitenoise', 'highpass', 2600, 'lowpass', 9500], [[1.3, 0.45], [0.6, 0.3], [6, 0.15]], ['reverb', 30], -4) },
  },
  bubbles: {
    // Matched to recordings of water bubbling (small bubbles ringing at 1.5-3 kHz,
    // ~9 a second, very spiky), a boil (a dense mass at 0.5-2 kHz, ~20 bursts a
    // second) and big bubbles gloop-ing (31-250 Hz). Each bubble seen bursting is
    // its own pop (synthesized in sound.ts).
    water: { variants: 3, make: (out, t) => noiseBed(out, t, ['pinknoise', 'lowpass', 550, 'highpass', 35], [[0.7, 0.45], [1.9, 0.3]], ['reverb', 30]) },
    fizz: {
      variants: 3,
      make: (out, t) => {
        blips(t.tmp('b.wav'), t.v + 40, SLEN, 70, 1300, 6000, 6)
        fx([t.tmp('b.wav')], out, 'highpass', 1000, 'reverb', 20, 'gain', '-n', -3, ...bedEnd(t, false))
      },
    },
    boil: {
      variants: 3,
      make: (out, t) => {
        blips(t.tmp('b.wav'), t.v + 50, SLEN, 140, 500, 5200, 9)
        synth(t.tmp('n.wav'), 'synth', SLEN, 'pinknoise', 'bandpass', 2000, 2600, 'gain', -12)
        turbulence(t.tmp('n.wav'), seedOf(out), [[6.5, 0.4], [1.2, 0.25]])
        fx([t.tmp('b.wav'), t.tmp('n.wav')], out, 'reverb', 25, 'gain', '-n', -3, ...bedEnd(t, false))
      },
    },
    gloop: {
      variants: 3,
      make: (out, t) => {
        blips(t.tmp('b.wav'), t.v + 60, SLEN, 7, 110, 380, 5)
        fx([t.tmp('b.wav')], out, 'lowpass', 900, 'reverb', 35, 'gain', '-n', -3, ...bedEnd(t, false))
      },
    },
  },
  engine: {
    // Matched to two steam engine recordings: the room's low machinery thump
    // (63 Hz), a steam leak's hiss, and the gears' chatter; each chuff is an event.
    rumble: { variants: 3, make: (out, t) => noiseBed(out, t, ['brownnoise', 'lowpass', 170, 'bass', '+3', 60], [[2.7, 0.25], [0.6, 0.15]], ['reverb', 35]) },
    whir: { variants: 3, make: (out, t) => noiseBed(out, t, ['pinknoise', 'bandpass', 650, 900], [[5.3, 0.25], [8.9, 0.15], [0.8, 0.1]], ['reverb', 35]) },
    hiss: { variants: 3, make: (out, t) => noiseBed(out, t, ['whitenoise', 'highpass', 2400, 'lowpass', 8500], [[0.5, 0.25], [2.5, 0.1]], ['reverb', 20], -4) },
    gears: {
      variants: 3,
      make: (out, t) => {
        impulses(t.tmp('imp.wav'), t.v + 80, SLEN, 26, [20, 70], 0.5)
        fx([t.tmp('imp.wav')], out, 'bandpass', 3000, 2400, 'reverb', 25, 'gain', '-n', -3, ...bedEnd(t, false))
      },
    },
  },
  balloon: {
    // Wind matched to a recording (deep, gusting); the burner matched to a
    // pressurized-gas flame (a deep roar, 63-125 Hz); birds near the ground.
    wind: { variants: 3, make: windRecipe(0.23) },
    burner: {
      variants: 3,
      make: (out, t) => {
        synth(t.tmp('roar.wav'), 'synth', SLEN, 'brownnoise', 'synth', SLEN, 'pinknoise', 'mix', 'lowpass', 320, 'highpass', 50, 'bass', '+5', 80)
        turbulence(t.tmp('roar.wav'), seedOf(out), [[9.5, 0.14], [1.4, 0.18]])
        synth(t.tmp('hiss.wav'), 'synth', SLEN, 'whitenoise', 'highpass', 3000, 'lowpass', 7000, 'gain', -34)
        fx([t.tmp('roar.wav'), t.tmp('hiss.wav')], out, 'reverb', 20, 'gain', '-n', -3, ...bedEnd(t))
      },
    },
    birds: {
      variants: 3,
      make: (out, t) => {
        birds(t.tmp('b.wav'), t.v + 90, SLEN, 0.9)
        fx([t.tmp('b.wav')], out, 'reverb', 50, 50, 80, 'gain', '-n', -6, ...bedEnd(t, false))
      },
    },
  },
  ski: {
    // Snow's grain matched to a recording of crunchy snow (energy at 500 Hz-1 kHz,
    // ~400 tiny crunches a second): a glide under the skis, and wind past the ears.
    // Each turn's swish is an event.
    wind: { variants: 3, make: windRecipe(0.4) },
    glide: {
      variants: 3,
      make: (out, t) => {
        impulses(t.tmp('g.wav'), t.v + 110, SLEN, 260, [8, 30], 0.4)
        turbulence(t.tmp('g.wav'), seedOf(out), [[1.1, 0.3]])
        fx([t.tmp('g.wav')], out, 'bandpass', 750, 900, 'reverb', 15, 'gain', '-n', -3, ...bedEnd(t, false))
      },
    },
  },
  avalon: {
    // A colony ship's interior, after spacecraft cabin noise (broadband, strongest
    // at 63-250 Hz, fans humming): the hull's beating hum, the air handlers, and
    // the shield's electric fizz. Each rock on the shield is an event (events/zap).
    hum: {
      variants: 3,
      make: (out, t) => {
        // Fundamentals a laptop can't play, so the harmonics carry the pitch (the ear fills in the rest).
        // (A second longer, its first trimmed after the reverb: every clip starts with the room already ringing.)
        // (Harmonics exact multiples of the rounded fundamental, or they'd beat with it once a clip; the second hull tone throbs against it by design.)
        hum(t.tmp('h.wav'), seedOf(out), SLEN, [[41, 0.3], [82, 0.35], [123, 0.3], [164, 0.2], [246, 0.12], [328, 0.05]], 260)
        fx([t.tmp('h.wav')], out, 'overdrive', 3, 'reverb', 40, 50, 90, 'gain', '-n', -3, ...bedEnd(t, false))
      },
    },
    air: { variants: 3, make: (out, t) => noiseBed(out, t, ['pinknoise', 'lowpass', 1800, 'highpass', 70, 'bass', '+3', 150], [[0.33, 0.12], [1.7, 0.06]], ['reverb', 40]) },
    shield: {
      variants: 3,
      make: (out, t) => {
        impulses(t.tmp('f.wav'), t.v + 140, SLEN, 180, [4, 14], 0.5)
        turbulence(t.tmp('f.wav'), seedOf(out), [[13, 0.45], [1.4, 0.3]])
        fx([t.tmp('f.wav')], out, 'bandpass', 3200, 2500, 'reverb', 30, 'gain', '-n', -3, ...bedEnd(t, false))
      },
    },
  },
  warp: {
    // The drive: a deep hum pitched up through three speeds, a whistling rush
    // wandering faster with speed, and stars glinting past.
    ...Object.fromEntries(
      ([[1, 38], [2, 54], [3, 76]] as const).map(([n, hz]) => [
        `drive${n}x`,
        {
          variants: 3,
          make: (out: string, t: Tools) => {
            hum(t.tmp('d.wav'), seedOf(out), SLEN, [[hz, 0.3], [hz * 2, 0.35], [hz * 3, 0.28], [hz * 4, 0.16], [hz * 6, 0.08]], 300)
            fx([t.tmp('d.wav')], out, 'overdrive', 4, 'reverb', 60, 50, 100, 'gain', '-n', -3, ...bedEnd(t, false))
          },
        },
      ]),
    ),
    ...Object.fromEntries(
      ([[1, 0.25], [2, 0.7], [3, 1.8]] as const).map(([n, speed]) => [
        `rush${n}`,
        {
          variants: 3,
          make: (out: string, t: Tools) => {
            // A whistling resonance wandering at random (faster with speed) over a soft rush.
            wander(t.tmp('w.wav'), seedOf(out), SLEN, 250, 1800 + 900 * speed, speed, 45)
            synth(t.tmp('r.wav'), 'synth', SLEN, 'pinknoise', 'lowpass', 2500, 'highpass', 90, 'gain', -6)
            turbulence(t.tmp('r.wav'), seedOf(out) + 1, [[speed, 0.4], [speed * 3.1, 0.15]])
            fx([t.tmp('w.wav'), t.tmp('r.wav')], out, 'reverb', 50, 'gain', '-n', -3, ...bedEnd(t))
          },
        },
      ]),
    ),
    glints: {
      variants: 3,
      make: (out, t) => {
        glints(t.tmp('g.wav'), t.v + 150, SLEN, 6)
        fx([t.tmp('g.wav')], out, 'reverb', 70, 50, 100, 'gain', '-n', -4, ...bedEnd(t, false))
      },
    },
  },
  events: {
    blast: {
      // A rock blowing up on the shield, heard through the hull: raw noise, no
      // tone (see explosion), overdriven for grit but not squeezed (its punch
      // must stand clear of the hull's hum), in a big room with its highs
      // damped (a ringing room would sound like a bin).
      variants: 3,
      make: (out, t) => {
        explosion(t.tmp('x.wav'), 170 + t.v * 31, 1.3 + 0.2 * t.v, 2600 + 500 * t.v)
        fx([t.tmp('x.wav')], out, 'overdrive', 10, 'highpass', 110, 'lowpass', 3500, 'reverb', 45, 100, 100, 'gain', '-n', -2)
      },
    },
    swish: {
      // A carve: snow's grain swelling and fading over half a second, with a spray of fine hiss.
      variants: 3,
      make: (out, t) => {
        impulses(t.tmp('g.wav'), t.v + 120, 0.55, 420, [8, 30], 0.4)
        synth(t.tmp('spray.wav'), 'synth', 0.55, 'whitenoise', 'highpass', 2200, 'gain', -22)
        fx([t.tmp('g.wav'), t.tmp('spray.wav')], out, 'bandpass', 800, 1000, 'fade', 'q', 0.18, 0.55, 0.3, 'reverb', 15, 'gain', '-n', -2)
      },
    },
    chuff: {
      // A steam engine's exhaust beat: a broadband burst strongest at 250-500 Hz, fading in ~70 ms, with the piston's thump and a hiss tail.
      variants: 3,
      make: (out, t) => {
        synth(t.tmp('burst.wav'), 'synth', 0.4, 'pinknoise', 'synth', 0.4, 'whitenoise', 'mix', 'highpass', 150, 'lowpass', 5000, 'bass', '+3', 350, 'fade', 'q', 0.004, 0.4, 0.36 - 0.03 * t.v)
        synth(t.tmp('thump.wav'), 'synth', 0.16, 'sine', `${68 + 4 * t.v}-44`, 'fade', 'q', 0.003, 0.16, 0.14, 'gain', -20)
        fx([t.tmp('burst.wav'), t.tmp('thump.wav')], out, 'reverb', 30, 40, 40, 'gain', '-n', -2)
      },
    },
    clank: {
      // The trip hammer falling: a strike and ringing steel.
      make: (out, t) => {
        const tones = [620, 1013, 1720].map((hz, i) => {
          synth(t.tmp(`p${i}.wav`), 'synth', 0.6, 'pluck', hz, 'gain', -i * 4)
          return t.tmp(`p${i}.wav`)
        })
        synth(t.tmp('hit.wav'), 'synth', 0.03, 'whitenoise', 'fade', 'q', 0.001, 0.03, 0.025, 'pad', 0, 0.57)
        fx([...tones, t.tmp('hit.wav')], out, 'reverb', 35, 'gain', '-n', -3)
      },
    },
    lap: {
      // A small wave on a calm beach: a soft swell and wash, no fizz.
      variants: 3,
      make: (out, t) => synth(out, 'synth', 5, 'pinknoise', 'synth', 5, 'brownnoise', 'mix', 'lowpass', 1300, 'highpass', 90, 'fade', 'q', 1.6, 5, 2.6, 'reverb', 50, 'gain', '-n', -3),
    },
    wave: {
      variants: 3,
      make: (out, t) => {
        const rise = 1.6 + 0.5 * t.v
        synth(t.tmp('swell.wav'), 'synth', 6, 'brownnoise', 'synth', 6, 'pinknoise', 'mix', 'lowpass', 600, 'fade', 'q', rise, rise + 0.8, 0.7)
        synth(t.tmp('crash.wav'), 'synth', 6 - rise, 'brownnoise', 'synth', 6 - rise, 'pinknoise', 'mix', 'highpass', 50, 'lowpass', 1700, 'bass', '+4', 80, 'fade', 'q', 0.04, 6 - rise, 6 - rise - 0.2, 'pad', rise, 0)
        synth(t.tmp('fizz0.wav'), 'synth', 5.8 - rise, 'whitenoise', 'highpass', 1700, 'lowpass', 9500, 'gain', -11)
        turbulence(t.tmp('fizz0.wav'), seedOf(out), [[7, 0.4], [1.5, 0.25]])
        fx([t.tmp('fizz0.wav')], t.tmp('fizz.wav'), 'fade', 'q', 0.3, 5.8 - rise, 5.8 - rise - 0.3, 'pad', rise + 0.2, 0)
        fx([t.tmp('swell.wav'), t.tmp('crash.wav'), t.tmp('fizz.wav')], out, 'reverb', 45, 50, 70, 'gain', '-n', -2)
      },
    },
    ignite: {
      make: (out, t) => {
        synth(t.tmp('n.wav'), 'synth', 2.6, 'brownnoise', 'synth', 2.6, 'pinknoise', 'mix', 'lowpass', 900, 'bass', '+6', 60, 'overdrive', 8)
        turbulence(t.tmp('n.wav'), seedOf(out), [[11, 0.15], [1.5, 0.15]])
        fx([t.tmp('n.wav')], out, 'fade', 'q', 1.4, 2.6, 0.7, 'reverb', 60, 50, 80, 'gain', '-n', -1)
      },
    },
    sep: {
      make: (out, t) => {
        synth(t.tmp('crack.wav'), 'synth', 0.06, 'whitenoise', 'highpass', 900, 'fade', 'q', 0.002, 0.06, 0.05, 'pad', 0, 1.14)
        synth(t.tmp('thump.wav'), 'synth', 1.2, 'sine', '64-30', 'fade', 'q', 0.005, 1.2, 1.0, 'bass', '+6', 50)
        fx([t.tmp('crack.wav'), t.tmp('thump.wav')], out, 'reverb', 70, 60, 90, 'gain', '-n', -1)
      },
    },
    sonic: {
      // A returning booster's double sonic boom (the "ka-BOOM" heard at the Cape before it lands): two N-waves, then a long rolling tail.
      make: (out, t) => {
        const x = new Float32Array(Math.ceil(3 * RATE))
        nwave(x, 0.05, 140, 0.9)
        nwave(x, 0.42, 130, 0.75)
        wav(t.tmp('n.wav'), x)
        synth(t.tmp('rumble.wav'), 'synth', 3, 'brownnoise', 'lowpass', 300, 'fade', 'q', 0.05, 3, 2.8, 'gain', -8)
        fx([t.tmp('n.wav'), t.tmp('rumble.wav')], out, 'lowpass', 2500, 'reverb', 85, 50, 100, 'gain', '-n', -1)
      },
    },
    boom: {
      make: (out, t) => {
        synth(t.tmp('blast.wav'), 'synth', 2, 'brownnoise', 'synth', 2, 'pinknoise', 'mix', 'lowpass', 1200, 'overdrive', 20, 'fade', 'q', 0.01, 2, 1.8)
        synth(t.tmp('sub.wav'), 'synth', 2, 'sine', '50-25', 'fade', 'q', 0.01, 2, 1.9)
        fx([t.tmp('blast.wav'), t.tmp('sub.wav')], out, 'reverb', 80, 'gain', '-n', -1)
      },
    },
    splash: {
      make: (out, t) => {
        synth(t.tmp('wash.wav'), 'synth', 1.4, 'whitenoise', 'highpass', 350, 'lowpass', 4200, 'fade', 'q', 0.01, 1.4, 1.25)
        synth(t.tmp('slap.wav'), 'synth', 0.35, 'sine', '90-45', 'fade', 'q', 0.003, 0.35, 0.3, 'pad', 0, 1.05)
        fx([t.tmp('wash.wav'), t.tmp('slap.wav')], out, 'reverb', 50, 'gain', '-n', -2)
      },
    },
    thud: {
      make: (out, t) => {
        synth(t.tmp('knock.wav'), 'synth', 0.45, 'sine', '78-42', 'fade', 'q', 0.003, 0.45, 0.4)
        synth(t.tmp('scuff.wav'), 'synth', 0.08, 'brownnoise', 'lowpass', 900, 'fade', 'q', 0.003, 0.08, 0.07, 'pad', 0, 0.37)
        fx([t.tmp('knock.wav'), t.tmp('scuff.wav')], out, 'reverb', 40, 'gain', '-n', -2)
      },
    },
    chute: {
      // The canopies cracking open: a whoosh, fabric flapping at random.
      make: (out, t) => {
        synth(t.tmp('n.wav'), 'synth', 0.7, 'pinknoise', 'bandpass', 420, 380)
        turbulence(t.tmp('n.wav'), seedOf(out), [[22, 0.55]])
        fx([t.tmp('n.wav')], out, 'fade', 'q', 0.15, 0.7, 0.35, 'reverb', 40, 'gain', '-n', -5)
      },
    },
    clang: {
      // The chopsticks closing: steel on steel, ringing.
      make: (out, t) => {
        // (sox won't chain tone generators with `synth … mix`: each its own file, then mixed.)
        const tones = [196, 293, 467, 701].map((hz, i) => {
          synth(t.tmp(`p${i}.wav`), 'synth', 1.6, 'pluck', hz, 'gain', -i * 3)
          return t.tmp(`p${i}.wav`)
        })
        fx(tones, out, 'overdrive', 6, 'reverb', 60, 50, 90, 'gain', '-n', -3)
      },
    },
  },
}

const only = process.argv.slice(2)
const full = only.length === 0
if (full) rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
mkdirSync(CACHE, { recursive: true })
for (const [folder, clips] of Object.entries(RECIPES)) {
  if (!full && !only.includes(folder)) continue
  // Events ship as they are; bed layers only go into the cache, to be mixed.
  const ships = folder === 'events'
  if (ships) {
    rmSync(join(OUT, folder), { recursive: true, force: true })
    mkdirSync(join(OUT, folder), { recursive: true })
  }
  mkdirSync(join(CACHE, folder), { recursive: true })
  for (const [name, recipe] of Object.entries(clips)) {
    // (Every bed layer has BED_TAKES takes; an event, its recipe's variants.)
    const n = ships ? recipe.variants ?? 1 : BED_TAKES
    const made: string[] = []
    for (let v = 1; v <= n; v++) {
      const file = n > 1 ? `${name}${v}` : name
      const w = join(CACHE, folder, `${file}.wav`)
      recipe.make(w, { v, tmp: (s: string) => join(CACHE, folder, `_${file}_${s}`) })
      made.push(w)
    }
    // A layer's takes at one loudness (their middles' RMS, scaled down to the
    // quietest's so peaks stay where they were): otherwise the level would step
    // at each seam, and that regularity is heard.
    if (n > 1) {
      const takes = made.map(w => readWav(w))
      const rms = takes.map(middle)
      const target = Math.min(...rms)
      takes.forEach((x, i) => {
        const g = target / rms[i]!
        for (let k = 0; k < x.length; k++) x[k]! *= g
        wav(made[i]!, x)
      })
    }
    if (ships) for (const w of made) encode(w, join(OUT, folder, `${w.slice(w.lastIndexOf('/') + 1, -4)}.m4a`), '64k')
  }
  for (const f of readdirSync(join(CACHE, folder))) if (f.startsWith('_')) rmSync(join(CACHE, folder, f))
  console.log(`${ships ? 'sounds' : '.sound-cache'}/${folder}: ${clips ? Object.keys(clips).length : 0} recipes`)
}

/**
 * Raises `x` by `boost` and holds its peaks under `ceiling`: a gain that drops
 * at once for a peak (seen 3 ms ahead) and recovers over a tenth of a second.
 */
function limit(x: Float32Array, boost: number, ceiling: number): void {
  const ahead = Math.floor(0.003 * RATE)
  const rel = 1 - Math.exp(-1 / (0.1 * RATE))
  const need = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) need[i] = Math.min(1, ceiling / Math.max(1e-9, Math.abs(x[i]! * boost)))
  let env = 1
  const y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) {
    let g = 1
    for (let j = i; j < i + ahead && j < x.length; j++) g = Math.min(g, need[j]!)
    env = g < env ? g : env + (g - env) * rel
    y[i] = x[i]! * boost * env
  }
  x.set(y)
}

/** A take's loudness: the RMS of its middle (its ends fade). */
function middle(x: Float32Array): number {
  const a = Math.floor(x.length * 0.2)
  const b = Math.floor(x.length * 0.8)
  let e = 0
  for (let i = a; i < b; i++) e += x[i]! * x[i]!
  return Math.sqrt(e / Math.max(1, b - a))
}

function encode(from: string, to: string, rate: string): void {
  run('ffmpeg', ['-loglevel', 'error', '-y', '-i', from, '-c:a', 'aac', '-b:a', rate, to])
}

/**
 * The moods a scene reaches: run it (on a band and in a spine) up through
 * every level and back down, a few times over, noting each moment's mood.
 */
function moodsOf(scene: string): BedMood[] {
  const spec = MOODS[scene]!
  const seen = new Map<string, BedMood>()
  for (const [cols, rows] of [[120, 5], [22, 50]] as const) {
    const f = makeScene(scene as never, 11)
    f.ensure(cols, rows)
    const plan = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 7, 5, 3, 1, 10, 1, 6, 10, 4, 1]
    for (let round = 0; round < 2; round++)
      for (const level of plan)
        for (let i = 0; i < 420; i++) {
          f.strength = level
          f.step()
          if (f.sounds) f.sounds.length = 0
          const m = spec({ scene, level: f.strength, tint: 'normal', night: false, amb: f.ambience?.() ?? {} })
          if (!seen.has(m.key)) seen.set(m.key, m)
        }
  }
  return [...seen.values()]
}

// Mix each scene's moods: a take of each layer at the mood's gain (the layers'
// takes rotated, so no two mixes share a pairing), at -3 dBFS; the gain that
// puts it back to the layers' own level goes in the manifest (BED_GAINS).
const gainsFile = join(CACHE, 'bed-gains.json')
const gains: Record<string, number> = existsSync(gainsFile) ? JSON.parse(readFileSync(gainsFile, 'utf8')) : {}
const PEAK = Math.pow(10, -3 / 20)
for (const scene of Object.keys(LAYERS)) {
  const layers = LAYERS[scene]!
  const touched = full || only.includes(scene) || layers.some(l => only.includes(l.clip.split('/')[0]!))
  if (!touched) continue
  rmSync(join(OUT, scene), { recursive: true, force: true })
  mkdirSync(join(OUT, scene), { recursive: true })
  for (const k of Object.keys(gains)) if (k.startsWith(`${scene}/`)) delete gains[k]
  const moods = moodsOf(scene)
  for (const mood of moods) {
    const g = layers.map((_, i) => layerGain(scene, i, mood))
    const mixes: Float32Array[] = []
    for (let n = 0; n < BED_TAKES; n++) {
      let mix: Float32Array | undefined
      layers.forEach((l, i) => {
        if (g[i]! <= 0.005) return
        const x = readWav(join(CACHE, `${l.clip}${((n + i) % BED_TAKES) + 1}.wav`))
        mix ??= new Float32Array(x.length)
        for (let k = 0; k < mix.length && k < x.length; k++) mix[k]! += x[k]! * g[i]!
      })
      if (mix) mixes.push(mix)
    }
    let peak = 0
    for (const m of mixes) for (const v of m) peak = Math.max(peak, Math.abs(v))
    if (peak < 1e-4) {
      gains[`${scene}/${mood.key}`] = 0
      continue
    }
    // Played at the scene's loudest, would it need more than 1.3 (afplay clips past ~1.4)? Then limit its peaks
    // by that much, so it plays as loud at a gain it can take.
    const loudest = Math.max(...Array.from({ length: 21 }, (_, i) => master(scene, i / 2)))
    const over = Math.max(1, (loudest * peak) / PEAK / 1.3)
    gains[`${scene}/${mood.key}`] = Number((peak / PEAK / over).toFixed(4))
    mixes.forEach((m, n) => {
      for (let k = 0; k < m.length; k++) m[k]! *= PEAK / peak
      if (over > 1) limit(m, over, PEAK)
      const w = join(CACHE, scene, `_bed-${mood.key}${n + 1}.wav`)
      mkdirSync(join(CACHE, scene), { recursive: true })
      wav(w, m)
      encode(w, join(OUT, scene, `bed-${mood.key}${n + 1}.m4a`), '32k')
      rmSync(w)
    })
  }
  console.log(`sounds/${scene}: ${moods.length} moods (${moods.map(m => m.key).join(' ')})`)
}
writeFileSync(gainsFile, JSON.stringify(gains, null, 1))

// The manifest: every clip there is, and each mood's gain.
const files = readdirSync(OUT)
  .flatMap(folder => readdirSync(join(OUT, folder)).map(f => `sounds/${folder}/${f}`))
  .sort()
const sorted = Object.keys(gains).sort()
writeFileSync(
  join(ROOT, 'hooks', 'sound-files.ts'),
  `// REVISION: flow-v106-sound-moods\n//\n// Written by scripts/make-sounds.ts: every clip in sounds/, and the gain that\n// puts each mood's mixed bed back to its layers' level (0: silent). Don't edit.\n\nexport const SOUND_FILES: readonly string[] = [\n${files.map(f => `  '${f}',`).join('\n')}\n]\n\nexport const BED_GAINS: Readonly<Record<string, number>> = {\n${sorted.map(k => `  '${k}': ${gains[k]},`).join('\n')}\n}\n`,
)
console.log(`hooks/sound-files.ts: ${files.length} clips, ${sorted.length} moods`)
