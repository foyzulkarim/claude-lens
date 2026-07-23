#!/usr/bin/env node

// Settings-merge engine invoked by install.sh. Node was chosen over jq /
// python3 / sed because install.sh already has to resolve a node binary to
// write the hook commands, so node is guaranteed present (see ARCH Tech
// Choices — "Settings merge engine").
//
// Contract (capture/install.sh, ARCH §API Contracts):
//   parse → merge → compare → backup → atomic write (settings.json.tmp + rename)
//
// Usage: node merge-settings.cjs <settingsPath> <scriptsDir> <nodeBin>
// Exit codes: 0 installed or already-configured; 1 unparseable settings.json
// or a write failure.

const fs = require("node:fs");
const path = require("node:path");

function statuslineStem(command) {
  const match = /statusline-(command|wrapper)/.exec(command);
  return match ? match[1] : null;
}

function turnLoggerAlreadyWired(stopEntries) {
  return stopEntries.some((entry) =>
    (entry.hooks ?? []).some(
      (hook) => typeof hook.command === "string" && hook.command.includes("turn-logger"),
    ),
  );
}

/**
 * Pure merge step: takes the parsed original settings object and returns
 * `{ merged, foreignStatuslineCommand }`. `foreignStatuslineCommand` is set
 * only when an existing, non-ours statusLine.command was found and must be
 * preserved in statusline-original.json. Exported so tests can exercise the
 * merge logic directly, without going through the CLI/filesystem.
 */
function mergeSettings(original, { scriptsDir, nodeBin }) {
  const merged = JSON.parse(JSON.stringify(original));
  let foreignStatuslineCommand = null;

  const existingCommand =
    merged.statusLine && typeof merged.statusLine.command === "string"
      ? merged.statusLine.command
      : null;

  if (existingCommand === null) {
    merged.statusLine = {
      type: "command",
      command: `${nodeBin} ${scriptsDir}/statusline-command.cjs`,
    };
  } else {
    const stem = statuslineStem(existingCommand);
    if (stem !== null) {
      // Already ours (any extension) — rewrite to the .cjs form if needed,
      // otherwise leave untouched so re-runs stay byte-identical (A4).
      const desired = `${nodeBin} ${scriptsDir}/statusline-${stem}.cjs`;
      if (existingCommand !== desired) {
        merged.statusLine = { ...merged.statusLine, command: desired };
      }
    } else {
      // Foreign statusline — preserve it via the wrapper.
      foreignStatuslineCommand = existingCommand;
      merged.statusLine = {
        type: "command",
        command: `${nodeBin} ${scriptsDir}/statusline-wrapper.cjs`,
      };
    }
  }

  merged.hooks = merged.hooks ?? {};
  const stopEntries = merged.hooks.Stop ?? [];
  if (!turnLoggerAlreadyWired(stopEntries)) {
    merged.hooks.Stop = [
      ...stopEntries,
      {
        matcher: "",
        hooks: [{ type: "command", command: `${nodeBin} ${scriptsDir}/turn-logger.cjs` }],
      },
    ];
  } else {
    merged.hooks.Stop = stopEntries;
  }

  return { merged, foreignStatuslineCommand };
}

function main() {
  const [, , settingsPath, scriptsDir, nodeBin] = process.argv;
  if (!settingsPath || !scriptsDir || !nodeBin) {
    console.error("usage: merge-settings.cjs <settingsPath> <scriptsDir> <nodeBin>");
    process.exit(1);
  }

  let original = {};
  let rawOriginal = "";
  if (fs.existsSync(settingsPath)) {
    rawOriginal = fs.readFileSync(settingsPath, "utf8");
    try {
      original = rawOriginal.trim() === "" ? {} : JSON.parse(rawOriginal);
    } catch (err) {
      console.error(`error: ${settingsPath} is not valid JSON: ${err.message}`);
      process.exit(1);
    }
  }

  const { merged, foreignStatuslineCommand } = mergeSettings(original, { scriptsDir, nodeBin });

  const originalSerialized = JSON.stringify(original);
  const mergedSerialized = JSON.stringify(merged);
  if (originalSerialized === mergedSerialized) {
    console.log("already configured");
    process.exit(0);
  }

  try {
    if (fs.existsSync(settingsPath)) {
      const backupPath = `${settingsPath}.backup-${Math.floor(Date.now() / 1000)}`;
      fs.copyFileSync(settingsPath, backupPath);
    }

    if (foreignStatuslineCommand !== null) {
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(
        path.join(scriptsDir, "statusline-original.json"),
        `${JSON.stringify({ command: foreignStatuslineCommand }, null, 2)}\n`,
      );
    }

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const tmpPath = `${settingsPath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`);
    fs.renameSync(tmpPath, settingsPath);
  } catch (err) {
    console.error(`error: failed to write ${settingsPath}: ${err.message}`);
    process.exit(1);
  }

  console.log("installed");
}

module.exports = { mergeSettings, statuslineStem, turnLoggerAlreadyWired };

if (require.main === module) {
  main();
}
