---
title: "#P0-2 — Move V1 app into legacy/"
labels: phase-0
milestone: Phase 0 — Spec closure & repo prep
status: draft
---


Task **#P0-2** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase 0.

## Summary
Move the entire V1 app into `legacy/` so the repo root is clear for the V2 scaffold (#P1-1 starts a fresh root `package.json`). V1 must remain runnable from its new home.

## Scope
- Move **all V1 code and assets** into `legacy/`: `index.html`, `server.js`, `llm-cache-cost.html`, `images/`, `README.md`, `CHANGELOG.md`, `suggestions.md`, `.env.example`, `package.json`, `package-lock.json`. Nothing code-related stays at root.
- Leave repo-level config at root: `.gitignore`, `LICENSE` (from #P0-5), `.nvmrc` (from #P0-5), `CLAUDE.md`, `.github/`, `.serena/`, `.claude/`, and the new root `README.md` with a one-line pointer to `legacy/`.
- The new V2 app will be scaffolded in the root directory in later Phase 1 tasks.
- Verify V1 still boots: `node legacy/server.js`

## Acceptance criteria
- no V1 code or assets remain at root; root contains only `specs/`, `legacy/`, and repo-level config files
- V1 still boots from `legacy/` (`node legacy/server.js`)

## Dependencies
- Depends on: none — first implementation task in Phase 0 (#P0-1 was delivered as spec in PR #5)
- Unblocks: #P1-1 (fresh root `package.json` needs the root emptied)

## References
- Decisions log 2026-07-06: "V1 app moves to `legacy/`, stays runnable"
