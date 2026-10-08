import { spawnSync } from "node:child_process";
import { Activity } from "./hooks/activity.ts";
import { SceneDriver } from "./hooks/scene.ts";
import { readConfig } from "./hooks/settings.ts";
import { nextStyle } from "./hooks/styles.ts";
import { gridToAnsi } from "./pi/ansi.ts";
import { updateFlowActivity } from "./activity.mjs";

const workspaceId = process.env.HERDR_WORKSPACE_ID;
const selfPaneId = process.env.HERDR_PANE_ID;
const primaryPaneId = process.env.FLOW_PRIMARY_PANE_ID;
const herdr = process.env.HERDR_BIN_PATH || "herdr";
if (!workspaceId || !selfPaneId) throw new Error("Flow must run inside a Herdr plugin pane");

const activity = new Activity();
const driver = new SceneDriver(readConfig(undefined), activity);
let waitingPaneIds = new Set<string>();
let activeCount = 0;
let blockedCount = 0;
let lastError = false;
let lastPoll = 0;
let lastFrame = Date.now();
let lastSize = "";
let timer: NodeJS.Timeout | undefined;
let closing = false;
let rawInput = false;

function readPanes() {
  const result = spawnSync(herdr, ["pane", "list", "--workspace", workspaceId], {
    encoding: "utf8",
    timeout: 2500,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `herdr exited ${result.status}`);
  const data = JSON.parse(result.stdout);
  const panes = data?.result?.panes ?? data?.panes;
  if (!Array.isArray(panes)) throw new Error("Herdr pane list returned no panes");
  return panes;
}

function poll() {
  lastPoll = Date.now();
  try {
    const result = updateFlowActivity(activity, readPanes(), {
      selfPaneId,
      primaryPaneId,
    });
    waitingPaneIds = result.waitingPaneIds;
    activeCount = result.activeCount;
    blockedCount = result.blockedCount;
    lastError = false;
  } catch {
    lastError = true;
  }
}

function restoreTerminal() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (rawInput && process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    rawInput = false;
  }
  process.stdout.write("\x1b[0m\x1b[?25h\x1b[2J\x1b[H");
}
function handleTermination() {
  restoreTerminal();
  process.exit(0);
}

function closePane() {
  if (closing) return;
  closing = true;
  restoreTerminal();
  spawnSync(herdr, ["pane", "close", selfPaneId], {
    encoding: "utf8",
    timeout: 2500,
    stdio: "ignore",
  });
  process.exit(0);
}

function input(text: string) {
  for (const key of text) {
    if (key === "q" || key === "\u0003") return closePane();
    if (key === "n") driver.cfg.style = nextStyle(driver.cfg.style);
    else if (key === "a") driver.cfg.mode = driver.cfg.mode === "auto" ? "manual" : "auto";
    else if (/^[0-9]$/.test(key)) {
      driver.cfg.mode = "manual";
      driver.cfg.level = Number(key);
    }
  }
}

function render() {
  if (closing) return;
  const now = Date.now();
  activity.tick((now - lastFrame) / FRAME_MS);
  lastFrame = now;
  if (now - lastPoll >= 1000) poll();

  const columns = Math.max(1, process.stdout.columns || 80);
  const artRows = Math.max(1, Math.min(5, (process.stdout.rows || 6) - 1));
  const size = `${columns}x${artRows}`;
  if (size !== lastSize) {
    lastSize = size;
    process.stdout.write("\x1b[2J\x1b[H");
  }

  driver.clock = { hour: new Date().getHours(), minute: new Date().getMinutes() };
  const scene = driver.dial();
  scene.ensure(columns, artRows);
  scene.step();
  const status = `FLOW ${driver.cfg.style} | ${activeCount} working | ${blockedCount} waiting | n next, a auto, 0-9 level, q close${lastError ? " | Herdr status unavailable" : ""}`;
  const header = status.length > columns ? status.slice(0, columns) : status.padEnd(columns);
  const lines = gridToAnsi(scene.grid());
  process.stdout.write(`\x1b[H\x1b[2K${header}\r\n${lines.join("\r\n")}`);
  timer = setTimeout(render, driver.pace());
}

process.on("SIGINT", closePane);
process.on("SIGTERM", handleTermination);
process.on("exit", restoreTerminal);
process.stdout.write("\x1b[?25l");
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", bytes => input(bytes.toString("utf8").toLowerCase()));
  rawInput = true;
}
poll();
render();
