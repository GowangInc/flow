// REVISION: flow-v61-names
//
// What every harness adapter (Claude Code's register.tsx, pi's pi/index.ts)
// does the same way: one scene instance per style (so a switch resumes where
// that scene left off), the level the settings and the activity call for, whether
// anything shows at all, and pointing the current scene at those dials and
// the time of day. Pure: no engine imports.

import { type Activity } from './activity'
import { isNightAt, type Clock, type FlowConfig } from './settings'
import { makeScene, type SceneName, type Scene } from './styles'

/** Frame pace while busy (~14 fps), and when calm: a low glow or off (8 fps). */
export const FRAME_MS = 70
const CALM_MS = 125

export class SceneDriver {
  private readonly scenes = new Map<SceneName, Scene>()
  /** The scene for the configured style. */
  scene: Scene
  /** The local time, which the adapter keeps current (noon until it first reads the clock). */
  clock: Clock = { hour: 12, minute: 0 }

  constructor(
    readonly cfg: FlowConfig,
    readonly activity: Activity,
  ) {
    this.scene = this.sceneFor(cfg.style)
  }

  /** The one instance of a style, built on first use. */
  sceneFor(style: SceneName): Scene {
    let f = this.scenes.get(style)
    if (!f) this.scenes.set(style, (f = makeScene(style)))
    return f
  }

  /** Apply settings changes here at once (the caller saves and redraws). */
  apply(changes: Partial<FlowConfig>): void {
    Object.assign(this.cfg, changes)
    if (changes.style) this.scene = this.sceneFor(changes.style)
  }

  /** The level now: the manual setting, or what the work's activity calls for. */
  level(): number {
    return this.cfg.mode === 'manual' ? this.cfg.level : this.activity.strength(this.cfg.idle)
  }

  /** Whether the scene should show at all right now (dark idle gives the rows back). */
  isShown(): boolean {
    const { cfg, activity } = this
    return cfg.mode === 'manual' ? cfg.level > 0 : cfg.idle > 0 || activity.isWorking || activity.isGlowing
  }

  isNight(): boolean {
    return isNightAt(this.cfg.time, this.clock.hour)
  }

  /** The tint auto mode shows (a failure, a nearly-full context), or none in manual. */
  tint(): Scene['tint'] {
    return this.cfg.mode === 'auto' ? this.activity.tint : 'normal'
  }

  /** How long until the next frame: calm scenes (low, untinted) step slower. */
  pace(): number {
    const f = this.scene
    return f.strength <= 1 && f.tint === 'normal' ? CALM_MS : FRAME_MS
  }

  /** Point the current scene at this frame's dials, returning it. */
  dial(): Scene {
    const f = this.scene
    f.strength = this.level()
    f.coverageBoost = this.cfg.mode === 'auto' ? this.activity.coverageBoost : 0
    f.tint = this.tint()
    f.night = this.isNight()
    return f
  }
}
