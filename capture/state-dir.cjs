// Per-session scratch state (previous-tick counters, accumulated cache
// tokens, last-activity timestamp) lives under the user's own ~/.claude
// tree, not the shared, world-writable system tmpdir. Every other write this
// feature makes is scoped under the user's home directory — a predictable,
// session-id-keyed filename in a shared tmpdir is the one outlier, and on a
// multi-user machine a same-machine local user could plant a symlink at a
// guessed path ahead of time.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Defense in depth: session_id is CLI-internal (Claude Code's own stdin
// payload), not attacker-influenced today, but DIR already gets this
// treatment (mappedProjectDir) before being used in a path — sessionId
// should too, for the same reason and at the same cost.
function sanitizeSessionId(sessionId) {
  return path.basename(sessionId);
}

function stateFilePath(name, sessionId) {
  const dir = path.join(os.homedir(), ".claude", "scripts", ".state");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}-${sanitizeSessionId(sessionId)}`);
}

module.exports = { stateFilePath, sanitizeSessionId };
