#!/usr/bin/env node

// Stop hook — fired exactly once per turn completion. The Stop payload carries
// no cost data (that lives only in the statusline payload), so this script's
// job is boundaries, not dollars:
//   1. Stamp the turn-end time for the statusline idle timer.
//   2. Append a turn-boundary record so analytics can bucket the cost samples
//      written by cost-logger.cjs (via the statusline) into real turns, and
//      follow transcript_path into the session transcript to investigate an
//      abnormal turn's token usage.
//
// Hardened (A6): the whole handler runs inside a try/catch so a malformed
// Stop payload or an EACCES on the boundary directory can never surface a
// hook error to the user — capture failures must stay silent.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { stateFilePath, sanitizeSessionId } = require("./state-dir.cjs");
const { mappedProjectDir } = require("./mapped-dir.cjs");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input);
    const SESSION_ID = data.session_id ?? "";
    if (!SESSION_ID) return;

    const NOW = Math.floor(Date.now() / 1000);
    const LAST_ACTIVITY_FILE = stateFilePath("lastactivity", SESSION_ID);
    fs.writeFileSync(LAST_ACTIVITY_FILE, `${NOW}`);

    const CWD = data.workspace?.current_dir ?? data.cwd ?? "";
    if (!CWD) {
      console.error(`[turn-logger] missing cwd for session ${SESSION_ID}, skipping boundary`);
      return;
    }
    const BOUNDARY_DIR = path.join(os.homedir(), ".claude", "projects", mappedProjectDir(CWD));
    const BOUNDARY_LOG = path.join(
      BOUNDARY_DIR,
      `${sanitizeSessionId(SESSION_ID)}.turn-boundaries.jsonl`,
    );
    const ENTRY = JSON.stringify({
      session_id: SESSION_ID,
      turn_end: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      turn_end_epoch: NOW,
      transcript_path: data.transcript_path ?? "",
    });
    fs.mkdirSync(BOUNDARY_DIR, { recursive: true });
    fs.appendFileSync(BOUNDARY_LOG, `${ENTRY}\n`);
  } catch (_) {
    /* silent capture — a Stop hook must never surface an error to the user */
  }
});
