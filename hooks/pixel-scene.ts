// REVISION: flow-v81-pixel-scene
//
// The quick way to write a scene: extend PixelScene and paint pixels. It
// does what every scene otherwise does by hand: eases the level and the
// night, sizes a pixel layer to the grid (2 × 2 pixels a cell), folds it
// into quadrant glyphs (fitQuad), lays braille specks over it, blanks
// everything at level 0, and encodes the frame.
//
//   class Aurora extends PixelScene {
//     paint(px: Painter, d: Dials) {
//       for (let y = 0; y < px.h; y++)
//         for (let x = 0; x < px.w; x++) px.set(x, y, mix(0x001020, 0x40ffa0, d.level / 10))
//     }
//   }
//
// Override `update(d)` to move things once a frame (paint may run more often,
// or less), and `resize(d)` to set up per-size state.

import { Cells, DEFAULT_COLOR, isTall } from './cells'
import { BRAILLE, clamp, fitQuad, QUAD, type QuadFit } from './pixels'
import type { Scene, Tint } from './styles'

/** How many of a quadrant mask's four pixels are set. */
const BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4] as const

/** The terminal's own color: a pixel left this shows whatever is behind the scene. */
export const CLEAR = DEFAULT_COLOR

/** What a scene paints from, each frame. */
export type Dials = {
  /** The level, eased: 0 off, 1 calm idle, 10 the busiest. Fractional while it glides. */
  level: number
  /** Frames since the scene started. */
  t: number
  /** Night, eased: 0 day, 1 night (only for a scene whose def says `night: true`). */
  night: number
  /** 'smoke' (a failure, a compaction) or 'blue' (context nearly full): it must show clearly. */
  tint: Tint
  /** Above 0 while subagents run: add company. */
  boost: number
  /** The grid, in cells. */
  columns: number
  rows: number
  /** A tall pane (the spine) rather than the band. */
  tall: boolean
}

/**
 * The pixel layer: `w` × `h` pixels (2 × 2 a cell), cleared to CLEAR before
 * every paint, and a braille layer of `dw` × `dh` dots (2 × 4 a cell) for fine
 * specks drawn over it.
 */
export class Painter {
  w = 0
  h = 0
  dw = 0
  dh = 0
  /** Pixel colors, row-major. */
  readonly px: Int32Array
  /** Pixels that must keep their own color when a cell is folded (a small sprite's). */
  readonly keep: Uint8Array
  /** Per cell: braille dot bits and their color. */
  readonly dots: Uint8Array
  readonly dotColor: Int32Array

  constructor(columns: number, rows: number) {
    this.w = columns * 2
    this.h = rows * 2
    this.dw = columns * 2
    this.dh = rows * 4
    this.px = new Int32Array(this.w * this.h)
    this.keep = new Uint8Array(this.w * this.h)
    this.dots = new Uint8Array(columns * rows)
    this.dotColor = new Int32Array(columns * rows)
  }

  clear(color = CLEAR): void {
    this.px.fill(color)
    this.keep.fill(0)
    this.dots.fill(0)
  }

  /** One pixel (rounded down; off the layer is ignored). `keep` for a sprite's pixels. */
  set(x: number, y: number, color: number, keep = false): void {
    x |= 0
    y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = y * this.w + x
    this.px[i] = color
    if (keep) this.keep[i] = 1
  }

  get(x: number, y: number): number {
    x |= 0
    y |= 0
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? CLEAR : this.px[y * this.w + x]!
  }

  /** A filled rectangle of pixels. */
  rect(x: number, y: number, w: number, h: number, color: number, keep = false): void {
    for (let yy = Math.max(0, y | 0); yy < Math.min(this.h, (y + h) | 0); yy++)
      for (let xx = Math.max(0, x | 0); xx < Math.min(this.w, (x + w) | 0); xx++) this.set(xx, yy, color, keep)
  }

  /** A braille dot at (x, y) in dots (`dw` × `dh`): a star, a speck of spray. A cell's dots share one color, the last set. */
  dot(x: number, y: number, color: number): void {
    x |= 0
    y |= 0
    if (x < 0 || y < 0 || x >= this.dw || y >= this.dh) return
    const c = (y >> 2) * (this.dw >> 1) + (x >> 1)
    this.dots[c]! |= BRAILLE[x & 1]![y & 3]!
    this.dotColor[c] = color
  }
}

export abstract class PixelScene implements Scene {
  strength = 8
  coverageBoost = 0
  tint: Tint = 'normal'
  night = false
  /** How far the level moves toward the dial each frame (0..1): lower glides slower. */
  protected levelEase = 0.05
  /** How far night moves each frame (0..1). */
  protected nightEase = 0.04

  private level = Number.NaN
  private kNight = -1
  private t = 0
  private columns = 0
  private rows = 0
  private out = new Cells(0, 0)
  private painter = new Painter(0, 0)
  private readonly q = new Int32Array(4)
  private readonly ks = new Int32Array(4)
  private readonly fit: QuadFit = { mask: 0, fg: 0, bg: 0, spread: 0 }

  constructor(readonly seed = 1) {}

  /** Paint this frame's pixels (the layer starts CLEAR). */
  abstract paint(px: Painter, d: Dials): void

  /** Move things on by one frame (called once per step, before any paint). */
  protected update(_d: Dials): void {}

  /** The grid changed size (and on the first frame): set up per-size state. */
  protected resize(_d: Dials): void {}

  protected dials(): Dials {
    return {
      level: Number.isNaN(this.level) ? clamp(this.strength, 0, 10) : this.level,
      t: this.t,
      night: Math.max(0, this.kNight),
      tint: this.tint,
      boost: this.coverageBoost,
      columns: this.columns,
      rows: this.rows,
      tall: isTall(this.columns, this.rows),
    }
  }

  ensure(columns: number, rows: number): void {
    if (columns === this.columns && rows === this.rows) return
    this.columns = columns
    this.rows = rows
    this.out = new Cells(columns, rows)
    this.painter = new Painter(columns, rows)
    this.resize(this.dials())
  }

  step(): void {
    this.t++
    const want = clamp(this.strength, 0, 10)
    if (Number.isNaN(this.level)) this.level = want
    const dl = want - this.level
    this.level += Math.abs(dl) < 0.01 ? dl : dl * this.levelEase
    const n = this.night ? 1 : 0
    if (this.kNight < 0) this.kNight = n
    this.kNight += clamp(n - this.kNight, -this.nightEase, this.nightEase)
    this.update(this.dials())
  }

  grid(): Cells {
    const out = this.out
    const n = this.columns * this.rows
    // 0 is off: nothing at all, at once.
    if (this.strength <= 0) {
      for (let i = 0; i < n; i++) out.blank(i)
      return out
    }
    const p = this.painter
    p.clear()
    this.paint(p, this.dials())
    const { q, fit } = this
    const w = p.w
    for (let cell = 0; cell < n; cell++) {
      const r = (cell / this.columns) | 0
      const c = cell - r * this.columns
      const k0 = 2 * r * w + 2 * c
      const ks = this.ks
      ks[0] = k0
      ks[1] = k0 + 1
      ks[2] = k0 + w
      ks[3] = k0 + w + 1
      let clear = 0
      let keep = -1
      for (let j = 0; j < 4; j++) {
        q[j] = p.px[ks[j]!]!
        if (q[j] === CLEAR) clear |= 1 << j
        else if (keep < 0 && p.keep[ks[j]!]) keep = j
      }
      let mask = 0
      let fg: number
      let bg: number
      if (clear === 15) {
        fg = bg = CLEAR
      } else if (clear) {
        // Some pixels show the terminal: they're the background, the rest one color.
        let sr = 0, sg = 0, sb = 0, m = 0
        for (let j = 0; j < 4; j++) {
          if (clear & (1 << j)) continue
          sr += (q[j]! >> 16) & 255
          sg += (q[j]! >> 8) & 255
          sb += q[j]! & 255
          m++
        }
        mask = 15 ^ clear
        fg = keep >= 0 ? q[keep]! : (((sr / m + 0.5) | 0) << 16) | (((sg / m + 0.5) | 0) << 8) | ((sb / m + 0.5) | 0)
        bg = CLEAR
      } else {
        fitQuad(q, fit, undefined, keep)
        if (fit.spread === 0) {
          fg = bg = q[0]!
        } else {
          mask = fit.mask
          fg = fit.fg
          bg = fit.bg
        }
      }
      if (p.dots[cell]) {
        // Specks over the cell, against the color that covers most of it.
        out.set(cell, 0x2800 | p.dots[cell]!, p.dotColor[cell]!, BITS[mask]! > 2 ? fg : bg)
      } else if (mask === 0 && bg === CLEAR) out.blank(cell)
      else out.set(cell, QUAD[mask]!, fg, bg)
    }
    return out
  }

  frame(): string {
    return this.grid().encode()
  }
}
