# flow

Ambient scenes in your terminal that move with the work your coding agent is doing: a fire, a river, fizzing bubbles, a liquid lamp, the surf, a ski run, two rockets, a hot-air balloon, a steam engine, and a colony ship behind its shield. They run above the prompt of Claude Code or [pi](https://github.com/badlogic/pi-mono), or in a tall pane beside Claude Code's transcript.

By Rob Macrae.

Each scene is drawn in 24-bit color from Unicode block, quadrant and braille characters, so several pixels share each terminal cell.

## Install

**Claude Code**, from inside a session:

```
/plugin marketplace add robdmac/flow
/plugin install flow@rob-macrae-mods
/reload-plugins
```

**pi**, from your shell:

```
pi install git:github.com/robdmac/flow
```

Mods are an early-access Claude Code feature, and their API may change between releases (see Compatibility below).

## The scenes

Every scene has a level from 0 (off) to 10 (as busy as it gets).

| Scene | At 1 | At 10 |
|---|---|---|
| `fire` | a low glow of embers | a roaring fire throwing sparks |
| `warp` | stars drifting past | hyperspace streaks |
| `colony` | a colony ship among still stars, its habitat turning, the odd rock burning up on its shield | stars streaking past, rocks flaring on the shield every second |
| `balloon` | a hot-air balloon on the grass | up through the clouds to the edge of space |
| `engine` | a steampunk engine standing still | cogs, belts and pistons at full speed |
| `falcon`, `starship` | the rocket on its pad | climbing through the sky (2–7), then in orbit (8–10); coming down, the tower's arms catch it |
| `surf` | a glassy sea at dawn | big barrelling waves |
| `ski` | an easy run | a steep mogul run at speed |
| `river` | a kayak drifting on glassy water | white-water rapids, spray off the bow |
| `bubbles` | a couple of lazy strings of bubbles | a rolling, fizzing boil |
| `lava` | a few glowing blobs drifting in a liquid lamp | the liquid thrashing: blobs stretching, colliding, sloshing |

Balloon, falcon, starship, surf, ski and river also have a **night** version: stars, a moon, and moonlit snow or water. By night, bubbles turns into a stout: pale tan bubbles rising through black. By default day and night follow your local clock (night is 19:00 to 7:00). `/flow day` or `/flow night` pins one.

## What moves it (auto mode)

| Your agent is… | The scene |
|---|---|
| idle | a low glow (or nothing, if you choose) |
| in a turn | rises to a level set by effort: `low` 2, default 3, `high` 4, `xhigh` 5, `max` 6 |
| streaming an answer | keeps going (limited per second, so plain chat sits mid-range) |
| editing files | pushes higher, scaled by the lines written |
| running commands | sparks; a slow command keeps it ticking over |
| running subagents | busier with each one (with diminishing returns); some scenes add company, such as more balloons, kayaks, surfers, skiers or wingmen |
| hitting a failed command, or compacting | smoke for a moment: smoky flame tips, sooty steam, a grey sky, a wipeout, a capsized kayak |
| near a full context (≥85%) | blue: a blue-white flame, a storm, dusk on the slopes, a blue gas flame |

A plain answer sits around 5, edit-and-test loops reach about 8, and 10 takes several subagents editing in parallel.

## The command

`/flow` changes things at once. The settings are also rows in `/config` (*Scene mode*, *Scene*, *Scene while idle*, *Manual level*, *Scene layout*, *Day or night*).

| Command | Effect |
|---|---|
| `/flow` | show the scene, mode, level and time of day |
| `/flow <scene>` | pick a scene (`/flow surf`) |
| `/flow next` | the next scene |
| `/flow day` / `night` | pin the time of day |
| `/flow clock` | day or night by your local clock (the default) |
| `/flow <scene> night` | a scene and a time of day at once |
| `/flow auto` | move with the agent's work (the default) |
| `/flow 1`–`10` / `off` | hold a fixed level, or switch it off |
| `/flow idle glow` / `dark` | in auto mode while idle: a low glow (the default), or nothing (the band gives its rows back) |
| `/flow band` / `spine` | a 5-row band above the prompt (the default), or a tall pane docked beside the transcript |
| `/flow help` | list all of this |


## Turning it off

Run `/flow off`, or `/flow idle dark` to stay in auto mode but show nothing while idle. You can also disable the plugin. Flow only draws in the terminal.

## pi

The same scenes run as a pi extension (`pi/index.ts`): a widget above pi's editor, drawn as 24-bit ANSI lines. It shares the scenes, the activity model and the `/flow` command with the Claude Code version. pi has no side panes, so there is no spine there, and no built-in subagents. pi's events drive it:

| pi event | The scene |
|---|---|
| `agent_start` / `agent_end` | a turn lifts it, then it settles to idle |
| `turn_start` | rises to the floor for `ctx.thinkingLevel` (`minimal`/`low` 2 … `max` 6) |
| `message_update` deltas | streamed text and thinking keep it going |
| `tool_call` | `write`/`edit` push it by lines written, `bash` sparks, reads flicker |
| `tool_result` with `isError` | a failed command shows as smoke |
| `session_compact` | so does a compaction |
| `ctx.getContextUsage()` | a nearly-full context shows as blue |

Settings persist in `~/.pi/agent/flow.json`. To try it without installing: `pi --extension ./pi/index.ts`.

## Cost

Flow repaints about 14 times a second while busy and 8 times when calm. It skips unchanged frames and doesn't repaint at all while off screen. The heaviest scene takes under 2 ms per frame.

## Compatibility

Built against Claude Code 2.1.289 and pi 1.0.0. Mods (function-hook plugins) are early access: the API may change between Claude Code releases, so a newer release can break flow until it's updated.

## Development

```sh
claude --plugin-dir .   # load it, with hot reload
claude plugin validate .
claude plugin test .
```

Every hook file carries a `// REVISION:` marker. On startup the mod writes the loaded revision, the local time and the UTC offset to the debug log (`claude --debug`).

## License

[MIT](./LICENSE)
