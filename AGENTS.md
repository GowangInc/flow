# AGENTS.md

Flow: ambient terminal scenes that move with a coding agent's work. One codebase runs as a Claude Code mod (a plugin of function hooks, early access) and as a [pi](https://github.com/badlogic/pi-mono) extension. This repo is both the plugin and its own marketplace. User-facing docs are in `README.md`; this file is for working on the code.

## Layout

```
.claude-plugin/
  plugin.json        the plugin: name, version, userConfig rows (/config)
  marketplace.json   the marketplace (robdmac); its one plugin is this repo ("./")
  types/             written by Claude Code on each load (gitignored): the mod API's types
hooks/
  hooks.json         { "modules": ["./register.tsx"] }
  register.tsx       Claude Code adapter: hooks, frame loop, /flow, settings write-through
  scene.ts           SceneDriver: shared by both adapters (scene per style, level, dials, pace)
  settings.ts        FlowConfig, the /flow grammar, every reply's wording (pure)
  activity.ts        how busy the agent is: work → level and tint (pure, unit-tested)
  styles.ts          STYLES, the Scene interface and Tint, makeScene, night scenes; the fire (Ember)
  cells.ts           Cells (the grid every scene returns), Rng, Raster encoding
  pixels.ts          shared helpers: mix, dist, clamp, hash*, QUAD, BRAILLE, fitQuad, groupColor
  night.ts           the shared night: sky colors, STAR, MOON, moon placement
  fire.ts            the fire scene's automaton (its heat grid), glyphs and 256-color ramps
  fire-palette.ts    the fire scene's truecolor ramps
  <scene>.ts         one file per scene: starfield (warp), colony, balloon + sky + clouds/,
                     engine, rocket (falcon, starship), surf, ski, river, bubbles, lava
pi/
  index.ts           pi adapter (widget above the editor, /flow, ~/.pi/agent/flow.json)
  ansi.ts mapping.ts types.ts
tests/flow.test.ts   unit tests, plus some that need the mod engine
package.json         the pi package ("pi": { "extensions": ["./pi/index.ts"] })
```

## Scenes

A scene implements `Scene` (`hooks/styles.ts`) and is registered in `STYLES` and `makeScene`, in `plugin.json`'s `style` options, and (if it has one) in `NIGHT_STYLES`.

- **Dials**, set every frame by `SceneDriver.dial()`:
  - `strength` 0–10: 0 draws nothing, every cell blank; 1 is calm idle; 10 is the busiest. Ease changes; never jump.
  - `coverageBoost`: above 0 while subagents run. Add company (more boats, wingmen, a wider fire).
  - `tint`: `'smoke'` (a failed command or compaction) or `'blue'` (context nearly full). Must be clearly visible in every scene, at every level, in both layouts.
  - `night`: for scenes with a night version. Ease a `kNight` toward it rather than switching in one frame. Use `night.ts` so every night matches.
- **Sizes**: the band is 5 rows × 80–250 columns, above the prompt. The spine is a pane about 13–22 columns × 30–60 rows. Every scene must look right in both.
- **Drawing**:
  - Most scenes paint a pixel layer at 2 × 2 pixels per cell, then fold it into quadrant glyphs with `fitQuad`. A cell holds only two colors; pass `fitQuad`'s `keep` for a sprite's pixels so a small figure never drops out of its own cell.
  - Braille (`BRAILLE`, 2 × 4 dots a cell) is for fine specks: spray, stars, bubbles.
  - `DEFAULT_COLOR` (0x01000000) is the terminal's own color, i.e. transparent.
- **Limits**:
  - Claude Code's `Raster` paints at most 1024 distinct (fg, bg) pairs a frame and nearest-maps the rest, so quantize gradients.
  - Keep `step()` + `grid()` under ~2 ms at 250 × 5 and 22 × 60; frames run at ~14 fps (8 when calm).
  - Shared helpers live in `pixels.ts`; don't copy them into a scene.

## Mod API rules

The engine validates the module before it runs (`claude plugin validate .`):

- `$` may only be passed to top-level functions. A hook handler must be a top-level function or written inline in its `on(...)` call. Closures inside `register` that need `$` take what they need as data instead.
- Names are literal strings: `$.env.get('NAME')`, atom refs, command filters.
- No binding may shadow `next`.
- No `console`, `process` or `Date.now()` in `hooks/`: they don't exist in the mod sandbox. Read time with `$.clock.now()`. A scene's `Rng` takes a seed.
- Raster is terminal-only: a render on another surface returns text or `next(e)`.

## Settings

- The settings are `userConfig` rows in `/config`. Claude Code reloads the module when one changes, which would restart the scene.
- So `/flow` applies its change at once and keeps it in `$.store` (`overrides`), not `/config`. The store is shared by every session: writes merge into it, and only fields still holding the value written are cleared.
- The overrides are written through to `/config` at `session.end`. A change made in `/config` itself wins over a pending one.
- pi keeps its settings in `~/.pi/agent/flow.json`.
- `/flow` is the only command. Don't add aliases.

## Development

```sh
claude --plugin-dir .        # load it, with hot reload of the source
claude plugin validate .     # the module's rules, the manifests, the hooks
claude plugin test .         # the tests, including those that need the engine
```

- Hot reload doesn't follow symlinks. To use a dev-mods folder, copy the plugin in (rsync) rather than linking it.
- Every file starts with a `// REVISION: flow-vNN-<what>` line; bump it when you change the file. On load the mod logs `[flow] REVISION: …`, the local time and the UTC offset to the debug log (`claude --debug`), so you can tell which version is running.
- After visual changes, render the scene at levels 1, 5 and 10 in both layouts, by day and night and with each tint, and look at it.
- Check the color-pair count for each scene.
- Check the timing.
