# capture/

Producer side of claude-lens's premium cost-capture tier. These scripts run
**inside your own Claude Code session**, not inside claude-lens — they have
zero dependency on this repo or the claude-lens server. The full design is
archived on the wiki:
[ARCH-producer-cost-capture-tier](https://github.com/foyzulkarim/claude-lens/wiki/ARCH-producer-cost-capture-tier)
(issue [#112](https://github.com/foyzulkarim/claude-lens/issues/112), plan task #P4-21).

## What each file does

| File | Runs as | Purpose |
|------|---------|---------|
| `cost-logger.cjs` | required by the statusline scripts, or standalone via stdin | Writes one C sample per statusline tick (~5s during activity) and upserts the L row |
| `turn-logger.cjs` | `hooks.Stop` command | Writes one B line per completed turn |
| `statusline-command.cjs` | `statusLine.command` | Full statusline (model, $, context bar, timers) + calls `cost-logger.cjs` |
| `statusline-wrapper.cjs` | `statusLine.command` | For machines that already have a statusline: captures cost, then delegates to your original command |
| `statusline-payload.cjs` | required by the statusline scripts | Shared parsing of the statusline stdin payload |
| `state-dir.cjs` | required by the loggers | Resolves the per-session state directory |
| `mapped-dir.cjs` | required by the loggers | Maps a working directory to Claude Code's project-slug directory |
| `merge-settings.cjs` | invoked by `install.sh` | The settings.json merge engine |
| `settings.snippet.json` | reference | Copy-paste `statusLine` + `hooks.Stop` shape for manual setup |
| `install.sh` | `bash capture/install.sh` | Idempotent installer — see below |

The first seven `.cjs` files are what `install.sh` copies into
`~/.claude/scripts/`; `merge-settings.cjs` runs from this repo and is not
installed.

## Install

```sh
bash capture/install.sh
```

This copies the seven runtime `.cjs` scripts into `~/.claude/scripts/` and merges the
`statusLine` and `hooks.Stop` wiring into `~/.claude/settings.json`:

- If you have no `statusLine` configured, it's set to `statusline-command.cjs`
  (a full display statusline with cost capture built in).
- If your `statusLine` already points at one of these scripts (even the old
  `.js` names), it's upgraded in place — no wrapping.
- If your `statusLine` points at something else, your original command is
  saved to `~/.claude/scripts/statusline-original.json` and `statusLine` is
  repointed at `statusline-wrapper.cjs`, which captures cost and then
  delegates to your original command's output unchanged.
- A `hooks.Stop` entry running `turn-logger.cjs` is appended, unless one
  already references it. Every other hook entry and event is left alone.

The script is safe to re-run: if nothing needs to change it reports "already
configured" and touches nothing. Otherwise it backs up the current
`settings.json` to `settings.json.backup-<unix-timestamp>` before writing.

**Rollback:** `cp ~/.claude/settings.json.backup-<timestamp> ~/.claude/settings.json`
using the most recent backup file.

### Manual setup

If you'd rather not run the script, copy the seven runtime `.cjs` files into
`~/.claude/scripts/` yourself (everything in the table above except
`merge-settings.cjs`) and merge `settings.snippet.json`'s
`statusLine` + `hooks.Stop` keys into your own `~/.claude/settings.json`.

## Verifying it worked

Run one Claude Code session anywhere, then check for output files:

- `~/.claude/projects/<slug>/<session-id>.cost.jsonl` (C)
- `~/.claude/projects/<slug>/<session-id>.turn-boundaries.jsonl` (B)
- `~/.claude/cost-log.jsonl` (L)

`<slug>` is your session's working directory with every `/` and `.`
converted to `-` (matching Claude Code's own project-directory naming), so
sidecars land next to the transcript claude-lens already discovers. In
claude-lens itself, the session should show as observed 🟢 rather than
computed 🟡 once the server picks these files up, and the Settings page's
"Cost capture setup" panel should report it as verified.

## Field contract

The emitted field names are load-bearing — they're read directly by
`server/ingest/parse-premium.ts` in claude-lens, which is not modified by
this directory. If you change a field name here, fix the producer, not the
parser.

**C — `<uuid>.cost.jsonl`** (one line per ~5s sample during activity):
`session_id`, `sample`, `timestamp`, `epoch`, `cost_delta_usd`,
`cumulative_cost_usd`, `api_duration_ms`, `cache_read_tokens`,
`cache_write_tokens`, `lines_added`, `lines_removed`, `context_pct`.
`cost_delta_usd`, `api_duration_ms`, `lines_added`, `lines_removed` are all
deltas since the previous sample; `cumulative_cost_usd`,
`cache_read_tokens`, `cache_write_tokens`, `context_pct` are point-in-time.

**B — `<uuid>.turn-boundaries.jsonl`** (one line per completed turn):
`session_id`, `turn_end`, `turn_end_epoch`, `transcript_path`.

**L — `cost-log.jsonl`** (one row per session, upserted on every tick):
`session_id`, `timestamp`, `cost_usd` (session total, not a delta), `dir`,
`model`, `duration_ms` (wall-clock, not `api_duration_ms`), `cache_read` /
`cache_write` (accumulated across samples, unlike C's point-in-time
values), `lines_added`, `lines_removed`, `context_pct`.

## Known limitation: concurrent sessions and the L file

`cost-logger.cjs` upserts `cost-log.jsonl` by reading the whole file,
filtering out the session's prior row, and appending the new one. If two
Claude Code sessions tick at the same moment (e.g. parallel worktrees),
one session's write can race and overwrite the other's — a genuine lost
update. This is accepted as-is (not fixed) because:

- It's bounded and self-healing: the losing session's row reappears on its
  next tick (~5s later), and C (per-session, append-only) never loses data
  either way.
- Fixing it would mean changing the L file format (e.g. a lockfile, or
  append-only-with-last-wins-at-read), which would break the
  already-shipped `parseCostLogLines` reader in claude-lens.

## Uninstalling

There's no uninstall script. To remove capture:

1. Edit `~/.claude/settings.json` and remove the `statusLine` /
   `hooks.Stop` entries these scripts added (or restore a
   `settings.json.backup-*` file from before you installed).
2. Delete the `.cjs` files from `~/.claude/scripts/` if you no longer want
   them there — stale files are harmless once nothing references them.
