# flow

<img width="1200" height="384" alt="Flow's fire above the prompt: pilot lights at idle, climbing with each of Claude's tool calls, an inferno with three subagents, then back down when Claude is done" src="https://github.com/user-attachments/assets/0f0120cc-af23-44ec-9398-309cccd42764" />

Ambient scenes in your terminal that move with the work your coding agent is doing: a fire, fizzing bubbles, the surf, a ski run, two rockets, a hot-air balloon, a steam engine, and a colony ship behind its shield. They run above the prompt of Claude Code (in the terminal or the Claude desktop app) or [pi](https://github.com/badlogic/pi-mono), or in a tall pane beside Claude Code's transcript.

https://github.com/user-attachments/assets/191a662b-9c5d-4d18-b35c-4d054988b98d

By Rob Macrae.

Each scene is drawn in 24-bit color from Unicode block, quadrant and braille characters, so several pixels share each terminal cell. In the Claude desktop app, which has no character grid to draw into, the same frames are drawn as images.

## Install

**Claude Code**, from inside a session:

```
/plugin marketplace add robdmac/flow
/plugin install flow@robdmac
/reload-plugins
```

**Claude desktop**, in the Code tab: click **+** next to the prompt box, then **Plugins** → **Add plugin**, add the marketplace `robdmac/flow` and install **flow**. Manage it later from **+** → **Plugins** → **Manage plugins**. The desktop app and Claude Code share their plugins, so if you've installed Flow in the terminal it's already there. It runs in local sessions, not cloud ones.

**pi**, from your shell:

```
pi install git:github.com/robdmac/flow
```

Mods are an early-access Claude Code feature, and their API may change between releases (see Compatibility below).

### Not loading?

If `/flow` doesn't exist after installing, run `claude --debug` and look for a line about **hooks modules**:

- **"the rollout flag (tengu_plugin_hooks_modules) is off"**: mods from installed plugins are still being rolled out account by account, and yours doesn't have them yet. Update Claude Code (`claude update`), then turn them on yourself for one launch:

  ```
  CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
  ```

  (`claude -r` instead of `claude` resumes your last session.) To keep it on, add it to `~/.claude/settings.json`:

  ```json
  "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
  ```

  or export it in your shell profile.
- **"saved off by an earlier session"**: the flag was cached as off and hasn't refreshed yet. Start a new session, or use the setting above.
- **"not available on Bedrock/Vertex/third-party providers"** or **"with a custom ANTHROPIC_BASE_URL"**: mods only run against the Anthropic API, so Flow can't load there.
- **"until workspace trust is accepted"**: accept the trust prompt for the folder you started Claude in.

## The scenes

Every scene has a level from 0 (off) to 10 (as busy as it gets).

| Scene | At 1 | At 10 |
|---|---|---|
| `fire` | a low glow of embers | a roaring fire throwing sparks |
| `warp` | stars drifting past | hyperspace streaks |
| `avalon` | a colony ship among still stars, its habitat turning, the odd rock burning up on its shield | stars streaking past, rocks flaring on the shield every second |
| `balloon` | a hot-air balloon on the grass | up through the clouds to the edge of space |
| `engine` | a steampunk engine standing still | cogs, belts and pistons at full speed |
| `falcon`, `starship` | the rocket on its pad | climbing through the sky (2–7), separating at about 7, the upper stage in orbit (8–10); as it stages the screen splits, one side following the booster back down (falcon's lands on its legs, starship's is caught by the tower's arms), the other staying with the upper stage; brought home, falcon's Dragon capsule comes down under parachutes to a splashdown and the view slides back to the pad, and starship's Ship splashes down at sea and is carried back for the arms to lift on |
| `surf` | a glassy sea at dawn | big barrelling waves |
| `ski` | an easy run | a steep mogul run at speed |
| `bubbles` | a couple of lazy strings of bubbles | a rolling, fizzing boil |

Some scenes also answer to other names: `inferno` and `flame` (fire), `stars` (warp), `colony` and `interstellar` (avalon), `mechanism` (engine), `rocket` (falcon), `spaceship` (starship), `ocean` and `sea` (surf), `snow` (ski).

Balloon, falcon, starship, surf and ski also have a **night** version: stars, a moon, and moonlit snow or water. By night, bubbles turns into a stout: pale tan bubbles rising through black. By default day and night follow your local clock (night is 19:00 to 7:00). `/flow day` or `/flow night` pins one.

## What moves it (auto mode)

| Your agent is… | The scene |
|---|---|
| idle | a low glow (or nothing, if you choose) |
| in a turn | rises to a level set by effort: `low` 2, default 3, `high` 4, `xhigh` 5, `max` 6 |
| working a while | one level more for every 30 s the turn has run |
| streaming an answer | keeps going (limited per second, so plain chat sits mid-range) |
| editing files | pushes higher, scaled by the lines written |
| running commands | sparks; a slow command keeps it ticking over |
| running subagents | busier with each one (with diminishing returns); some scenes add company: more balloons, surfers or skiers, a wider fire, more lights on the launch tower |
| hitting a failed command, or compacting | smoke for a moment: smoky flame tips, sooty steam, a grey sky, a wipeout, a rocket's plume sputtering grey |
| near a full context (≥85%) | blue: a blue-white flame, a storm, dusk on the slopes, a blue gas flame |

A plain answer sits around 5, edit-and-test loops reach about 8, and 10 takes several subagents editing in parallel, or a long turn: it climbs a level every 30 s it keeps going.

## The command

`/flow` changes things at once. The settings are also rows in `/config` (*Scene mode*, *Scene*, *Scene while idle*, *Manual level*, *Scene layout*, *Day or night*).

| Command | Effect |
|---|---|
| `/flow` | show the scene, mode, level and time of day |
| `/flow <scene>` | pick a scene by name or alias (`/flow surf`, `/flow sea`) |
| `/flow next` | the next scene |
| `/flow day` / `night` | pin the time of day |
| `/flow clock` | day or night by your local clock (the default) |
| `/flow <scene> night` | a scene and a time of day at once |
| `/flow auto` | move with the agent's work (the default) |
| `/flow 1`–`10` / `off` | hold a fixed level, or switch it off |
| `/flow idle glow` / `dark` | in auto mode while idle: a low glow (the default), or nothing (the band gives its rows back) |
| `/flow sound` | toggle a soundscape for the scene, swelling with the work (macOS; off by default); `/flow sound on` / `off` to set it |
| `/flow band` / `spine` | a 5-row band above the prompt (the default; also `horizontal`, `bar` or `flat`), or a tall pane docked beside the transcript (also `portrait`, `vertical` or `side`) |
| `/flow help` | list all of this |


## Sound

`/flow sound` (or *Sound* in `/config`) turns on a soundscape for each scene, and turns it off again, each one tuned against real recordings so it sounds like the thing itself: a campfire's sparse, bright crackle over the soft lick of its flames (and a bonfire's roar at the top), a beach's wash and its waves breaking now and then on a calm day, often on a rough one, a steam engine's chuffs in time with its crank, water bubbling and boiling, wind gusting round a balloon and its burner roaring, skis carving through snow, a rocket's roar and crackle matched to NASA's launch recordings. The colony ship and the warp drive are science fiction, so theirs are designed: the hull's hum, the shield fizzing, and a low, muffled boom through the hull as each rock blows up on it; the drive's hum climbing with speed.

The background is long takes that blend one into the next at random moments, so nothing comes round on a beat, and a fresh one crossfades in whenever the level or the scene changes (a rocket on the pad, climbing, in orbit, coming home). On top of it you hear what happens on screen, as it happens: bubbles bursting, rocks blowing up on the shield, sparks, a wave breaking, each ski turn, the hammer, and the rockets' ignition, staging, the booster's sonic boom, the catch, parachutes and splashdown. Every scene follows the same loudness from level 1 (quiet) to 10.

It plays only while the scene is on screen, and stops with the session. Claude Code plays the clips with `afplay`, so it's macOS only; elsewhere the setting does nothing. Several sessions open at once each play their own.

## Turning it off

Run `/flow off`, or `/flow idle dark` to stay in auto mode but show nothing while idle. You can also disable the plugin. Flow draws in the terminal and in the Claude desktop app; not in VS Code or on mobile.

## pi

The same scenes run as a pi extension (`pi/index.ts`): a widget above pi's editor, drawn as 24-bit ANSI lines. It shares the scenes, the activity model and the `/flow` command with the Claude Code version. pi has no side panes, so there is no spine there, and no built-in subagents. pi's events drive it:

| pi event | The scene |
|---|---|
| `agent_start` / `agent_end` | a turn lifts it (a level more for every 30 s it runs), then it settles to idle |
| `turn_start` | rises to the floor for `ctx.thinkingLevel` (`minimal`/`low` 2 … `max` 6) |
| `message_update` deltas | streamed text and thinking keep it going |
| `tool_call` | `write`/`edit` push it by lines written, `bash` sparks, reads flicker |
| `tool_result` with `isError` | a failed command shows as smoke |
| `session_compact` | so does a compaction |
| `ctx.getContextUsage()` | a nearly-full context shows as blue |

Settings persist in `~/.pi/agent/flow.json`. To try it without installing: `pi --extension ./pi/index.ts`.

## Cost

Flow repaints about 14 times a second while busy and 8 times when calm. It skips unchanged frames and doesn't repaint at all while off screen. In the desktop app it redraws at most 10 times a second. The heaviest scene takes under 2 ms per frame.

## Compatibility

Built against Claude Code 2.1.289 and pi 1.0.0. Mods (function-hook plugins) are early access: the API may change between Claude Code releases, so a newer release can break flow until it's updated.

## Development

```sh
claude --plugin-dir .   # load it, with hot reload
claude plugin validate .
claude plugin test .
```

### Add your own scene

```sh
npm install
npm run new-scene -- aurora --blurb "curtains of light that ripple faster with the work" --night
npm run preview -- aurora    # see it here at levels 1, 5 and 10, as a band and a spine, with each tint
claude --plugin-dir .        # then /flow aurora
npm run check                # colour pairs and timing, before you open a pull request
```

`new-scene` writes `hooks/aurora.ts`: a scene that already moves with the level, shows the tints and (with `--night`) has a night. Edit its `paint()`: it gets a grid of pixels (2 × 2 a terminal cell) and the dials (the level, eased; the frame count; night; the tint; whether it's the tall spine). [AGENTS.md](AGENTS.md) has the rules a scene keeps to.

Every hook file carries a `// REVISION:` marker. On startup the mod writes the loaded revision, the local time and the UTC offset to the debug log (`claude --debug`).

## License

[MIT](./LICENSE)
