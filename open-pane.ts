import { spawnSync } from "node:child_process";

const herdr = process.env.HERDR_BIN_PATH || "herdr";
const workspaceId = process.env.HERDR_WORKSPACE_ID;
const primaryPaneId = process.env.HERDR_PANE_ID;
const pluginRoot = process.env.HERDR_PLUGIN_ROOT || process.cwd();
if (!workspaceId || !primaryPaneId) throw new Error("Invoke Flow from a Herdr pane");

function run(args: string[]) {
  const result = spawnSync(herdr, args, {
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `herdr ${args[0]} exited ${result.status}`);
  return result.stdout ? JSON.parse(result.stdout) : undefined;
}

const split = run([
  "pane", "split", "--pane", primaryPaneId,
  "--direction", "down", "--ratio", "0.87",
  "--cwd", pluginRoot,
  "--env", `FLOW_PRIMARY_PANE_ID=${primaryPaneId}`,
  "--no-focus",
]);
const paneId = split?.result?.pane?.pane_id;
if (typeof paneId !== "string") throw new Error("Herdr did not return the new Flow pane ID");

try {
  run(["pane", "rename", paneId, "Flow"]);
  run(["pane", "run", paneId, "\"$HOME/.bun/bin/bun\" run flow-pane.ts"]);
} catch (error) {
  run(["pane", "close", paneId]);
  throw error;
}
