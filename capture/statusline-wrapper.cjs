#!/usr/bin/env node

// Statusline wrapper for machines that already have their own statusline.
// Captures cost via cost-logger.cjs, then delegates the same payload to the
// user's original statusline command and passes its output through untouched.
//
// The original command is stored by install.sh in statusline-original.json
// (same directory): { "command": "<their original statusLine.command>" }
//
// Cost capture must survive anything the original command does, so it runs
// first; display delegation failures fall back to a minimal cost line.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    require("./cost-logger.cjs").logCost(JSON.parse(input));
  } catch (_) {
    /* silent capture — never break the statusline */
  }

  let original = "";
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "statusline-original.json"), "utf8"),
    );
    original = cfg.command ?? "";
  } catch (_) {
    /* no stored original command — fall through to the minimal cost line */
  }

  if (original) {
    const res = spawnSync("/bin/sh", ["-c", original], { input, encoding: "utf8", timeout: 10000 });
    if (res.stdout) {
      process.stdout.write(res.stdout);
      return;
    }
  }

  // No original command (or it produced nothing) — minimal cost line
  try {
    const d = JSON.parse(input);
    const cost = d.cost?.total_cost_usd ?? 0;
    process.stdout.write(`[${d.model?.display_name ?? "?"}] $${cost.toFixed(2)}\n`);
  } catch (_) {
    /* nothing we can render */
  }
});
