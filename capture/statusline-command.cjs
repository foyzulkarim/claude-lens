#!/usr/bin/env node

// Statusline display. Cost capture is delegated to cost-logger.cjs — this
// script only renders. Guarded so a logger failure can never blank the line.

const fs = require("node:fs");
const { execSync } = require("node:child_process");
const { stateFilePath } = require("./state-dir.cjs");
const { readStatuslinePayload } = require("./statusline-payload.cjs");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    renderStatusline(JSON.parse(input));
  } catch (_) {
    /* malformed/unparseable payload — never crash the statusline */
  }
});

function renderStatusline(data) {
  try {
    require("./cost-logger.cjs").logCost(data);
  } catch (_) {
    /* silent capture — never break the statusline */
  }

  const {
    model: MODEL,
    dir: DIR,
    cost: COST,
    pct: PCT,
    durationMs: DURATION_MS,
    sessionId: SESSION_ID,
    cacheRead: CACHE_READ,
    cacheWrite: CACHE_WRITE,
    linesAdded: LINES_ADDED,
    linesRemoved: LINES_REMOVED,
  } = readStatuslinePayload(data);
  const ADDED_DIRS = (data.workspace?.added_dirs ?? []).map((d) => d.split("/").pop()).join(", ");

  const CYAN = "\x1b[36m";
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const RESET = "\x1b[0m";

  const BAR_COLOR = PCT >= 90 ? RED : PCT >= 70 ? YELLOW : GREEN;
  const BAR = "█".repeat(Math.floor(PCT / 10)) + "░".repeat(10 - Math.floor(PCT / 10));

  const MINS = Math.floor(DURATION_MS / 60000);
  const SECS = Math.floor((DURATION_MS % 60000) / 1000);

  const NOW = Math.floor(Date.now() / 1000);
  const START_EPOCH = Math.floor((NOW * 1000 - DURATION_MS) / 1000);
  const START_TIME = new Date(START_EPOCH * 1000).toTimeString().slice(0, 5);

  const LAST_ACTIVITY_FILE = stateFilePath("lastactivity", SESSION_ID);

  // Idle time — written by turn-logger.cjs (Stop hook) with exact turn-end timestamp
  let IDLE_SECS = 0;
  if (fs.existsSync(LAST_ACTIVITY_FILE)) {
    const parts = fs.readFileSync(LAST_ACTIVITY_FILE, "utf8").trim().split("|");
    // handle old format "API_DURATION_MS|epoch" and new format "epoch"
    const storedEpoch = Number.parseInt(parts.length > 1 ? parts[1] : parts[0], 10) || NOW;
    IDLE_SECS = Math.max(0, NOW - storedEpoch);
  }

  const IDLE_MINS = Math.floor(IDLE_SECS / 60);
  const IDLE_REM = IDLE_SECS % 60;
  const IDLE_COLOR = IDLE_SECS >= 240 ? RED : IDLE_SECS >= 180 ? YELLOW : GREEN;
  const IDLE_DISPLAY = `${IDLE_COLOR}${IDLE_MINS}m${IDLE_REM}s idle${RESET}`;

  const CACHE_TOTAL = CACHE_READ + CACHE_WRITE;
  const CACHE_HIT_PCT = CACHE_TOTAL > 0 ? Math.floor((CACHE_READ * 100) / CACHE_TOTAL) : 0;
  const CACHE_COLOR = CACHE_HIT_PCT >= 80 ? GREEN : CACHE_HIT_PCT >= 40 ? YELLOW : RED;
  const CACHE_READ_K = Math.floor(CACHE_READ / 1000);
  const CACHE_WRITE_K = Math.floor(CACHE_WRITE / 1000);
  const WRITE_PART =
    CACHE_WRITE === 0
      ? ""
      : CACHE_WRITE > CACHE_READ
        ? ` | ${RED}write: ${CACHE_WRITE_K}k${RESET}`
        : ` | ${YELLOW}write: ${CACHE_WRITE_K}k${RESET}`;
  const LINES_DISPLAY = `${GREEN}+${LINES_ADDED}${RESET} ${RED}-${LINES_REMOVED}${RESET}`;
  const CACHE_DISPLAY = `${CACHE_COLOR}cache: ${CACHE_HIT_PCT}%${RESET} | ${GREEN}read: ${CACHE_READ_K}k${RESET}${WRITE_PART} | ${LINES_DISPLAY}`;

  let BRANCH = "";
  try {
    execSync("git rev-parse --git-dir", { stdio: "ignore", cwd: DIR });
    const branchName = execSync("git branch --show-current", { cwd: DIR, encoding: "utf8" }).trim();
    BRANCH = ` | 🌿 ${branchName}`;
  } catch (_) {
    /* not a git dir, or git unavailable — omit the branch segment */
  }

  const COST_FMT = `$${COST.toFixed(2)}`;
  const dirName = DIR.split("/").pop();

  process.stdout.write(`${CYAN}[${MODEL}]${RESET} 📁 ${dirName}${BRANCH}\n`);
  if (ADDED_DIRS) process.stdout.write(`  + ${ADDED_DIRS}\n`);
  process.stdout.write(
    `${BAR_COLOR}${BAR}${RESET} ${PCT}% | ${YELLOW}${COST_FMT}${RESET} | ⏱️  ${MINS}m ${SECS}s | 🕐 ${START_TIME} | ${IDLE_DISPLAY}\n`,
  );
  process.stdout.write(`${CACHE_DISPLAY}\n`);
}
