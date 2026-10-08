#!/bin/sh
set -eu
cd "${HERDR_PLUGIN_ROOT:?HERDR_PLUGIN_ROOT is required}"
exec "${BUN_BIN:-$HOME/.bun/bin/bun}" run open-pane.ts
