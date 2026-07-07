Now I have a clear picture of the project. Here are my tailored recommendations:

---

## Claude Code Automation Recommendations

### Codebase Profile
- **Type**: Node.js (CommonJS)
- **Framework**: Express.js backend + vanilla HTML/CSS/JS frontend (single `index.html`)
- **Purpose**: CLI dashboard that reads `~/.claude` usage data and visualizes it
- **Key Libraries**: express, dotenv, nodemon
- **No tests, no linter, no TypeScript, no existing `.claude/` config**

---

### MCP Servers

#### 1. GitHub MCP
**Why**: This is a public OSS tool distributed via `npx`. A GitHub MCP server lets Claude manage issues, PRs, and releases directly — useful for a solo-maintained public repo where you handle issue triage during coding sessions.
**Install**: `claude mcp add github` (requires `gh` CLI authenticated)

#### 2. context7
**Why**: The project uses Express.js — context7 gives Claude live Express/Node.js docs so it doesn't rely on stale training data when helping with routing, middleware, or streaming responses.
**Install**: `claude mcp add context7`

---

### Skills

#### 1. `release-notes` (custom)
**Why**: The project is at v1.1.0 and distributed via `npx github:foyzulkarim/claude-lens`. A skill that drafts a changelog from `git log` since the last tag saves time before each version bump.
**Create**: `.claude/skills/release-notes/SKILL.md`
**Invocation**: User-only

```yaml
---
name: release-notes
description: Draft a changelog for the next version by summarizing git commits since the last tag
disable-model-invocation: true
---
Run: git log $(git describe --tags --abbrev=0)..HEAD --oneline
Summarize the commits into a short changelog grouped by type (feat, fix, chore).
Suggest the next semver bump and output a markdown-formatted release body.
```

#### 2. `add-widget` (custom)
**Why**: The dashboard is a single `index.html` (~787 lines) with multiple stat cards/panels. A skill that scaffolds a new widget (with matching API endpoint in `server.js` + frontend chart block) makes it easy to extend consistently.
**Create**: `.claude/skills/add-widget/SKILL.md`
**Invocation**: Both

---

### Hooks

#### 1. Block `.env` edits
**Why**: The `.env` file contains billing-sensitive token rate configs (`RATE_INPUT`, `RATE_OUTPUT`, etc.). A `PreToolUse` hook prevents accidental edits during a session.
**Where**: `.claude/settings.json`

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "if echo '$CLAUDE_TOOL_INPUT' | grep -q '\\.env\"'; then echo 'Blocked: .env edits require manual confirmation'; exit 1; fi"
      }]
    }]
  }
}
```

---

### Subagents

#### 1. `ui-reviewer`
**Why**: The entire frontend lives in one 787-line `index.html` with inline JavaScript and CSS. A UI reviewer subagent can check for accessibility issues, color contrast, and responsive layout regressions whenever the frontend changes significantly.
**Where**: `.claude/agents/ui-reviewer.md`

```markdown
---
name: ui-reviewer
description: Reviews index.html for accessibility (ARIA labels, contrast, keyboard nav) and layout consistency
---
You are a frontend quality reviewer. When given a diff or the full index.html, check for:
- Missing ARIA labels on interactive elements
- Color contrast issues
- Keyboard navigation gaps
- Responsive layout breakpoints
Report findings as a bullet list with severity (low/medium/high).
```

---

**Want more?** Ask for additional recommendations for any specific category — e.g., "show me more hooks ideas" or "what skills would help with dashboard development."

**Want help implementing any of these?** Just ask and I can set up any of the above in your project.
