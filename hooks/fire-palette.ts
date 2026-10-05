// REVISION: flow-v61-names
//
// Truecolor heat palettes for ember: a black-body ramp (deep red
// → orange → yellow → white-hot), a blue gas pilot for strength 1, a gray
// smoke ramp, and a blue-white core for a nearly-full context. Quantized to
// 48 steps per palette so a frame stays well inside the Raster's 1024
// distinct color pairs.

import { SMOKE_TIPS } from './fire'
import type { Tint } from './styles'

type Stop = [t: number, rgb: [number, number, number]]

const BLACKBODY: Stop[] = [
  [0, [48, 6, 3]],
  [0.18, [118, 16, 5]],
  [0.38, [204, 48, 8]],
  [0.58, [246, 124, 20]],
  [0.78, [255, 204, 72]],
  [1, [255, 249, 218]],
]
const PILOT: Stop[] = [
  [0, [10, 18, 74]],
  [0.5, [34, 88, 226]],
  [1, [172, 216, 255]],
]
const BLUE_CORE: Stop[] = [
  [0, [48, 6, 3]],
  [0.3, [150, 26, 8]],
  [0.55, [238, 112, 22]],
  [0.75, [124, 172, 255]],
  [1, [228, 242, 255]],
]
const SMOKE: Stop[] = [
  [0, [44, 44, 46]],
  [1, [196, 196, 200]],
]

const STEPS = 48

function ramp(stops: Stop[], t: number): number {
  const x = Math.min(1, Math.max(0, t))
  let i = 1
  while (i < stops.length - 1 && stops[i]![0] < x) i++
  const [t0, a] = stops[i - 1]!
  const [t1, b] = stops[i]!
  const k = t1 === t0 ? 0 : (x - t0) / (t1 - t0)
  const ch = (j: 0 | 1 | 2) => Math.round(a[j] + (b[j] - a[j]) * k)
  return (ch(0) << 16) | (ch(1) << 8) | ch(2)
}

const luts = new Map<Stop[], Uint32Array>()

function lut(stops: Stop[]): Uint32Array {
  let l = luts.get(stops)
  if (!l) {
    l = new Uint32Array(STEPS + 1)
    for (let i = 0; i <= STEPS; i++) l[i] = ramp(stops, i / STEPS)
    luts.set(stops, l)
  }
  return l
}

const WISP_SMOKE: Stop[] = [
  [0, [46, 44, 46]],
  [1, [128, 122, 120]],
]

/** Drifting smoke, `t` 0 (nearly gone) .. 1 (just turned from a spark). */
export function smokeColor(t: number): number {
  return lut(WISP_SMOKE)[Math.round(Math.min(1, Math.max(0, t)) * STEPS)]!
}

/**
 * Color for heat `t` (0..1) at `strength`: low strengths never reach the
 * white-hot end (a 4 tops out orange), strength 1 burns as a blue pilot.
 */
export function heatColor(strength: number, t: number, tint: Tint = 'normal'): number {
  if (tint === 'smoke' && t < SMOKE_TIPS) return lut(SMOKE)[Math.round((t / SMOKE_TIPS) * STEPS)]!
  const stops = tint === 'blue' ? BLUE_CORE : strength === 1 ? PILOT : BLACKBODY
  const reach = strength === 1 ? 1 : 0.52 + 0.048 * Math.min(10, strength)
  return lut(stops)[Math.round(Math.min(1, Math.max(0, t)) * reach * STEPS)]!
}
