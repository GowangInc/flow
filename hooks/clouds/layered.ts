// REVISION: flow-v42-renderer-polish
//
// Layered: the cloud type changes as the balloon climbs, all of it painted in
// color with feathered edges.
//
//   low  (rows ~6-20)  fair-weather cumulus: sculpted heaps of round puffs on
//                      a flat base, sunlit tops and gray-blue undersides (the
//                      `cumulus` geometry), but with no hard outline: each
//                      heap's signed distance is feathered into the blue and
//                      its rim roughened with a little noise (the `soft` look).
//   mid  (rows ~18-31) stratocumulus / altocumulus: broad, flatter banks
//                      broken into lumpy cells and rolls with blue between,
//                      cooler and dimmer than the cumulus.
//   high (rows ~29-44) cirrus: thin, fibrous streaks of gray-blue, faint and
//                      sparse, fading into the darkening sky.
//
// Every cell is two half cells (▀: top half in fg, bottom half in bg), each
// composited back to front (cirrus, then banks, then cumulus) as the sky
// blended toward each layer's color by its coverage.

import { clamp01, hash, mix } from '../pixels'
import type { CloudPainter } from './types'

const TOP_HALF = 0x2580 // ▀

const smooth = (k: number) => k * k * (3 - 2 * k)
const smoothstep = (a: number, b: number, v: number) => smooth(clamp01((v - a) / (b - a)))

/** Smooth value noise in [0, 1) at a real (u, v). */
function noise(u: number, v: number, salt: number): number {
  const iu = Math.floor(u)
  const iv = Math.floor(v)
  const fu = smooth(u - iu)
  const fv = smooth(v - iv)
  const a = hash(iu, iv, salt)
  const b = hash(iu + 1, iv, salt)
  const c = hash(iu, iv + 1, salt)
  const d = hash(iu + 1, iv + 1, salt)
  const top = a + (b - a) * fu
  return top + (c + (d - c) * fu - top) * fv
}

// ---------------------------------------------------------------------------
// Low: feathered cumulus heaps.

/** World grid of cumulus slots: at most one heap per slot. */
const SLOT_W = 38
const SLOT_H = 4.6
const SLOT_FROM = 6.6
const SLOT_ROWS = 3
const MAX_PUFFS = 12
/** How far (columns / half rows) past a puff's edge its feathered rim reaches. */
const FEATHER = 1.7

/** Shading ramp, shadow → highlight. */
const DEEP = 0x7d8fb0
const SHADOW = 0xa3b2cb
const MID = 0xd2dbe8
const LIGHT = 0xf0f3f8
const SUN = 0xffffff

/** Light from above and a little to the left, toward the viewer. */
const LX = -0.45
const LY = 0.82
const LZ = 0.45

type Heap = {
  n: number
  /** Flat base and top, in half rows. */
  base: number
  top: number
  x0: number
  x1: number
  px: Float64Array
  py: Float64Array
  pr: Float64Array
}

const heaps = new Map<number, Heap>()

function heapAt(sx: number, sy: number): Heap {
  const key = sx * 8 + sy
  let c = heaps.get(key)
  if (c) return c
  if (heaps.size > 4096) heaps.clear()
  c = build(sx, sy)
  heaps.set(key, c)
  return c
}

function build(sx: number, sy: number): Heap {
  const px = new Float64Array(MAX_PUFFS)
  const py = new Float64Array(MAX_PUFFS)
  const pr = new Float64Array(MAX_PUFFS)
  const c: Heap = { n: 0, base: 0, top: 0, x0: 0, x1: 0, px, py, pr }
  if (sy < 0 || sy >= SLOT_ROWS) return c
  // The top tier is sparse and small: the cumulus give way to the banks.
  const odds = sy === 0 ? 0.58 : sy === 1 ? 0.54 : 0.4
  if (hash(sx, sy, 110) > odds) return c
  const baseRow = SLOT_FROM + sy * SLOT_H + hash(sx, sy, 111) * (SLOT_H - 1.2)

  // Mostly small and medium, now and then a big heap.
  const s = hash(sx, sy, 112)
  const size = (s < 0.4 ? 0.35 + s : s < 0.85 ? 0.75 + (s - 0.4) * 0.5 : 1 + (s - 0.85) * 3) * (sy === 2 ? 0.7 : 1)
  const width = 8 + size * 20
  const height = 3 + size * 4.5 + Math.max(0, size - 1) * 5
  const cx = sx * SLOT_W + 7 + hash(sx, sy, 113) * (SLOT_W - 14)
  const base = baseRow * 2

  // Bottom tier: overlapping puffs along the base, biggest in the middle.
  const n0 = Math.max(2, Math.min(7, Math.round(width / 6)))
  const rMain = height / 1.2
  let k = 0
  let run = 0
  for (let i = 0; i < n0; i++) {
    const u = (i / (n0 - 1)) * 2 - 1
    const r = rMain * (0.6 + 0.4 * (1 - u * u)) * (0.85 + 0.3 * hash(sx, sy * 7 + i, 116))
    if (i > 0) run += (pr[i - 1]! + r) * (0.55 + 0.2 * hash(sx * 31 + i, sy, 115))
    px[k] = run
    py[k] = base + r * (0.12 + 0.25 * hash(sx + i, sy, 117))
    pr[k] = r
    k++
  }
  for (let i = 0; i < n0; i++) px[i] = px[i]! - run / 2 + cx
  // Upper tier: cauliflower bumps on the central puffs.
  const n1 = Math.min(MAX_PUFFS - n0, 1 + Math.floor(size * 2.5 + hash(sx, sy, 118) * 2))
  for (let j = 0; j < n1; j++) {
    const i = Math.floor(hash(sx, sy + j, 119) * n0 * 0.6 + n0 * 0.2)
    const host = Math.min(n0 - 1, Math.max(0, i))
    const a = (hash(sx, sy + j, 120) - 0.5) * 1.6
    const hr = pr[host]!
    const r = Math.max(1.8, hr * (0.5 + 0.25 * hash(sx + j, sy, 121)))
    px[k] = px[host]! + Math.sin(a) * hr * 0.75
    py[k] = py[host]! + Math.cos(a) * hr * 0.55 + r * 0.25
    pr[k] = r
    k++
  }
  // Back to front: higher puffs farther back.
  for (let i = 1; i < k; i++) {
    for (let j = i; j > 0 && py[j - 1]! + pr[j - 1]! * 0.3 < py[j]! + pr[j]! * 0.3; j--) {
      const tx = px[j]!, ty = py[j]!, tr = pr[j]!
      px[j] = px[j - 1]!; py[j] = py[j - 1]!; pr[j] = pr[j - 1]!
      px[j - 1] = tx; py[j - 1] = ty; pr[j - 1] = tr
    }
  }
  let top = base + 1, x0 = Infinity, x1 = -Infinity
  for (let i = 0; i < k; i++) {
    top = Math.max(top, py[i]! + pr[i]!)
    x0 = Math.min(x0, px[i]! - pr[i]!)
    x1 = Math.max(x1, px[i]! + pr[i]!)
  }
  if (top > 46) return c // keep the heaps low; the banks own the middle
  c.n = k
  c.base = base
  c.top = top
  c.x0 = x0 - FEATHER
  c.x1 = x1 + FEATHER
  return c
}

function ramp(l: number): number {
  if (l < 0.2) return mix(DEEP, SHADOW, l / 0.2)
  if (l < 0.5) return mix(SHADOW, MID, (l - 0.2) / 0.3)
  if (l < 0.78) return mix(MID, LIGHT, (l - 0.5) / 0.28)
  return mix(LIGHT, SUN, Math.min(1, (l - 0.78) / 0.22))
}

// Results of the last sample, as numbers (no allocation per call).
let outA = 0
let outC = 0

/** Cumulus coverage (outA) and color (outC) at column wx, half row qy. */
function cumulus(wx: number, qy: number): void {
  outA = 0
  const sxc = Math.floor(wx / SLOT_W)
  const y = qy / 2
  const syc = Math.floor((y - SLOT_FROM) / SLOT_H)
  for (let dy = -2; dy <= 0; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = heapAt(sxc + dx, syc + dy)
      if (c.n === 0 || qy < c.base - 1 || qy > c.top + FEATHER || wx < c.x0 || wx > c.x1) continue
      // Signed distance to the heap (positive inside), and a normal blended
      // from the puffs near the point, weighted toward the one it is deepest
      // in, so the lighting rolls smoothly from bump to bump with no seams.
      let sd = -Infinity
      let wsum = 0
      let nx = 0
      let ny = 0
      for (let i = 0; i < c.n; i++) {
        const ox = wx - c.px[i]!
        const oy = qy - c.py[i]!
        const r = c.pr[i]!
        const s = r - Math.sqrt(ox * ox + oy * oy)
        if (s > sd) sd = s
        if (s < -FEATHER) continue
        // Front puffs (later) win ties: they overlap the ones behind.
        let w = (Math.min(s, 4) + FEATHER) * (1 + i * 0.12)
        w *= w
        w *= w
        w *= w
        wsum += w
        nx += (ox / r) * w
        ny += (oy / r) * w
      }
      if (wsum === 0) continue
      // A fluffy rim: roughen the distance with small-scale noise.
      const rough = (noise(wx / 2.3, qy / 2.1, 131) - 0.5) * 1.8 + (noise(wx / 1.1, qy / 1.2, 132) - 0.5) * 0.7
      let a = smoothstep(-FEATHER, 1.4, sd + rough)
      // The flat base, feathered over about a row.
      a *= smoothstep(c.base - 1.8, c.base + 1.6, qy + rough * 0.5)
      if (a <= outA) continue
      nx /= wsum
      ny /= wsum
      const l2 = nx * nx + ny * ny
      if (l2 > 1) {
        const l = Math.sqrt(l2)
        nx /= l
        ny /= l
      }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
      const dot = nx * LX + ny * LY + nz * LZ
      const h = (qy - c.base) / (c.top - c.base)
      let lit = 0.42 + dot * 0.72 + (h - 0.4) * 0.6
      // The underside sits in the heap's own shadow, shading down to the base.
      const under = smoothstep(-0.5, Math.min(4, 0.35 * (c.top - c.base)), qy - c.base)
      lit = Math.min(lit, 0.06 + under * 1.1)
      outA = a * 0.98
      outC = ramp(clamp01(lit))
    }
  }
}

// ---------------------------------------------------------------------------
// Middle: stratocumulus and altocumulus.
//
// Each deck is a jittered grid of flattened, lumpy elements (rolls low down,
// small rounded "sheep" higher up). A slow weather noise decides how many
// grid cells hold an element: crowded, they merge into a broken bank; sparse,
// they float apart in groups with blue between.

const BANK_LIT = 0xeef2f8
const BANK_SHADE = 0x8b9bb8
const ALTO_LIT = 0xd6dfee
const ALTO_SHADE = 0x7385a8

/** Per deck: lowest row, rows of elements, element cell size (cols, rows), size. */
const DECK_Y = [16.8, 22.8]
const DECK_ROWS = [3, 4]
const CELL_W = [15, 8]
const CELL_H = [2.1, 1.9]
const RX = [8.5, 3.8] // half width, columns
const RY = [1.7, 1.05] // half height above the center, in rows
const DECK_ALPHA = [0.94, 0.86]

/** Element (ex, ey, rx, ry; rx = 0 for none) in grid cell (i, j) of deck k, built once. */
const elements = new Map<number, Float64Array>()

function elementAt(k: number, i: number, j: number): Float64Array {
  const key = i * 16 + k * 8 + j
  let el = elements.get(key)
  if (el) return el
  if (elements.size > 4096) elements.clear()
  el = new Float64Array(5)
  const cw = CELL_W[k]!
  // Weather: how crowded this stretch of the deck is.
  const crowd = noise((i * cw) / (k === 0 ? 75 : 55) + k * 11.3, j * 0.35 + k * 4.1, 173)
  const odds = (k === 0 ? smoothstep(0.32, 0.72, crowd) : smoothstep(0.24, 0.62, crowd)) * (j === DECK_ROWS[k]! - 1 ? 0.5 : 0.85)
  if (hash(i, j, 175 + k) <= odds) {
    const size = 0.55 + 0.7 * hash(i, j, 177 + k) + 0.25 * crowd
    el[0] = (i + 0.5 + (hash(i, j, 179 + k) - 0.5) * 0.9) * cw
    el[1] = DECK_Y[k]! + (j + 0.5 + (hash(i, j, 181 + k) - 0.5) * 0.85) * CELL_H[k]!
    el[2] = RX[k]! * size * (crowd > 0.6 ? 1.25 : 1)
    el[3] = RY[k]! * size
    el[4] = hash(i, j, 183) * 6.28
  }
  elements.set(key, el)
  return el
}

/** Coverage (outA) and color (outC) of deck k at column x, real row y. */
function bank(k: number, x: number, y: number): void {
  outA = 0
  const y0 = DECK_Y[k]!
  const cw = CELL_W[k]!
  const ch = CELL_H[k]!
  if (y < y0 - 1.6 || y > y0 + DECK_ROWS[k]! * ch + 2) return
  const ci = Math.floor(x / cw)
  const cj = Math.floor((y - y0) / ch)
  let rough = NaN
  let best = 0
  let bestLit = 0
  for (let dj = -1; dj <= 1; dj++) {
    const j = cj + dj
    if (j < 0 || j >= DECK_ROWS[k]!) continue
    for (let di = -1; di <= 1; di++) {
      const el = elementAt(k, ci + di, j)
      const rx = el[2]!
      if (rx === 0) continue
      const ox = (x - el[0]!) / rx
      if (ox < -1.4 || ox > 1.4) continue
      // Flat-bottomed: below the center the element is squashed.
      const oyRows = y - el[1]!
      const ry = el[3]! * (oyRows < 0 ? 0.5 : 1.28)
      if (oyRows > ry * 1.3 || oyRows < -ry * 1.6) continue
      // A lumpy top: two or three bumps along the element.
      const lump = oyRows > 0 ? (1 + 0.28 * Math.sin(ox * 4.2 + el[4]!)) / 1.28 : 1
      const oy = oyRows / (ry * lump)
      // Lumpy texture inside each element and a ragged rim.
      if (rough !== rough) rough = (noise(x / 1.9, y / 0.75, 171 + k) - 0.5) * 0.5
      const e = Math.sqrt(ox * ox + oy * oy) + rough
      const a = 1 - smoothstep(0.5, 1.15, e)
      if (a <= best) continue
      best = a
      // Lit from above, shaded at the flat base.
      bestLit = clamp01(0.5 + 0.38 * oy + 0.2 * (1 - e) + (k === 0 ? 0.05 : 0) + (rough - 0.1) * 0.7)
    }
  }
  if (best <= 0.01) return
  outA = best * DECK_ALPHA[k]!
  outC = k === 0 ? mix(BANK_SHADE, BANK_LIT, bestLit) : mix(ALTO_SHADE, ALTO_LIT, bestLit)
}

// ---------------------------------------------------------------------------
// High: cirrus streaks.

const CIRRUS_DIM = 0x8a9dc0
const CIRRUS_BRIGHT = 0xdbe4f2

function cirrus(x: number, y: number): void {
  outA = 0
  if (y < 27.5 || y > 44.6) return
  // Patches of cirrus: sparse.
  const patch = smoothstep(0.42, 0.7, noise(x / 64 + 4.2, y / 7 + 1.1, 161))
  if (patch <= 0) return
  // Streaks: thin ridges of stretched noise, slanting a little.
  const f = noise(x / 34 + y * 0.12, y / 1.15, 163) * 0.75 + noise(x / 11, y / 0.8, 165) * 0.25
  const ridge = 1 - Math.abs(f - 0.5) * 2
  let a = smoothstep(0.72, 0.97, ridge)
  if (a <= 0) return
  // Fibers: a fine grain along the streak, and frayed ends.
  a *= 0.55 + 0.45 * noise(x / 2.2, y * 3.1, 167)
  a *= patch
  // In from the bottom, fading toward the top of the band.
  a *= smoothstep(27.5, 32, y) * (1 - smoothstep(42.5, 44.8, y))
  if (a <= 0.01) return
  outA = a * 0.62
  outC = mix(CIRRUS_DIM, CIRRUS_BRIGHT, clamp01(ridge * 1.2 - 0.2) * (1 - smoothstep(30, 44, y) * 0.5))
}

// ---------------------------------------------------------------------------

/** The color of a half cell at column x, real row y: sky, then each layer over it. */
function half(x: number, y: number, sky: number): number {
  let col = sky
  cirrus(x + 0.5, y)
  if (outA > 0) col = mix(col, outC, outA)
  for (let k = 1; k >= 0; k--) {
    bank(k, x + 0.5, y)
    if (outA > 0) col = mix(col, mix(outC, sky, smoothstep(22, 32, y) * 0.25), outA)
  }
  if (y < 24.5) {
    cumulus(x + 0.5, y * 2)
    if (outA > 0) col = mix(col, outC, outA)
  }
  return col
}

/** Channel steps a cloud color snaps to, measured from the sky behind it: finer on a dark sky. */
const Q_DAY = 12
const Q_DARK = 8

/**
 * A cloud color snapped to steps away from the sky behind it (the sky itself
 * when it's within half a step): the feathered rims and soft shading
 * otherwise make nearly every cell a color of its own, more than the Raster
 * can paint. Measured from the sky, a faint cloud keeps the sky's hue. Snap
 * once, after any lighting and blending.
 */
export function snap(c: number, sky: number): number {
  const q = ((sky >> 16) & 255) < 64 && ((sky >> 8) & 255) < 64 && (sky & 255) < 64 ? Q_DARK : Q_DAY
  const ch = (sh: number) => {
    const s = (sky >> sh) & 255
    return Math.max(0, Math.min(255, s + Math.round((((c >> sh) & 255) - s) / q) * q))
  }
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

export const layered: CloudPainter = {
  name: 'layered',
  description: 'changes with height: soft cumulus low, broken banks mid, cirrus streaks high',
  cell({ x, y, sky }) {
    const top = half(x, y + 0.25, sky)
    const bot = half(x, y - 0.25, sky)
    if (top === sky && bot === sky) return undefined
    return { glyph: TOP_HALF, fg: top, bg: bot }
  },
}
