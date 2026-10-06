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
  svg.ts             Claude desktop: a frame's cells as a PNG inside one Svg (pure, unit-tested)
  sound.ts           soundscapes: each scene's layers of clips and its events' clips, levels, small events synthesized (pure)
  sound-files.ts     every clip in sounds/ and each mood's bed gain (written by scripts/make-sounds.ts)
  scene.ts           SceneDriver: shared by both adapters (scene per style, level, dials, pace)
  settings.ts        FlowConfig, the /flow grammar, every reply's wording (pure)
  activity.ts        how busy the agent is: work → level and tint (pure, unit-tested)
  styles.ts          SCENES (the one list of scenes), the Scene interface and Tint, makeScene; the fire (Ember)
  scene-def.ts       SceneDef / defineScene: what a scene file exports so it can be listed
  pixel-scene.ts     PixelScene: the quick base for a scene that paints pixels (easing, fold, specks, level 0)
  cells.ts           Cells (the grid every scene returns), Rng, Raster encoding
  pixels.ts          shared helpers: mix, dist, clamp, hash*, QUAD, BRAILLE, fitQuad, groupColor
  night.ts           the shared night: sky colors, STAR, MOON, moon placement
  fire.ts            the fire scene's automaton (its heat grid), glyphs and 256-color ramps
  fire-palette.ts    the fire scene's truecolor ramps
  <scene>.ts         one file per scene: starfield (warp), colony, balloon + sky + clouds/,
                     engine, rocket (falcon, starship), surf, ski, bubbles
pi/
  index.ts           pi adapter (widget above the editor, /flow, ~/.pi/agent/flow.json)
  ansi.ts mapping.ts types.ts
sounds/              the soundscapes' clips (AAC), built by scripts/make-sounds.ts
scripts/             Node tools, not part of the mod: new-scene, preview, check, sync-manifest, make-sounds
tests/flow.test.ts   unit tests, plus some that need the mod engine
package.json         the pi package ("pi": { "extensions": ["./pi/index.ts"] }) and the scripts
```

## Scenes

A scene implements `Scene` (`hooks/styles.ts`). Its file exports a `SceneDef` (`defineScene({ name, blurb, night?, aliases?, make })`), listed once in `SCENES` in `styles.ts`; the `/flow` names, `/flow next`'s order and which scenes have a night all come from there. `plugin.json` must be literal JSON, so `npm run sync` copies the list into it and `npm run check` fails when they differ.

- **Start one** with `npm run new-scene -- <name> --blurb "…" [--night]`: it writes `hooks/<name>.ts` on `PixelScene` (`hooks/pixel-scene.ts`), lists it and syncs `plugin.json`. `PixelScene` eases the level and the night, sizes a 2 × 2-a-cell pixel layer, folds it with `fitQuad`, lays braille specks over it and blanks level 0; a scene paints with `paint(px, dials)` and moves things in `update(dials)`. The bigger scenes predate it and do all of that themselves.

- **Dials**, set every frame by `SceneDriver.dial()`:
  - `strength` 0–10: 0 draws nothing, every cell blank; 1 is calm idle; 10 is the busiest. Ease changes; never jump.
  - `coverageBoost`: above 0 while subagents run. Add company (more boats, wingmen, a wider fire).
  - `tint`: `'smoke'` (a failed command or compaction) or `'blue'` (context nearly full). Must be clearly visible in every scene, at every level, in both layouts.
  - `night`: for scenes with a night version. Ease a `kNight` toward it rather than switching in one frame. Use `night.ts` so every night matches.
- **Sound** (`hooks/sound.ts`, see *Soundscapes* below): a scene's bed is layers of clips (`LAYERS`) at gains from the level and its `ambience()`, mixed ahead for each of its moods (`MOODS`); its events (`sounds`, an array the scene pushes `{ kind, v }` onto as things happen on screen, capped) play a clip (`EVENTS`) or, small and dense ones, a synthesized burst (`VOICES`). A scene without layers is silent.
- **Sizes**: the band is 5 rows × 80–250 columns, above the prompt. The spine is a pane about 13–22 columns × 30–60 rows. Every scene must look right in both.
- **Drawing**:
  - Most scenes paint a pixel layer at 2 × 2 pixels per cell, then fold it into quadrant glyphs with `fitQuad`. A cell holds only two colors; pass `fitQuad`'s `keep` for a sprite's pixels so a small figure never drops out of its own cell.
  - Braille (`BRAILLE`, 2 × 4 dots a cell) is for fine specks: spray, stars, bubbles.
  - `DEFAULT_COLOR` (0x01000000) is the terminal's own color, i.e. transparent.
- **Limits**:
  - Claude Code's `Raster` paints at most 1024 distinct (fg, bg) pairs a frame and nearest-maps the rest, so quantize gradients.
  - Keep `step()` + `grid()` under ~2 ms at 250 × 5 and 22 × 60; frames run at ~14 fps (8 when calm).
  - Shared helpers live in `pixels.ts`; don't copy them into a scene.

## Soundscapes

`$.audio.play` is macOS `afplay`: a clip at a gain fixed when it starts. Nothing loops or changes volume while it plays, and Claude Code plays at most four at once for a plugin (`MAX_PLAYS`): it refuses a fifth ("4 plays are going at once"), and each holds its place for its length plus almost a second (afplay starting and draining). So:

- **Beds**: one stream a scene. Its layers (`LAYERS`) are mixed ahead by the build into one bed for each mood the scene reaches (`MOODS`: a band of the level, the balloon's burner, a rocket's phase; the build runs each scene to find them), each at its layers' gains, limited when it would need more than 1.3 to play as loud, and its gain back to the layers' level kept in the manifest (`BED_GAINS`). Takes are 14 s (`BED_MS`) faded at both ends (3 s, `BED_FADE_MS`), the next starting as the last begins to fade, up to half a second sooner at random (`bedGap`). `bedStep` plans it a frame at a time: when the mood changes or the gain moves by more than 3 dB, a fresh take crossfades in and the old one stops once it's in (sooner when the level fell), but only once the take before has gone, so a bed never holds more than two plays (a test checks); silent, it stops at once. A mood has three takes (`BED_TAKES`, each a different rotation of its layers' takes, the layers' takes at one loudness), never the one before again. Nothing in a bed may repeat in a rhythm: no tremolo, flanger or phaser. Use `turbulence` (a random smooth swell), `wander` (a resonance drifting at random) and `hum` (narrow resonators on noise, in place of pure tones, which cancel and beat when two takes crossfade). Rhythm comes only from the picture: the engine's chuffs follow its crank, a wave breaks when the scene throws one (at random), a ski swishes on each turn (each turn's pace drawn at random). To check, simulate a scene's mix and look for peaks in the autocorrelation of its loudness, at lags up to half a minute.
- **Events**: big ones play a clip at once, every one, but no nearer than 120 ms to the last of their kind (a closer one waits that long: any nearer, two booms fuse into one), and short enough at the front that a second right behind is heard; a clip finding the player full stops the oldest event clip first (its tail, or afplay's silent drain), and a refused one tries again 50 ms on; small dense ones (pops, cracks) are drawn in `VOICES` and gathered a second at a time into one clip (shorter, they'd fill the player), each placed at random within its frame (a frame's all at once would buzz at the frame rate) and, past `BURST_MAX`, sampled from across the window (`gather`). afplay takes about a third of a second to start (`PLAYER_LEAD_MS`): a scene that can see a moment coming sends its sound that far ahead (`leadFrames`), as the colony's rocks do, or it lands late on its picture. Seeds come from a counter: scatter them (`unit`) before they pick or seed anything, or neighbouring seeds pick in step.
- **Levels**: every scene sits on one loudness curve, measured A-weighted with a laptop speaker's bass roll-off counted: about -36 dB at level 1, -28 at 5, -22 at 10 (`MASTER`). Clips peak at -2 to -3 dBFS and the gain multiplies, so no play may exceed 1.4 (a test checks). Steady noise beds are compressed (`SQUASH`) to be loud without clipping; crackle and bubbles aren't, their peaks are the point. A small speaker can't play below ~100 Hz: give low hums harmonics.
- **Building**: `npm run sounds [folders]` (needs `sox` and `ffmpeg`) runs every recipe in `scripts/make-sounds.ts` into `.sound-cache/` (WAV), mixes and encodes `sounds/` (AAC: beds 32 kbps, events 64) and writes `hooks/sound-files.ts` (the clips and `BED_GAINS`); `npm run sounds fire` rebuilds one folder or scene. Commit `sounds/` and the manifest.
- **Tuning** a scene (how these were made): get a real recording of the thing (public-domain or CC0 is easiest; it's only measured, never shipped), measure it and the scene's mix the same way (octave bands, spectral centre, crackle kurtosis and bursts a second, onsets, flutter depth and rate, rhythm), and adjust the recipe until they match within a few dB. The references: rockets, NASA's STS-131 and SDO/Atlas V launch recordings; fire, a campfire; surf, a calm tropical beach and rough sea waves; engine, two steam engines; bubbles, water bubbling, boiling and big bubbles; balloon, strong wind and a pressurized gas flame; ski, crunchy snow; booms, a sonic boom (all on Wikimedia Commons). The colony ship and the warp drive have no real counterpart: theirs are designed, after spacecraft cabin noise.

## Mod API rules

The engine validates the module before it runs (`claude plugin validate .`):

- `$` may only be passed to top-level functions. A hook handler must be a top-level function or written inline in its `on(...)` call. Closures inside `register` that need `$` take what they need as data instead.
- Names are literal strings: `$.env.get('NAME')`, atom refs, command filters.
- No binding may shadow `next`.
- No `console`, `process` or `Date.now()` in `hooks/`: they don't exist in the mod sandbox. Read time with `$.clock.now()`. A scene's `Rng` takes a seed.
- Raster is terminal-only. On Claude desktop the band and spine draw one `Svg` a frame instead (`hooks/svg.ts`): the cells become pixels, 2 × 4 a cell (every quadrant, braille dot and eighth block on its own pixels), stored as a PNG in an `<image>` that desktop scales up with square pixels. An Svg's markup is at most 131,072 characters, so a bigger frame drops to 2 × 2 a cell, then 1 × 2, then 1 × 1, then one pixel for every few cells; the smaller sizes blend the pixels they cover so sparse glyphs dim rather than vanish.
- Desktop has its own `SceneDriver` (`desktopDriver` in `register.tsx`) on the same settings, so a session drawn in the terminal and on desktop at once steps two scenes, each at its own size. The frame loop steps desktop's scene and invalidates its site (desktop redraws at most 10 times a second); the render only draws it. VS Code and mobile get nothing.

## Settings

- The settings are `userConfig` rows in `/config`. Claude Code reloads the module when one changes, which would restart the scene.
- So `/flow` applies its change at once and keeps it in `$.store` (`overrides`), not `/config`. The store is shared by every session: writes merge into it, and only fields still holding the value written are cleared.
- The overrides are written through to `/config` at `session.end`. A change made in `/config` itself wins over a pending one.
- pi keeps its settings in `~/.pi/agent/flow.json`.
- `/flow` is the only command. Don't add aliases.
- One-time tips (`nextTip` in `settings.ts`, kept in `$.store` under `tips`): at the first chance (a `/flow`, or an interactive session starting, as a toast) while it's still the fire and no other scene has been on, the other scenes; three chances later, if the sound has never been on, the sound.

## Development

```sh
claude --plugin-dir .        # load it, with hot reload of the source
claude plugin validate .     # the module's rules, the manifests, the hooks
claude plugin test .         # the tests, including those that need the engine
npm install                  # once, for the scripts below (tsx)
npm run preview -- <scene>   # print it here: levels 1/5/10, band and spine, day/night, each tint
npm run check                # plugin.json in step, level 0 blank, colour pairs, timing; exits 1 on a problem
npm run sounds               # rebuild the soundscapes' clips (needs sox and ffmpeg)
```

- Hot reload doesn't follow symlinks. To use a dev-mods folder, copy the plugin in (rsync) rather than linking it.
- Every file starts with a `// REVISION: flow-vNN-<what>` line; bump it when you change the file. On load the mod logs `[flow] REVISION: …`, the local time and the UTC offset to the debug log (`claude --debug`), so you can tell which version is running.
- After visual changes, run `npm run preview -- <scene>` (levels 1, 5 and 10 in both layouts, by day and night and with each tint) and look at it.
- Run `npm run check`: the color-pair count and the timing for each scene.
