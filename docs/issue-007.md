# Issue #7 — Move V1 app into legacy/

**Plan task:** #P0-2 · **Phase:** 0 · **PR(s):** #56 · **Closed:** 2026-07-07 · [GitHub issue #7](https://github.com/foyzulkarim/claude-lens/issues/7)

Moved the entire V1 app into `legacy/` so the repo root was clear for the V2 scaffold: `index.html`,
`server.js`, `llm-cache-cost.html`, `images/`, `README.md`, `CHANGELOG.md`, `suggestions.md`,
`.env.example`, `package.json`, `package-lock.json` — nothing code-related left at root. Repo-level
config (`.gitignore`, `CLAUDE.md`, `.github/`, `.serena/`, `.claude/`) stayed at root, plus a new root
`README.md` pointing to `legacy/`.

## Outcome

No V1 code or assets remained at root; root held only `specs/`, `legacy/`, and repo-level config.
V1 verified still booting from its new home (`node legacy/server.js`). Unblocked #P1-1 (fresh root
`package.json`).
