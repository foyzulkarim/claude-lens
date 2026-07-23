// Extracts the fields both statusline consumers need — cost-logger.cjs's
// capture path and statusline-command.cjs's render path — from the
// statusline JSON Claude Code writes to stdin. Kept in one place so the two
// don't drift on a field name or a default value.
function readStatuslinePayload(data) {
  return {
    model: data.model?.display_name ?? "",
    dir: data.workspace?.current_dir ?? "",
    cost: data.cost?.total_cost_usd ?? 0,
    pct: Math.floor(data.context_window?.used_percentage ?? 0),
    durationMs: data.cost?.total_duration_ms ?? 0,
    apiDurationMs: data.cost?.total_api_duration_ms ?? 0,
    sessionId: data.session_id ?? "",
    cacheRead: Number(data.context_window?.current_usage?.cache_read_input_tokens ?? 0),
    cacheWrite: Number(data.context_window?.current_usage?.cache_creation_input_tokens ?? 0),
    linesAdded: data.cost?.total_lines_added ?? 0,
    linesRemoved: data.cost?.total_lines_removed ?? 0,
  };
}

module.exports = { readStatuslinePayload };
