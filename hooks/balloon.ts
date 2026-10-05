// REVISION: flow-v81-scene-defs
//
// A hot-air balloon in the sky world (sky.ts): the level is its target
// altitude. At 1 it sits on the grass among trees and houses; it climbs past
// birds and the layered clouds into a thinning sky; at 10 it floats in space
// among stars, Earth's blue rim below. It drifts side to side in the wind,
// its burner flickers while it climbs, subagents fly as small companion
// balloons, a failed command grays the burner's flame and leaves a trail of
// sooty smoke drifting off behind it, and a nearly-full context turns the
// stripes blue.

import type { Cells } from './cells'
import { g, hash, mix } from './pixels'
import { skyColor, SkyWorld } from './sky'
import { defineScene } from './scene-def'

export { skyColor }

const C = {
  stripeA: 0xe04a3a,
  stripeB: 0xf2c14e,
  blueA: 0x3a7be0,
  blueB: 0xe8eef8,
  rope: 0x9a9a9a,
  basket: 0x8b5a2b,
  flame: [0xffd166, 0xff9f1c, 0xff6b1a] as const,
  smoke: 0x9a9a9a,
  soot: 0x38383c,
  companion: [0xe06a3a, 0x3ab0e0, 0x9a6ae0, 0x5ac46a] as const,
}

/** The balloon, 7 wide × 4 tall; ' ' cells let the sky through. */
const SPRITE = [' ▄▆█▆▄ ', '███████', ' ▀█▀█▀ ', '  ╲█╱  '] as const

export class Balloon extends SkyWorld {
  protected vehicleHeight(): number {
    return SPRITE.length
  }

  /** The balloon's left column: it wanders the middle of the band in the wind. */
  private balloonX(): number {
    const w = this.columns
    const wander = Math.sin(this.t * 0.0045) * 0.28 + Math.sin(this.t * 0.0017) * 0.12
    const x = Math.round(w / 2 - 3 + wander * w)
    return Math.max(0, Math.min(Math.max(0, w - 7), x))
  }

  protected drawVehicle(out: Cells, top: number): void {
    this.drawCompanions(out)
    if (this.tint === 'smoke') this.drawSmoke(out, top)
    this.drawBalloon(out, top)
  }

  /** A failed command: sooty smoke off the burner, drifting back and up on the wind, thinning out. */
  private drawSmoke(out: Cells, top: number): void {
    const w = this.columns
    const h = this.rows
    const bx = this.balloonX() + 3
    const puff = this.t >> 2
    for (let k = 1; k <= 9; k++) {
      const x = bx - k - 1
      const r = top + 2 - Math.floor(k / 3)
      if (x < 0 || x >= w || r < 0 || r >= h) continue
      // Puffs come and go along the trail as it drifts.
      const n = hash(k - puff, 0, 91)
      if (n < 0.2) continue
      const i = r * w + x
      const behind = out.behind(i)
      const thin = k / 10
      out.set(i, g(k < 5 && n > 0.45 ? '▓' : '▒'), mix(C.soot, behind, thin * 0.5), behind)
    }
  }

  /** Subagents fly as small companion balloons around the main one. */
  private drawCompanions(out: Cells): void {
    const n = Math.min(4, Math.round(this.coverageBoost / 15))
    const w = this.columns
    const h = this.rows
    for (let k = 0; k < n; k++) {
      const x = Math.round(((k + 1) / (n + 1)) * w + Math.sin(this.t * 0.01 + k * 2) * 4)
      const r = Math.max(0, Math.min(h - 2, 1 + ((k + (this.t >> 6)) % 2)))
      if (x < 0 || x >= w) continue
      out.set(r * w + x, g('●'), C.companion[k % C.companion.length]!, out.behind(r * w + x))
      out.set((r + 1) * w + x, g('╵'), C.rope, out.behind((r + 1) * w + x))
    }
  }

  private drawBalloon(out: Cells, top: number): void {
    const w = this.columns
    const bx = this.balloonX()
    const blue = this.tint === 'blue'
    const burning = this.target > this.alt + 0.3 || this.strength >= 6
    for (let sr = 0; sr < SPRITE.length; sr++) {
      const row = SPRITE[sr]!
      const r = top + sr
      if (r < 0) continue
      for (let sc = 0; sc < row.length; sc++) {
        const ch = row[sc]!
        const x = bx + sc
        if (ch === ' ' || x < 0 || x >= w) continue
        let color: number
        if (sr === 3) color = ch === '█' ? C.basket : C.rope
        else if (sr === 2 && sc === 3) {
          // The burner's mouth: a flicker of flame while it climbs.
          color = this.tint === 'smoke'
            ? C.smoke
            : burning
              ? C.flame[(this.t >> 1) % C.flame.length]!
              : blue ? C.blueA : C.stripeA
        } else {
          const even = sc % 2 === 0
          color = blue ? (even ? C.blueA : C.blueB) : even ? C.stripeA : C.stripeB
        }
        // Its half-blocks show whatever is behind them: sky, or a cloud it's flying through.
        out.set(r * w + x, g(ch), color, out.behind(r * w + x))
      }
    }
  }
}

export const balloonScene = defineScene({
  name: 'balloon',
  blurb: 'a hot-air balloon that climbs from the grass to space',
  night: true,
  make: seed => new Balloon(seed),
})
