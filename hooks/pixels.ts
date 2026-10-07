// REVISION: flow-v120-noise-grey
//
// Small pieces the scene renderers share: packed-RGB color math, hashes,
// glyph tables, and the fit of a cell's four quadrant pixels to the two
// colors of one quadrant glyph.

/** A glyph's code point. */
export const g = (ch: string) => ch.codePointAt(0)!

/** `v` held to lo..hi (0..1 by default). */
export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** `a` moved `k` (0..1, held there) of the way to `b`, per channel of 0xRRGGBB. */
export function mix(a: number, b: number, k: number): number {
  if (k <= 0) return a
  if (k >= 1) return b
  const ar = (a >> 16) & 255
  const ag = (a >> 8) & 255
  const ab = a & 255
  const r = (ar + (((b >> 16) & 255) - ar) * k + 0.5) | 0
  const gg = (ag + (((b >> 8) & 255) - ag) * k + 0.5) | 0
  const bb = (ab + ((b & 255) - ab) * k + 0.5) | 0
  return (r << 16) | (gg << 8) | bb
}

/** Squared RGB distance between two 0xRRGGBB colors. */
export function dist(a: number, b: number): number {
  const r = ((a >> 16) & 255) - ((b >> 16) & 255)
  const gg = ((a >> 8) & 255) - ((b >> 8) & 255)
  const bb = (a & 255) - (b & 255)
  return r * r + gg * gg + bb * bb
}

/** A stable hash of a world position (integers) to [0, 1): the sky world and its clouds. */
export function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 0x1_0000_0000
}

/** A stable hash of one integer to [0, 1). */
export function hash1(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 0x1_0000_0000
}

/** Smooth 1-D value noise in [0, 1): hash1 at each whole x, eased between (surf's swell, the train's hills). */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const a = hash1(i * 7919 + seed)
  const b = hash1((i + 1) * 7919 + seed)
  return a + (b - a) * f * f * (3 - 2 * f)
}

/** `c` moved `k` (0..1) of the way to its own grey (by luma): an overcast, smoky cast. */
export function grey(c: number, k: number): number {
  const l = (((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) | 0
  return mix(c, (l << 16) | (l << 8) | l, k)
}

/** A stable hash of (x, y, salt) to [0, 1), murmur-finalized (the ski run's). */
export function hashMurmur(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Quadrant glyphs by pixel mask: top-left 1, top-right 2, bottom-left 4, bottom-right 8. */
export const QUAD = [
  0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599,
  0x259f, 0x2588,
] as const

/** The lower-block glyph filling `eighths` (0..8) of a cell from the bottom: ' ', ▁ ... █. */
export function lowerBlock(eighths: number): number {
  return eighths <= 0 ? 0x20 : 0x2580 + Math.min(8, eighths)
}

/** Pixels this close (squared RGB distance) to a group's seed blend into it. */
export const NEAR = 1200

/**
 * One color for a quadrant group (the pixels whose mask bit is `want`): the
 * seed blended only with the pixels within `near` of it, so a cell holding
 * three colors never invents a fourth (red jacket + navy pants averaging to
 * maroon, skin + teal to grey-green). An infinite `near` averages the group.
 */
function groupColor(q: ArrayLike<number>, mask: number, want: number, seed: number, near = NEAR): number {
  let r = 0, gg = 0, b = 0, n = 0
  for (let p = 0; p < 4; p++) {
    if (((mask >> p) & 1) !== want) continue
    const v = q[p]!
    if (dist(v, seed) > near) continue
    r += (v >> 16) & 255
    gg += (v >> 8) & 255
    b += v & 255
    n++
  }
  if (n === 0) return seed
  return (((r / n + 0.5) | 0) << 16) | (((gg / n + 0.5) | 0) << 8) | ((b / n + 0.5) | 0)
}

/** Braille dot bits by (column 0..1, row 0..3) within a cell: `0x2800 | bits` is the glyph. */
export const BRAILLE = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const

/** A cell's four pixels fitted to one quadrant glyph: see fitQuad. */
export type QuadFit = { mask: number; fg: number; bg: number; spread: number }

/**
 * Fold a cell's four pixels (top-left, top-right, bottom-left, bottom-right)
 * into the two colors that best fit them: the two most different pixels seed
 * the colors, every pixel joins the nearer seed (`mask` holds the
 * foreground's), and each color is its group blended by groupColor. `spread`
 * is the seeds' squared distance; 0 means the cell is one flat color (q[0]).
 *
 * `keep` (a pixel index 0-3, or -1) names a pixel whose color must survive:
 * it seeds one color itself, against the pixel most unlike it. Without it, a
 * cell holding three colors keeps the two most different, so a small sprite
 * in front of a busy background (a skier's hat between a snowy peak and a
 * dark pine) can drop out of its own cell.
 */
export function fitQuad(q: ArrayLike<number>, fit: QuadFit, near = NEAR, keep = -1): void {
  let bi = 0
  let bj = 0
  let best = 0
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 4; j++) {
      const d = dist(q[i]!, q[j]!)
      if (d > best) {
        best = d
        bi = i
        bj = j
      }
    }
  fit.spread = best
  if (keep >= 0 && best > 0) {
    // The kept pixel seeds one color; the pixel most unlike it seeds the other.
    let far = 0
    let farD = -1
    for (let p = 0; p < 4; p++) {
      const d = dist(q[p]!, q[keep]!)
      if (d > farD) {
        farD = d
        far = p
      }
    }
    if (farD > 0) {
      bi = keep
      bj = far
    }
  }
  if (best === 0) {
    fit.mask = 0
    fit.fg = fit.bg = q[0]!
    return
  }
  const si = q[bi]!
  const sj = q[bj]!
  let mask = 0
  for (let p = 0; p < 4; p++) {
    const v = q[p]!
    if (dist(v, sj) < dist(v, si)) mask |= 1 << p
  }
  fit.mask = mask
  fit.fg = groupColor(q, mask, 1, sj, near)
  fit.bg = groupColor(q, mask, 0, si, near)
}
