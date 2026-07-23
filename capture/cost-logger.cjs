#!/usr/bin/env node

// Cost logger — the single source of truth for capturing session cost data.
// Silent: produces no output and swallows its own errors so it can never
// break a statusline that invokes it.
//
// Two ways to invoke:
//   1. As a module:    require('./cost-logger.cjs').logCost(payload)
//   2. Standalone:     echo "$PAYLOAD_JSON" | node cost-logger.cjs
//
// The payload is the statusline JSON Claude Code writes to stdin. Cost data
// (cost.total_cost_usd, cache tokens, etc.) exists ONLY in this payload —
// hook payloads don't carry it — which is why capture rides on the statusline.
//
// Outputs:
//   ~/.claude/cost-log.jsonl                              one line per session (upserted)
//   ~/.claude/projects/<mapped-dir>/<session>.cost.jsonl  cost samples, ~5s resolution
//                                                         during activity; bucket into
//                                                         turns via the Stop hook's
//                                                         <session>.turn-boundaries.jsonl

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { stateFilePath, sanitizeSessionId } = require("./state-dir.cjs");
const { mappedProjectDir } = require("./mapped-dir.cjs");
const { readStatuslinePayload } = require("./statusline-payload.cjs");

function logCost(data) {
  const {
    model: MODEL,
    dir: DIR,
    cost: COST,
    pct: PCT,
    durationMs: DURATION_MS,
    apiDurationMs: API_DURATION_MS,
    sessionId: SESSION_ID,
    cacheRead: CACHE_READ,
    cacheWrite: CACHE_WRITE,
    linesAdded: LINES_ADDED,
    linesRemoved: LINES_REMOVED,
  } = readStatuslinePayload(data);

  if (!SESSION_ID) return;

  const MAPPED_DIR = mappedProjectDir(DIR);
  const TURN_LOG = path.join(
    os.homedir(),
    ".claude",
    "projects",
    MAPPED_DIR,
    `${sanitizeSessionId(SESSION_ID)}.cost.jsonl`,
  );
  const PREV_STATE_FILE = stateFilePath("prevstate", SESSION_ID);
  const CACHE_ACCUM_FILE = stateFilePath("cache-accum", SESSION_ID);

  // Activity detection — fires when API_DURATION_MS changes since last poll.
  // Each firing logs one cost SAMPLE (~5s resolution during activity), not a
  // turn; the Stop hook's turn-boundaries log is what groups samples into turns.
  let PREV_COST = 0;
  let PREV_LINES_ADDED = 0;
  let PREV_LINES_REMOVED = 0;
  let SAMPLE_NUM = 0;
  let PREV_API_MS = 0;
  let STORED_API_MS = "";
  if (fs.existsSync(PREV_STATE_FILE)) {
    const parts = fs.readFileSync(PREV_STATE_FILE, "utf8").trim().split("|");
    PREV_COST = Number.parseFloat(parts[0]) || 0;
    PREV_LINES_ADDED = Number.parseInt(parts[1], 10) || 0;
    PREV_LINES_REMOVED = Number.parseInt(parts[2], 10) || 0;
    SAMPLE_NUM = Number.parseInt(parts[3], 10) || 0;
    PREV_API_MS = Number.parseInt(parts[4], 10) || 0;
    STORED_API_MS = parts[4] ?? "";
  }
  if (String(API_DURATION_MS) === STORED_API_MS) return;

  // Resume guard — cumulative totals went backwards, so the session was
  // resumed (counters restarted) or the /tmp state is stale. Re-baseline
  // instead of emitting a garbage negative-delta sample.
  if (COST < PREV_COST || API_DURATION_MS < PREV_API_MS) {
    fs.writeFileSync(CACHE_ACCUM_FILE, `${CACHE_READ}|${CACHE_WRITE}`);
    fs.writeFileSync(
      PREV_STATE_FILE,
      `${COST}|${LINES_ADDED}|${LINES_REMOVED}|${SAMPLE_NUM}|${API_DURATION_MS}`,
    );
    return;
  }

  // Cache accumulation
  let ACCUM_READ = 0;
  let ACCUM_WRITE = 0;
  if (fs.existsSync(CACHE_ACCUM_FILE)) {
    [ACCUM_READ, ACCUM_WRITE] = fs
      .readFileSync(CACHE_ACCUM_FILE, "utf8")
      .trim()
      .split("|")
      .map(Number);
  }
  ACCUM_READ += CACHE_READ;
  ACCUM_WRITE += CACHE_WRITE;
  fs.writeFileSync(CACHE_ACCUM_FILE, `${ACCUM_READ}|${ACCUM_WRITE}`);

  // Session log — upsert (skip if no dir, e.g. odd payload)
  if (DIR) {
    const COST_LOG = path.join(os.homedir(), ".claude", "cost-log.jsonl");
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const LOG_ENTRY = JSON.stringify({
      session_id: SESSION_ID,
      timestamp: ts,
      cost_usd: COST,
      dir: DIR,
      model: MODEL,
      duration_ms: DURATION_MS,
      cache_read: ACCUM_READ,
      cache_write: ACCUM_WRITE,
      lines_added: LINES_ADDED,
      lines_removed: LINES_REMOVED,
      context_pct: PCT,
    });
    if (fs.existsSync(COST_LOG) && fs.statSync(COST_LOG).size > 0) {
      const filtered = fs
        .readFileSync(COST_LOG, "utf8")
        .split("\n")
        .filter((l) => l.trim() && !l.includes(`"session_id":"${SESSION_ID}"`));
      fs.writeFileSync(COST_LOG, filtered.join("\n") + (filtered.length ? "\n" : ""));
    }
    fs.appendFileSync(COST_LOG, `${LOG_ENTRY}\n`);
  }

  // Sample log
  SAMPLE_NUM += 1;
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const SAMPLE_ENTRY = JSON.stringify({
    session_id: SESSION_ID,
    sample: SAMPLE_NUM,
    timestamp: ts,
    epoch: Math.floor(Date.now() / 1000),
    cost_delta_usd: Number.parseFloat((COST - PREV_COST).toFixed(6)),
    cumulative_cost_usd: COST,
    api_duration_ms: API_DURATION_MS - PREV_API_MS,
    cache_read_tokens: CACHE_READ,
    cache_write_tokens: CACHE_WRITE,
    lines_added: LINES_ADDED - PREV_LINES_ADDED,
    lines_removed: LINES_REMOVED - PREV_LINES_REMOVED,
    context_pct: PCT,
  });
  fs.mkdirSync(path.dirname(TURN_LOG), { recursive: true });
  fs.appendFileSync(TURN_LOG, `${SAMPLE_ENTRY}\n`);
  fs.writeFileSync(
    PREV_STATE_FILE,
    `${COST}|${LINES_ADDED}|${LINES_REMOVED}|${SAMPLE_NUM}|${API_DURATION_MS}`,
  );
}

module.exports = { logCost };

if (require.main === module) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    try {
      logCost(JSON.parse(input));
    } catch (_) {
      /* silent capture — never break the caller */
    }
  });
}
