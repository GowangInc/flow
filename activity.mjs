const STATUS = {
  working: true,
  blocked: true,
  done: true,
  idle: true,
  unknown: true,
};

export function updateFlowActivity(activity, panes, {
  selfPaneId,
  primaryPaneId,
}) {
  const monitored = panes.filter(pane =>
    pane?.pane_id && pane.pane_id !== selfPaneId && STATUS[pane.agent_status] === true,
  );
  const primary = monitored.find(pane => pane.pane_id === primaryPaneId) ?? monitored[0];
  const companions = monitored.filter(pane => pane !== primary);
  const nextWaiting = new Set(monitored
    .filter(pane => pane.agent_status === "blocked")
    .map(pane => pane.pane_id));

  for (const paneId of activity.waits) {
    if (!nextWaiting.has(paneId)) activity.answered(paneId);
  }

  if (primary?.agent_status === "working") {
    if (!activity.isTurnActive) activity.turnStarted();
  } else if (activity.isTurnActive) {
    activity.turnEnded();
  }

  for (const pane of companions) {
    if (pane.agent_status === "working") activity.modelStep("medium", true);
  }

  activity.runningAgents = companions.filter(pane => pane.agent_status === "working").length;

  for (const paneId of nextWaiting) {
    activity.waitingOn(paneId);
  }

  return {
    activeCount: monitored.filter(pane => pane.agent_status === "working").length,
    blockedCount: nextWaiting.size,
    waitingPaneIds: nextWaiting,
  };
}
