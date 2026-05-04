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

// GET /api/history — parse history.jsonl
app.get("/api/history", (req, res) => {
  try {
    const lines = fs
      .readFileSync(path.join(CLAUDE_DIR, "history.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim());
    const entries = lines.map((line) => {
      const obj = JSON.parse(line);
      return {
        display: obj.display,
        timestamp: obj.timestamp,
        project: obj.project,
        sessionId: obj.sessionId,
      };
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

    const projectDirs = fs
      .readdirSync(projectsDir)
      .filter((d) => fs.statSync(path.join(projectsDir, d)).isDirectory());

    for (const projDir of projectDirs) {
      const projPath = path.join(projectsDir, projDir);
      const jsonlFiles = findJsonlFiles(projPath);

      for (const file of jsonlFiles) {
        await parseJsonlForTools(file, projDir, toolCounts, toolsByProject);
      }
    }

    // Sort by count descending
    const sorted = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => ({ tool, count }));

    res.json({ tools: sorted, byProject: toolsByProject });
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
function parseJsonlForTools(filePath, projDir, toolCounts, toolsByProject) {
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
          if (item.type === "tool_use") {
            const tool = item.name;
            toolCounts[tool] = (toolCounts[tool] || 0) + 1;

            if (!toolsByProject[projDir]) toolsByProject[projDir] = {};
            toolsByProject[projDir][tool] =
              (toolsByProject[projDir][tool] || 0) + 1;
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
