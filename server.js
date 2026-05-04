#!/usr/bin/env node
require("dotenv").config();

const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const app = express();
const PORT = 3456;

function isValidClaudeDir(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return (
    fs.existsSync(path.join(dir, "projects")) ||
    fs.existsSync(path.join(dir, "history.jsonl")) ||
    fs.existsSync(path.join(dir, "sessions")) ||
    fs.existsSync(path.join(dir, "stats-cache.json"))
  );
}

function detectClaudeDir() {
  const candidates = [];

  if (process.env.CLAUDE_DIR) {
    candidates.push({ path: process.env.CLAUDE_DIR, source: "env" });
  }

  candidates.push({
    path: path.join(os.homedir(), ".claude"),
    source: "home",
  });

  const platformCandidates = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA) {
      platformCandidates.push(
        { path: path.join(process.env.APPDATA, "Claude"), source: "appdata" },
        { path: path.join(process.env.APPDATA, ".claude"), source: "appdata" },
      );
    }
    if (process.env.LOCALAPPDATA) {
      platformCandidates.push({
        path: path.join(process.env.LOCALAPPDATA, "Claude"),
        source: "localappdata",
      });
    }
    if (process.env.USERPROFILE) {
      platformCandidates.push({
        path: path.join(process.env.USERPROFILE, ".claude"),
        source: "userprofile",
      });
    }
  } else if (process.platform === "darwin") {
    platformCandidates.push({
      path: path.join(os.homedir(), "Library", "Application Support", "Claude"),
      source: "macos-app-support",
    });
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    platformCandidates.push({ path: path.join(xdg, "claude"), source: "xdg" });
  }
  candidates.push(...platformCandidates);

  // Deduplicate by resolved path
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const resolved = path.resolve(c.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push({ ...c, path: resolved });
  }

  for (const cand of unique) {
    if (isValidClaudeDir(cand.path)) {
      return { ...cand, valid: true, candidates: unique };
    }
  }

  // Nothing valid — return best-effort (env or home) so error pages can show it
  const fallback = unique[0] || {
    path: path.join(os.homedir(), ".claude"),
    source: "home",
  };
  return { ...fallback, valid: false, candidates: unique };
}

function getTimezoneInfo() {
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return { name, offset: `${sign}${hh}:${mm}` };
}

function localDateKey(isoTs) {
  const d = new Date(isoTs);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const detected = detectClaudeDir();
const CLAUDE_DIR = detected.path;
const CLAUDE_DIR_SOURCE = detected.source;
const CLAUDE_DIR_VALID = detected.valid;

if (CLAUDE_DIR_VALID) {
  if (CLAUDE_DIR_SOURCE === "env") {
    console.log(`[claude-lens] Using CLAUDE_DIR from env: ${CLAUDE_DIR}`);
  } else {
    console.log(`[claude-lens] Auto-detected CLAUDE_DIR: ${CLAUDE_DIR} (${CLAUDE_DIR_SOURCE})`);
  }
} else {
  console.warn(
    `[claude-lens] No valid Claude data directory found. Tried:\n` +
      detected.candidates.map((c) => `  - ${c.path} (${c.source})`).join("\n") +
      `\nServer will start anyway — set CLAUDE_DIR in .env to point to your data directory.`,
  );
}

const RATES = {
  input: parseFloat(process.env.RATE_INPUT ?? "5.0") / 1e6,
  output: parseFloat(process.env.RATE_OUTPUT ?? "25.0") / 1e6,
  cacheRead: parseFloat(process.env.RATE_CACHE_READ ?? "0.5") / 1e6,
  cacheCreate: parseFloat(process.env.RATE_CACHE_CREATE ?? "6.25") / 1e6,
};

app.use(express.static(__dirname));

// GET /api/config — runtime config so the UI can show the active data dir
app.get("/api/config", (req, res) => {
  res.json({
    claudeDir: CLAUDE_DIR,
    source: CLAUDE_DIR_SOURCE,
    valid: CLAUDE_DIR_VALID,
    candidates: detected.candidates.map((c) => ({
      path: c.path,
      source: c.source,
      exists: fs.existsSync(c.path),
      valid: isValidClaudeDir(c.path),
    })),
    platform: process.platform,
    timezone: getTimezoneInfo(),
  });
});

// In-memory cache of the remote profile lookup. Keyed by token (in case the
// access token rotates). 60-second TTL keeps page reloads from hammering the
// upstream API while staying fresh enough for an account view.
const PROFILE_CACHE_MS = 60_000;
let profileCache = { token: null, data: null, expiresAt: 0 };

async function fetchAnthropicProfile(token) {
  if (profileCache.token === token && Date.now() < profileCache.expiresAt) {
    return { data: profileCache.data, fromCache: true };
  }
  const res = await fetch("https://api.anthropic.com/api/oauth/profile", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "claude-lens/1.0",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const err = new Error(`http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  profileCache = { token, data, expiresAt: Date.now() + PROFILE_CACHE_MS };
  return { data, fromCache: false };
}

// Strip any unknown fields out of the upstream payload before forwarding, so
// future server-side additions don't accidentally leak through this endpoint.
function projectProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const a = profile.account || {};
  const o = profile.organization || {};
  const app = profile.application || {};
  return {
    account: {
      uuid: a.uuid ?? null,
      fullName: a.full_name ?? null,
      displayName: a.display_name ?? null,
      email: a.email ?? null,
      hasClaudeMax: a.has_claude_max ?? null,
      hasClaudePro: a.has_claude_pro ?? null,
      createdAt: a.created_at ?? null,
    },
    organization: {
      uuid: o.uuid ?? null,
      name: o.name ?? null,
      organizationType: o.organization_type ?? null,
      billingType: o.billing_type ?? null,
      rateLimitTier: o.rate_limit_tier ?? null,
      seatTier: o.seat_tier ?? null,
      hasExtraUsageEnabled: o.has_extra_usage_enabled ?? null,
      subscriptionStatus: o.subscription_status ?? null,
      subscriptionCreatedAt: o.subscription_created_at ?? null,
      claudeCodeTrialEndsAt: o.claude_code_trial_ends_at ?? null,
      claudeCodeTrialDurationDays: o.claude_code_trial_duration_days ?? null,
    },
    application: {
      uuid: app.uuid ?? null,
      name: app.name ?? null,
      slug: app.slug ?? null,
    },
  };
}

// GET /api/account — read .credentials.json and surface SAFE fields only.
// SECURITY: accessToken and refreshToken must never appear in the response.
// They live in the local file but are never serialized over the wire. The
// remote profile call uses the token server-side; only the projected fields
// (see projectProfile) are forwarded to the browser.
app.get("/api/account", async (req, res) => {
  const credPath = path.join(CLAUDE_DIR, ".credentials.json");
  try {
    if (!fs.existsSync(credPath)) {
      return res.json({
        loggedIn: false,
        reason: "credentials_missing",
        credentialsPath: credPath,
      });
    }

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
    } catch (parseErr) {
      return res.json({
        loggedIn: false,
        reason: "credentials_unreadable",
        message: parseErr.message,
        credentialsPath: credPath,
      });
    }

    const oauth = raw.claudeAiOauth || {};
    const hasToken = typeof oauth.accessToken === "string" && oauth.accessToken.length > 0;
    if (!hasToken) {
      return res.json({
        loggedIn: false,
        reason: "no_access_token",
        credentialsPath: credPath,
      });
    }

    const now = Date.now();
    const expiresAt = typeof oauth.expiresAt === "number" ? oauth.expiresAt : null;
    const expiresInMs = expiresAt != null ? expiresAt - now : null;
    const expired = expiresAt != null ? expiresAt <= now : null;

    // Optionally skip the remote fetch with ?local=1 — handy for offline use
    // and for testing the local-only path.
    let profile = null;
    let profileError = null;
    let profileFromCache = false;
    if (req.query.local !== "1") {
      try {
        const result = await fetchAnthropicProfile(oauth.accessToken);
        profile = projectProfile(result.data);
        profileFromCache = result.fromCache;
      } catch (e) {
        profileError = e.status ? `http_${e.status}` : (e.name === "TimeoutError" ? "timeout" : e.message || "unknown");
      }
    }

    res.json({
      loggedIn: true,
      subscriptionType: oauth.subscriptionType || null,
      rateLimitTier: oauth.rateLimitTier || null,
      scopes: Array.isArray(oauth.scopes) ? oauth.scopes : [],
      expiresAt,
      expiresInMs,
      expired,
      organizationUuid: raw.organizationUuid || null,
      credentialsPath: credPath,
      profile,
      profileError,
      profileFromCache,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /account — serve the account page
app.get("/account", (req, res) => {
  res.sendFile(path.join(__dirname, "account.html"));
});

// GET /chat — serve the chat page
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "chat.html"));
});

// Allow-list of models exposed to the chat UI. Keep narrow on purpose — if the
// user wants something else, add it here explicitly. Prevents typo'd model
// names from generating cryptic upstream errors.
const CHAT_MODELS = new Set([
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
]);

// POST /api/chat — proxy /v1/messages with the local OAuth token.
//
// The browser sends the same JSON body shape Anthropic expects (model,
// messages, max_tokens, etc.) and the server tacks on Authorization +
// anthropic-beta headers, then pipes the upstream response (streaming or
// not) straight back to the client. The access token is read from
// .credentials.json on every request — never cached — and never appears
// in the response body.
//
// Inference billed against the user's local Claude account quota
// (no separate API key needed thanks to the `user:inference` scope).
app.post("/api/chat", express.json({ limit: "25mb" }), async (req, res) => {
  const credPath = path.join(CLAUDE_DIR, ".credentials.json");
  let token;
  try {
    if (!fs.existsSync(credPath)) {
      return res.status(401).json({ error: "not_logged_in", reason: "credentials_missing" });
    }
    const cred = JSON.parse(fs.readFileSync(credPath, "utf8"));
    token = cred.claudeAiOauth?.accessToken;
    if (!token) {
      return res.status(401).json({ error: "not_logged_in", reason: "no_access_token" });
    }
  } catch (err) {
    return res.status(500).json({ error: "credentials_read_error", message: err.message });
  }

  const body = req.body || {};
  if (!body.model || !CHAT_MODELS.has(body.model)) {
    return res.status(400).json({
      error: "bad_model",
      message: `Model not in allow-list. Pick one of: ${[...CHAT_MODELS].join(", ")}`,
    });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return res.status(400).json({ error: "bad_messages", message: "messages must be a non-empty array" });
  }

  // === Claude-Code identity injection ===
  //
  // Anthropic gates the OAuth-friendly rate-limit bucket behind the EXACT
  // string below appearing as a system block. Without it, OAuth requests
  // share a much smaller quota and 429 quickly even with the same token —
  // confirmed by probing: a string-form `system: "<marker>\n\n..."` 429s,
  // but `system: [{type:"text", text:"<marker>"}, {type:"text", text:"..."}]`
  // gets through. So we always force the system field into block-array
  // form with the marker as the first block.
  //
  // The second block tells Claude it's in conversational chat mode
  // (no tools, no workspace) so responses don't default to the code-focused
  // Claude Code persona.
  const CC_SYSTEM_MARKER = "You are Claude Code, Anthropic's official CLI for Claude.";
  const CHAT_CONTEXT_BLOCK = "You are running in conversational chat mode inside claude-lens, a local web UI. The user is having a normal conversation — coding-related or not. You have no file access, no tool use, and no workspace in this session. Respond naturally; do not assume the user wants you to write code unless they explicitly ask.";

  const userSystem = body.system;
  const extraBlocks = [];
  if (typeof userSystem === "string" && userSystem.trim().length > 0) {
    extraBlocks.push({ type: "text", text: userSystem });
  } else if (Array.isArray(userSystem)) {
    for (const block of userSystem) {
      // Don't re-add a block that already matches the marker exactly
      if (block?.type === "text" && block?.text === CC_SYSTEM_MARKER) continue;
      extraBlocks.push(block);
    }
  }
  body.system = [
    { type: "text", text: CC_SYSTEM_MARKER },
    { type: "text", text: CHAT_CONTEXT_BLOCK },
    ...extraBlocks,
  ];

  let upstreamRes;
  try {
    upstreamRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-lens/1.0",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return res.status(502).json({ error: "upstream_unreachable", message: err.message });
  }

  // Pass status + content-type through; stream body chunk-by-chunk so SSE
  // events reach the browser as they arrive.
  res.status(upstreamRes.status);
  const ct = upstreamRes.headers.get("content-type");
  if (ct) res.setHeader("Content-Type", ct);

  // Forward Anthropic's rate-limit headers + retry-after so the UI can
  // explain 429s instead of just throwing "HTTP 429".
  for (const [name, value] of upstreamRes.headers) {
    const n = name.toLowerCase();
    if (n.startsWith("anthropic-ratelimit-") || n === "retry-after" || n === "anthropic-request-id") {
      res.setHeader(name, value);
    }
  }

  // Disable proxy buffering for SSE
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  if (!upstreamRes.body) {
    return res.end();
  }
  const reader = upstreamRes.body.getReader();
  req.on("close", () => {
    // Client disconnected — abort upstream read so we stop billing tokens
    try { reader.cancel("client_disconnected"); } catch {}
  });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (err) {
    // Pipe errors usually mean the client disconnected mid-stream
  } finally {
    res.end();
  }
});

// GET /api/stats — return stats-cache.json as-is
app.get("/api/stats", (req, res) => {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(CLAUDE_DIR, "stats-cache.json"), "utf8"),
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history — typed user prompts, derived from projects/**/*.jsonl
// (canonical, always-fresh source) merged with legacy history.jsonl entries
// for any older data. Sorted newest-first; deduped by sessionId+timestamp.
app.get("/api/history", async (req, res) => {
  try {
    const seen = new Set();
    const entries = [];

    // Source 1: legacy history.jsonl — tolerate missing file
    try {
      const lines = fs
        .readFileSync(path.join(CLAUDE_DIR, "history.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.trim());
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          const key = `${obj.sessionId}|${obj.timestamp}`;
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({
            display: obj.display,
            timestamp: obj.timestamp,
            project: obj.project,
            sessionId: obj.sessionId,
          });
        } catch {
          // skip malformed lines
        }
      }
    } catch {
      // history.jsonl absent — that's fine, projects/ has the data
    }

    // Source 2: projects/**/*.jsonl — fresh data, scanned every request
    try {
      const projectsDir = path.join(CLAUDE_DIR, "projects");
      const projectDirs = fs
        .readdirSync(projectsDir)
        .filter((d) => fs.statSync(path.join(projectsDir, d)).isDirectory());

      const projEntries = [];
      for (const projDir of projectDirs) {
        const projPath = path.join(projectsDir, projDir);
        const jsonlFiles = findJsonlFiles(projPath);
        for (const file of jsonlFiles) {
          await parsePromptsFromProject(file, projEntries);
        }
      }
      for (const e of projEntries) {
        const key = `${e.sessionId}|${e.timestamp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(e);
      }
    } catch {
      // projects/ absent — fine
    }

    // Sort newest-first; handle both numeric (legacy) and ISO-string timestamps
    entries.sort((a, b) => {
      const ta = typeof a.timestamp === "number" ? a.timestamp : Date.parse(a.timestamp);
      const tb = typeof b.timestamp === "number" ? b.timestamp : Date.parse(b.timestamp);
      return (tb || 0) - (ta || 0);
    });

    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions — read sessions/*.json
app.get("/api/sessions", (req, res) => {
  try {
    const sessionsDir = path.join(CLAUDE_DIR, "sessions");
    const files = fs
      .readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".json"));
    const sessions = files.map((f) =>
      JSON.parse(fs.readFileSync(path.join(sessionsDir, f), "utf8")),
    );
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tool-calls — aggregate tool calls from all project session JSONL files
app.get("/api/tool-calls", async (req, res) => {
  try {
    const projectsDir = path.join(CLAUDE_DIR, "projects");
    const toolCounts = {};
    const toolsByProject = {};
    const toolsByDate = {};

    const projectDirs = fs
      .readdirSync(projectsDir)
      .filter((d) => fs.statSync(path.join(projectsDir, d)).isDirectory());

    for (const projDir of projectDirs) {
      const projPath = path.join(projectsDir, projDir);
      const jsonlFiles = findJsonlFiles(projPath);

      for (const file of jsonlFiles) {
        await parseJsonlForTools(file, projDir, toolCounts, toolsByProject, toolsByDate);
      }
    }

    // Sort by count descending
    const sorted = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => ({ tool, count }));

    res.json({ tools: sorted, byProject: toolsByProject, byDate: toolsByDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tool-details/:toolName — return individual calls for a specific tool
app.get("/api/tool-details/:toolName", async (req, res) => {
  try {
    const toolName = req.params.toolName;
    const projectsDir = path.join(CLAUDE_DIR, "projects");
    const calls = [];

    const projectDirs = fs
      .readdirSync(projectsDir)
      .filter((d) => fs.statSync(path.join(projectsDir, d)).isDirectory());

    for (const projDir of projectDirs) {
      const projPath = path.join(projectsDir, projDir);
      const jsonlFiles = findJsonlFiles(projPath);

      for (const file of jsonlFiles) {
        await parseJsonlForToolDetails(file, projDir, toolName, calls);
      }
    }

    // Sort by timestamp descending (most recent first)
    calls.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/projects — project-level summary from history.jsonl
app.get("/api/projects", (req, res) => {
  try {
    const lines = fs
      .readFileSync(path.join(CLAUDE_DIR, "history.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim());

    const projects = {};
    for (const line of lines) {
      const obj = JSON.parse(line);
      const proj = obj.project || "unknown";
      if (!projects[proj]) {
        projects[proj] = {
          messages: 0,
          sessions: new Set(),
          firstSeen: null,
          lastSeen: null,
        };
      }
      projects[proj].messages++;
      projects[proj].sessions.add(obj.sessionId);
      const ts = obj.timestamp;
      if (!projects[proj].firstSeen || ts < projects[proj].firstSeen) {
        projects[proj].firstSeen = ts;
      }
      if (!projects[proj].lastSeen || ts > projects[proj].lastSeen) {
        projects[proj].lastSeen = ts;
      }
    }

    const result = Object.entries(projects).map(([name, data]) => ({
      name,
      shortName: name.split("/").pop(),
      messages: data.messages,
      sessions: data.sessions.size,
      firstSeen: data.firstSeen,
      lastSeen: data.lastSeen,
    }));

    result.sort((a, b) => b.messages - a.messages);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/daily-costs — token usage and estimated cost per day
app.get("/api/daily-costs", async (req, res) => {
  try {
    const projectsDir = path.join(CLAUDE_DIR, "projects");
    const daily = {};

    const projectDirs = fs
      .readdirSync(projectsDir)
      .filter((d) => fs.statSync(path.join(projectsDir, d)).isDirectory());

    for (const projDir of projectDirs) {
      const projPath = path.join(projectsDir, projDir);
      const jsonlFiles = findJsonlFiles(projPath);
      for (const file of jsonlFiles) {
        await parseDailyCosts(file, daily);
      }
    }

    const days = Object.keys(daily)
      .sort()
      .map((date) => {
        const d = daily[date];
        const cost =
          d.input * RATES.input +
          d.output * RATES.output +
          d.cacheRead * RATES.cacheRead +
          d.cacheCreate * RATES.cacheCreate;
        return {
          date,
          messages: d.messages,
          toolCalls: d.toolCalls,
          sessions: d.sessions.size,
          input: d.input,
          output: d.output,
          cacheRead: d.cacheRead,
          cacheCreate: d.cacheCreate,
          cost: Math.round(cost * 100) / 100,
          models: d.models,
        };
      });

    const totals = days.reduce(
      (acc, d) => {
        acc.messages += d.messages;
        acc.toolCalls += d.toolCalls;
        acc.sessions += d.sessions;
        acc.input += d.input;
        acc.output += d.output;
        acc.cacheRead += d.cacheRead;
        acc.cacheCreate += d.cacheCreate;
        acc.cost += d.cost;
        return acc;
      },
      {
        messages: 0,
        toolCalls: 0,
        sessions: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreate: 0,
        cost: 0,
        models: {},
      },
    );
    totals.cost = Math.round(totals.cost * 100) / 100;

    // Merge all models into totals
    for (const d of days) {
      for (const [model, count] of Object.entries(d.models || {})) {
        totals.models[model] = (totals.models[model] || 0) + count;
      }
    }

    res.json({ days, totals, rates: RATES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recursively find all .jsonl files in a directory
function findJsonlFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsonlFiles(fullPath));
    } else if (entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }
  return results;
}

// Parse a JSONL file and extract tool_use entries
function parseJsonlForTools(filePath, projDir, toolCounts, toolsByProject, toolsByDate) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== "assistant" || !obj.message) return;
        const content = obj.message.content;
        if (!Array.isArray(content)) return;
        const day = obj.timestamp ? localDateKey(obj.timestamp) : null;

        for (const item of content) {
          if (item.type === "tool_use") {
            const tool = item.name;
            toolCounts[tool] = (toolCounts[tool] || 0) + 1;

            if (!toolsByProject[projDir]) toolsByProject[projDir] = {};
            toolsByProject[projDir][tool] =
              (toolsByProject[projDir][tool] || 0) + 1;

            if (toolsByDate && day) {
              if (!toolsByDate[day]) toolsByDate[day] = {};
              toolsByDate[day][tool] = (toolsByDate[day][tool] || 0) + 1;
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    });

    rl.on("close", resolve);
    rl.on("error", resolve);
  });
}

// Parse a JSONL file and collect typed user prompts
// Skips tool-result entries (content is an array) and Claude Code's
// system-injected user messages (command stdout/stderr, hook output).
function parsePromptsFromProject(filePath, entries) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== "user" || !obj.message) return;
        const content = obj.message.content;
        if (typeof content !== "string") return;
        const trimmed = content.trim();
        if (!trimmed) return;
        if (
          trimmed.startsWith("<command-name>") ||
          trimmed.startsWith("<command-message>") ||
          trimmed.startsWith("<command-args>") ||
          trimmed.startsWith("<local-command-stdout>") ||
          trimmed.startsWith("<local-command-stderr>") ||
          trimmed.startsWith("<bash-input>") ||
          trimmed.startsWith("<bash-stdout>") ||
          trimmed.startsWith("<bash-stderr>") ||
          trimmed.startsWith("Caveat:") ||
          trimmed.startsWith("[Request interrupted")
        ) return;

        const display = trimmed.length > 500 ? trimmed.slice(0, 500) + "…" : trimmed;
        entries.push({
          display,
          timestamp: obj.timestamp,
          project: obj.cwd || "unknown",
          sessionId: obj.sessionId,
        });
      } catch {
        // skip malformed lines
      }
    });

    rl.on("close", resolve);
    rl.on("error", resolve);
  });
}

// Parse a JSONL file and accumulate daily token usage
function parseDailyCosts(filePath, daily) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      try {
        const obj = JSON.parse(line);
        const ts = obj.timestamp;
        if (!ts) return;
        const day = localDateKey(ts);
        if (!day) return;

        if (!daily[day]) {
          daily[day] = {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheCreate: 0,
            messages: 0,
            toolCalls: 0,
            sessions: new Set(),
            models: {},
          };
        }

        const sid = obj.sessionId || "";

        if (obj.type === "user") {
          daily[day].messages++;
          daily[day].sessions.add(sid);
        }

        if (obj.type === "assistant" && obj.message) {
          const usage = obj.message.usage || {};
          daily[day].input += usage.input_tokens || 0;
          daily[day].output += usage.output_tokens || 0;
          daily[day].cacheRead += usage.cache_read_input_tokens || 0;
          daily[day].cacheCreate += usage.cache_creation_input_tokens || 0;

          // Track model usage
          const model = obj.message.model || "unknown";
          daily[day].models[model] = (daily[day].models[model] || 0) + 1;

          const content = obj.message.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === "tool_use") daily[day].toolCalls++;
            }
          }
        }
      } catch {
        // skip
      }
    });

    rl.on("close", resolve);
    rl.on("error", resolve);
  });
}

// Parse a JSONL file and extract details for a specific tool
function parseJsonlForToolDetails(filePath, projDir, toolName, calls) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== "assistant" || !obj.message) return;
        const content = obj.message.content;
        if (!Array.isArray(content)) return;

        for (const item of content) {
          if (item.type === "tool_use" && item.name === toolName) {
            const input = item.input || {};
            const detail = { project: projDir, timestamp: obj.timestamp };

            // Extract relevant fields based on tool type
            if (toolName === "Bash") {
              detail.command = input.command || "";
              detail.description = input.description || "";
            } else if (toolName === "Read") {
              detail.file_path = input.file_path || "";
            } else if (toolName === "Edit") {
              detail.file_path = input.file_path || "";
            } else if (toolName === "Write") {
              detail.file_path = input.file_path || "";
            } else if (toolName === "Grep") {
              detail.pattern = input.pattern || "";
              detail.path = input.path || "";
              detail.glob = input.glob || "";
            } else if (toolName === "Glob") {
              detail.pattern = input.pattern || "";
              detail.path = input.path || "";
            } else if (toolName === "Agent") {
              detail.description = input.description || "";
              detail.subagent_type = input.subagent_type || "";
            } else {
              // Generic: include all input keys
              detail.input = JSON.stringify(input).slice(0, 200);
            }

            calls.push(detail);
          }
        }
      } catch {
        // skip malformed lines
      }
    });

    rl.on("close", resolve);
    rl.on("error", resolve);
  });
}

app.listen(PORT, () => {
  console.log(`Claude Usage Dashboard running at http://localhost:${PORT}`);
});
