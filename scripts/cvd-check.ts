// REVISION: flow-v120-cvd-check
//
// Whether the tints read for colour-blind eyes. Every scene runs at levels 1,
// 5 and 10, in the band (120 × 5) and the spine (22 × 50), by day and (for a
// scene with one) by night: untinted for a while, then each tint, as Flow
// shows it. Its frames become pixels the way desktop draws them (2 × 4 a
// cell, svg.ts), laid over a dark terminal, and are seen with normal vision,
// as protanopia, deuteranopia and tritanopia (Machado, Oliveira & Fernandes
// 2009, full severity, on linear RGB) and as achromatopsia (luminance only).
// Then, for each pair of tints, ten frames of each side by side (same seed,
// same moment):
//
//   area   the part of the frame the tint changes: the pixels it moves more
//          than ΔE00 3 for normal vision.
//   ΔE     how far that part moves, as each vision sees it: the mean
//          CIEDE2000 over its pixels. The headline. A vision that loses the
//          tint keeps the pixels and loses the distance. It counts motion
//          too, where a tint changes what happens (a skier's fall, a wipeout).
//   cast   the whole scene's overall colour (the mean of every pixel it
//          draws), ΔE00: what a glance takes in of a tint over all of it.
//
// Achromatopsia sees luminance alone, so its column is the luminance
// contrast: the cue every kind of colour blindness keeps.
//
// A tint is a state seen on its own (blue holds while the context stays
// full), not a swatch held up beside the normal one, and the scene is small
// and seen from the corner of the eye, so the bar is well above a just
// noticeable difference (ΔE00 ≈ 1 side by side): under 5 it can't be told
// apart at a glance, under 10 it's weak (seen only when looked for), 10–20
// shows, 20 and over is clear. Smoke lasts only ~2 s after a failure (30
// frames), so it's measured in that window too (`normal↔smoke@30`).
//
// Not part of the mod (Node).
//
//   npm run cvd                      every scene: the tables, then the weak cases
//   npm run cvd -- surf ski          just these
//   npm run cvd -- --light           over a light terminal instead
//   npm run cvd -- --sheets DIR      also write contact sheets of the weakest settings
//   npm run cvd -- --sheets DIR --every   a sheet of every setting
//   npm run cvd -- --json FILE       and every measurement as JSON
//
// A contact sheet (PNG) is one setting of one scene: the band's has a row for
// each vision (normal, protanopia, deuteranopia, tritanopia, achromatopsia)
// and a column for each tint (normal, smoke, blue); the spine's is turned
// round, a row for each tint and a column for each vision.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Cells } from '../hooks/cells'
import { makeScene, type SceneName, type Tint } from '../hooks/styles'
import { encodePng, gridPixels } from '../hooks/svg'
import { nightsOf, scenesFrom, TINTS } from './scene-lab'

const argv = process.argv.slice(2)
const opt = (name: string) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const sheetsDir = opt('--sheets')
const jsonFile = opt('--json')
const light = argv.includes('--light')
const every = argv.includes('--every')
const names = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--sheets' && argv[i - 1] !== '--json')

/** The terminal behind the scene. */
const BG = light ? 0xfafafa : 0x1e1e1e
const LAYOUTS = [
  { name: 'band', columns: 120, rows: 5 },
  { name: 'spine', columns: 22, rows: 50 },
] as const
const LEVELS = [1, 5, 10]
/** Frames untinted before the tint comes on: long enough for the level to settle. */
const WARM = 150
/** Frames after it came on that are measured: in smoke's ~2 s window, and settled. */
const WINDOW = [10, 20, 30]
const STEADY = [90, 100, 110, 120, 130, 140, 150, 160, 170, 180]
const LAST = Math.max(...WINDOW, ...STEADY)
/** A pixel the tint moves more than this (ΔE00, normal vision) counts as changed, side by side. */
const CHANGED = 3
/** Under this ΔE00 a tint can't be told at a glance; under WEAK it's seen only when looked for. */
const FAIL = 5
const WEAK = 10

// ---- colour ------------------------------------------------------------------

const toLinear = new Float64Array(256).map((_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

/** Machado et al. 2009, severity 1, on linear RGB; achromatopsia is luminance alone. */
const VISIONS = {
  normal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
  achromat: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
} as const
type Vision = keyof typeof VISIONS
const VISION_NAMES = Object.keys(VISIONS) as Vision[]
type Lab = [number, number, number]

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Linear RGB as seen with `v`, clipped to the gamut. */
function see(v: Vision, r: number, g: number, b: number): Lab {
  const m = VISIONS[v]
  return [
    clamp01(m[0] * r + m[1] * g + m[2] * b),
    clamp01(m[3] * r + m[4] * g + m[5] * b),
    clamp01(m[6] * r + m[7] * g + m[8] * b),
  ]
}

const fLab = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)

/** Linear sRGB to CIELAB (D65). */
function lab(r: number, g: number, b: number): Lab {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  const fx = fLab(x)
  const fy = fLab(y)
  const fz = fLab(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

const RAD = Math.PI / 180

/** CIEDE2000 (Sharma, Wu & Dalal 2005; it gives their test pairs to 4 places). */
function de2000(p: Lab, q: Lab): number {
  const [L1, a1, b1] = p
  const [L2, a2, b2] = q
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1 = Math.hypot(a1p, b1)
  const C2 = Math.hypot(a2p, b2)
  const h1 = C1 === 0 ? 0 : (Math.atan2(b1, a1p) / RAD + 360) % 360
  const h2 = C2 === 0 ? 0 : (Math.atan2(b2, a2p) / RAD + 360) % 360
  let dh = 0
  if (C1 * C2 !== 0) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dL = L2 - L1
  const dC = C2 - C1
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * RAD)
  const Lm = (L1 + L2) / 2
  const Cm = (C1 + C2) / 2
  let hm = h1 + h2
  if (C1 * C2 !== 0) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2
  const T =
    1 -
    0.17 * Math.cos((hm - 30) * RAD) +
    0.24 * Math.cos(2 * hm * RAD) +
    0.32 * Math.cos((3 * hm + 6) * RAD) -
    0.2 * Math.cos((4 * hm - 63) * RAD)
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2)
  const Sc = 1 + 0.045 * Cm
  const Sh = 1 + 0.015 * Cm * T
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh))
}

/** Each packed sRGB colour as seen with each vision (linear RGB and Lab), cached. */
const seen = new Map<number, { lin: Lab; lab: Lab }[]>()
function look(c: number, v: number) {
  let e = seen.get(c)
  if (!e) {
    const r = toLinear[(c >> 16) & 255]!
    const g = toLinear[(c >> 8) & 255]!
    const b = toLinear[c & 255]!
    e = VISION_NAMES.map(name => {
      const lin = see(name, r, g, b)
      return { lin, lab: lab(...lin) }
    })
    seen.set(c, e)
  }
  return e[v]!
}

/** ΔE00 between two packed colours as vision `v` sees them, cached. */
const deMemo = VISION_NAMES.map(() => new Map<number, number>())
function deColor(a: number, b: number, v: number): number {
  if (a === b) return 0
  const key = a * 16777216 + b
  let d = deMemo[v]!.get(key)
  if (d === undefined) deMemo[v]!.set(key, (d = de2000(look(a, v).lab, look(b, v).lab)))
  return d
}

// ---- frames ------------------------------------------------------------------

/** A frame laid over the terminal: packed sRGB per pixel, and which pixels the scene drew. */
type Frame = { width: number; height: number; rgb: Int32Array; lit: Uint8Array }

function frameOf(grid: Cells): Frame {
  const p = gridPixels(grid, 2, 4)
  const n = p.width * p.height
  const rgb = new Int32Array(n)
  const lit = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const a = p.rgba[i * 4 + 3]!
    lit[i] = a > 0 ? 1 : 0
    // Over the terminal, blended in sRGB as a terminal or a browser does.
    const k = a / 255
    let c = 0
    for (let ch = 0; ch < 3; ch++) {
      const back = (BG >> (16 - 8 * ch)) & 255
      c = (c << 8) | Math.round(p.rgba[i * 4 + ch]! * k + back * (1 - k))
    }
    rgb[i] = c
  }
  return { width: p.width, height: p.height, rgb, lit }
}

/** A scene's frames at WINDOW and STEADY: untinted for WARM frames, then `tint`. */
function capture(scene: SceneName, columns: number, rows: number, level: number, night: boolean, tint: Tint) {
  const f = makeScene(scene, 7)
  f.strength = level
  f.tint = 'normal'
  f.night = night
  f.ensure(columns, rows)
  for (let i = 0; i < WARM; i++) f.step()
  f.tint = tint
  const frames = new Map<number, Frame>()
  for (let t = 1; t <= LAST; t++) {
    f.step()
    if (WINDOW.includes(t) || STEADY.includes(t)) frames.set(t, frameOf(f.grid()))
  }
  return frames
}

/** The mean linear colour of the frames' pixels where `take` says, as Lab for vision `v`. */
function meanLab(frames: Frame[], v: number, take: (k: number, i: number) => boolean): Lab {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  frames.forEach((f, k) => {
    for (let i = 0; i < f.rgb.length; i++) {
      if (!take(k, i)) continue
      const s = look(f.rgb[i]!, v).lin
      r += s[0]
      g += s[1]
      b += s[2]
      n++
    }
  })
  return n ? lab(r / n, g / n, b / n) : look(BG, v).lab
}

const toSrgb = (l: number) => Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055))

// ---- measuring -----------------------------------------------------------------

type Pair = 'normal↔smoke' | 'normal↔blue' | 'smoke↔blue' | 'normal↔smoke@30'
const PAIRS: [Pair, Tint, Tint, number[]][] = [
  ['normal↔smoke', 'normal', 'smoke', STEADY],
  ['normal↔blue', 'normal', 'blue', STEADY],
  ['smoke↔blue', 'smoke', 'blue', STEADY],
  ['normal↔smoke@30', 'normal', 'smoke', WINDOW],
]

type Row = {
  scene: SceneName
  layout: string
  level: number
  night: boolean
  pair: Pair
  vision: Vision
  /** Of the frame, how much the tint changes for normal vision (0..1). */
  area: number
  /** The mean ΔE00 over those pixels, as this vision sees them. */
  de: number
  /** The whole scene's overall colour, ΔE00. */
  cast: number
}

const rows: Row[] = []
const kept = new Map<string, Record<Tint, Frame>>()
const where = (r: { layout: string; level: number; night: boolean }) => `${r.layout} L${r.level}${r.night ? ' night' : ''}`

for (const scene of scenesFrom(names)) {
  process.stderr.write(`${scene}… `)
  for (const layout of LAYOUTS) {
    for (const level of LEVELS) {
      for (const night of nightsOf(scene)) {
        const shots = Object.fromEntries(
          TINTS.map(t => [t, capture(scene, layout.columns, layout.rows, level, night, t)]),
        ) as Record<Tint, Map<number, Frame>>
        const middle = STEADY[STEADY.length >> 1]!
        kept.set(
          `${scene} ${where({ layout: layout.name, level, night })}`,
          Object.fromEntries(TINTS.map(t => [t, shots[t].get(middle)!])) as Record<Tint, Frame>,
        )
        for (const [pair, ta, tb, when] of PAIRS) {
          const a = when.map(k => shots[ta].get(k)!)
          const b = when.map(k => shots[tb].get(k)!)
          // What normal vision sees the tint change, pixel by pixel; every vision is measured over it.
          const changed = a.map((fa, k) => fa.rgb.map((c, i) => (deColor(c, b[k]!.rgb[i]!, 0) > CHANGED ? 1 : 0)))
          let count = 0
          for (const m of changed) for (const x of m) count += x
          for (let v = 0; v < VISION_NAMES.length; v++) {
            let sum = 0
            for (const [k, fa] of a.entries()) {
              const fb = b[k]!
              for (let i = 0; i < fa.rgb.length; i++) if (changed[k]![i]) sum += deColor(fa.rgb[i]!, fb.rgb[i]!, v)
            }
            rows.push({
              scene,
              layout: layout.name,
              level,
              night,
              pair,
              vision: VISION_NAMES[v]!,
              area: count / (a.length * a[0]!.rgb.length),
              de: count ? sum / count : 0,
              cast: de2000(
                meanLab(a, v, (k, i) => a[k]!.lit[i] === 1),
                meanLab(b, v, (k, i) => b[k]!.lit[i] === 1),
              ),
            })
          }
        }
      }
    }
  }
}
process.stderr.write('\n')

// ---- reporting -----------------------------------------------------------------

const fmt = (x: number) => x.toFixed(1).padStart(5)
const mark = (x: number) => (x < FAIL ? '\x1b[31m' : x < WEAK ? '\x1b[33m' : '') + fmt(x) + '\x1b[0m'
const scenes = scenesFrom(names)
const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[xs.length >> 1]!
const keyOf = (r: Row) => `${r.scene} ${where(r)} ${r.pair}`

console.log(`How far apart the tints look, ΔE00 over what the tint changes: the worst setting (layout × level`)
console.log(`× day/night) and (the median). Area: the median share of the frame it changes. Over a ${light ? 'light' : 'dark'}`)
console.log(`terminal. Under ${FAIL} red, under ${WEAK} yellow.`)
for (const [pair] of PAIRS) {
  console.log(`\n\x1b[1m${pair}\x1b[0m`)
  console.log('scene      area  ' + VISION_NAMES.map(v => v.padEnd(13)).join(''))
  for (const scene of scenes) {
    const mine = rows.filter(r => r.scene === scene && r.pair === pair)
    const area = median(mine.filter(r => r.vision === 'normal').map(r => r.area))
    const cells = VISION_NAMES.map(v => {
      const ds = mine.filter(r => r.vision === v).map(r => r.de)
      return `${mark(Math.min(...ds))} (${median(ds).toFixed(0).padStart(2)})  `
    })
    console.log(`${scene.padEnd(10)}${(area * 100).toFixed(0).padStart(4)}%  ${cells.join('')}`)
  }
}

const settled = rows.filter(r => r.pair !== 'normal↔smoke@30')
const seenNormally = new Map(settled.filter(r => r.vision === 'normal').map(r => [keyOf(r), r.de]))
// Lost to colour blindness: clear to normal vision, weak to this one.
const lost = settled
  .filter(r => r.vision !== 'normal' && r.de < WEAK && seenNormally.get(keyOf(r))! >= WEAK)
  .sort((a, b) => a.de - b.de)
const lostHue = lost.filter(r => r.vision !== 'achromat')
const lostLight = lost.filter(r => r.vision === 'achromat')
console.log(`\n\x1b[1mLost to colour blindness\x1b[0m: settled tints at least ${WEAK} for normal vision, under ${WEAK} for this one (${lostHue.length})`)
console.log('scene     setting           pair          vision      ΔE  normal   cast   area')
for (const r of lostHue) {
  console.log(
    `${r.scene.padEnd(10)}${where(r).padEnd(18)}${r.pair.padEnd(14)}${r.vision.padEnd(9)}${mark(r.de)}   ${fmt(seenNormally.get(keyOf(r))!)}  ${fmt(r.cast)}  ${(r.area * 100).toFixed(1).padStart(4)}%`,
  )
}
const listed = (list: Row[], show: (r: Row) => string) => {
  for (const scene of scenes) {
    for (const [pair] of PAIRS) {
      const these = list.filter(r => r.scene === scene && r.pair === pair)
      if (these.length) console.log(`${scene.padEnd(10)}${pair.padEnd(14)}${these.map(show).join(' · ')}`)
    }
  }
}
console.log(`\n\x1b[1mLost to luminance alone\x1b[0m (achromatopsia), the same way (${lostLight.length}): ΔE, normal vision's`)
listed(lostLight, r => `${where(r)} ${r.de.toFixed(1)}, ${seenNormally.get(keyOf(r))!.toFixed(0)}`)
// Weak for everyone: under WEAK for normal vision too.
const faint = settled.filter(r => r.vision === 'normal' && r.de < WEAK)
console.log(`\n\x1b[1mWeak for everyone\x1b[0m: settled tints under ${WEAK} for normal vision (${faint.length}): ΔE, area`)
listed(faint, r => `${where(r)} ${r.de.toFixed(1)}, ${(r.area * 100).toFixed(1)}%`)

if (jsonFile) writeFileSync(jsonFile, JSON.stringify(rows, null, 1))

if (sheetsDir) {
  // The settings colour blindness loses most (two a scene at most), then those luminance alone loses
  // and the faintest for everyone (one a scene each); or every one.
  mkdirSync(sheetsDir, { recursive: true })
  const pick = (list: Row[], prefix: string, most: number) => {
    const out: string[] = []
    const perScene = new Map<string, number>()
    for (const r of list) {
      const k = `${r.scene} ${where(r)}`
      if (out.some(o => o.endsWith(k))) continue
      const n = perScene.get(r.scene) ?? 0
      if (n >= most) continue
      perScene.set(r.scene, n + 1)
      out.push(`${prefix} ${k}`)
    }
    return out
  }
  const chosen = every
    ? [...kept.keys()].map(k => `set ${k}`)
    : [...pick(lostHue, 'cvd', 2), ...pick(lostLight, 'lum', 1), ...pick([...faint].sort((a, b) => a.de - b.de), 'all', 1)]
  console.log('\nContact sheets:')
  for (const k of chosen) {
    const file = join(sheetsDir, `${k.replace(/ /g, '-')}.png`)
    writeFileSync(file, encodePng(contactSheet(kept.get(k.slice(4))!, k.includes(' spine '))))
    console.log(file)
  }
}

/** One setting's frames, each tint as each vision sees it, scaled up, as RGBA pixels. */
function contactSheet(frames: Record<Tint, Frame>, tall: boolean) {
  const f0 = frames.normal
  const scale = tall ? 2 : 3
  const gap = 6
  const pw = f0.width * scale
  const ph = f0.height * scale
  const across = tall ? VISION_NAMES.length : TINTS.length
  const down = tall ? TINTS.length : VISION_NAMES.length
  const width = across * pw + (across + 1) * gap
  const height = down * ph + (down + 1) * gap
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) rgba.set([0x80, 0x80, 0x80, 255], i * 4)
  TINTS.forEach((tint, ti) => {
    VISION_NAMES.forEach((_, v) => {
      const f = frames[tint]
      const ox = gap + (tall ? v : ti) * (pw + gap)
      const oy = gap + (tall ? ti : v) * (ph + gap)
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const lin = look(f.rgb[Math.floor(y / scale) * f.width + Math.floor(x / scale)]!, v).lin
          const o = ((oy + y) * width + ox + x) * 4
          for (let ch = 0; ch < 3; ch++) {
            const l = lin[ch]!
            rgba[o + ch] = toSrgb(l)
          }
          rgba[o + 3] = 255
        }
      }
    })
  })
  return { width, height, rgba }
}
