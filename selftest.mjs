import assert from "node:assert/strict";
import { Activity } from "./hooks/activity.ts";
import { updateFlowActivity } from "./activity.mjs";

const activity = new Activity();
const update = panes => updateFlowActivity(activity, panes, {
  selfPaneId: "flow",
  primaryPaneId: "main",
});

let state = update([
  { pane_id: "flow", agent: "flow", agent_status: "working" },
  { pane_id: "main", agent: "omp", agent_status: "idle" },
  { pane_id: "worker", agent: "omp", agent_status: "working", terminal_title: "worker task" },
  { pane_id: "blocked", agent: "omp", agent_status: "blocked", terminal_title: "blocked task" },
]);
assert.equal(state.activeCount, 1, "the Flow pane is excluded from activity");
assert.equal(state.blockedCount, 1);
assert.equal(activity.runningAgents, 1);
assert.equal(activity.isWorking, true);
assert.equal(activity.isWaiting, true);
assert.ok(activity.coverageBoost > 0);

state = update([
  { pane_id: "flow", agent: "flow", agent_status: "working" },
  { pane_id: "main", agent: "omp", agent_status: "working" },
  { pane_id: "worker", agent: "omp", agent_status: "done", terminal_title: "worker task" },
  { pane_id: "blocked", agent: "omp", agent_status: "idle", terminal_title: "blocked task" },
]);
assert.equal(state.activeCount, 1);
assert.equal(state.blockedCount, 0);
assert.equal(activity.isTurnActive, true);
assert.equal(activity.isWaiting, false);

state = update([
  { pane_id: "flow", agent: "flow", agent_status: "working" },
  { pane_id: "main", agent: "omp", agent_status: "idle" },
]);
assert.equal(state.activeCount, 0);
assert.equal(activity.isWorking, false);
console.log("selftest: Herdr pane activity maps to Flow states");
