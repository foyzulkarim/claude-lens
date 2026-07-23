#!/usr/bin/env bash
set -euo pipefail

# Idempotent installer for the claude-lens producer-side cost-capture tier
# (specs/architecture/ARCH-producer-cost-capture-tier.md). Copies the vendored
# capture/*.cjs scripts into ~/.claude/scripts/ and merges statusLine +
# hooks.Stop wiring into ~/.claude/settings.json without clobbering existing
# config (capture/merge-settings.cjs does the merge — parse, merge, compare,
# backup, atomic write, in that order).
#
# Usage: bash capture/install.sh
# Exit codes: 0 installed or already-configured; 1 node not found,
# settings.json unparseable, or the write failed.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${HOME}/.claude"
SCRIPTS_DIR="${CLAUDE_DIR}/scripts"
SETTINGS_FILE="${CLAUDE_DIR}/settings.json"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "error: node not found on PATH — install Node.js (https://nodejs.org) and re-run this script" >&2
  exit 1
fi

mkdir -p "$SCRIPTS_DIR"
for f in cost-logger.cjs turn-logger.cjs statusline-command.cjs statusline-wrapper.cjs state-dir.cjs mapped-dir.cjs statusline-payload.cjs; do
  cp "$SCRIPT_DIR/$f" "$SCRIPTS_DIR/$f"
done

if "$NODE_BIN" "$SCRIPT_DIR/merge-settings.cjs" "$SETTINGS_FILE" "$SCRIPTS_DIR" "$NODE_BIN"; then
  echo "capture scripts installed to $SCRIPTS_DIR"
  echo "rollback: restore the newest $SETTINGS_FILE.backup-* file with cp, if one was written"
else
  exit 1
fi
