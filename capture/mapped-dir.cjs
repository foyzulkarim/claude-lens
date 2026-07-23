// Matches Claude Code's own project-dir slug rule: slashes AND dots become
// dashes, underscores survive. Getting this wrong is silent — sidecar files
// are written successfully, just never inside the directory
// server/ingest/discovery.ts globs for. Shared by cost-logger.cjs and
// turn-logger.cjs so the rule has exactly one source of truth.
function mappedProjectDir(dir) {
  return dir.replace(/[/.]/g, "-");
}

module.exports = { mappedProjectDir };
