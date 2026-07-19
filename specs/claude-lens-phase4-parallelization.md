# Claude Lens — Phase 4 Execution & Orchestration Plan

Single scheduling and execution companion to `specs/claude-lens-plan.md`. The plan owns product
scope, task definitions, and phase exit criteria; this document owns Phase 4 start gates, lane
selection, worktree execution, resume behavior, conflict control, and the optional
maximum-throughput mode.

> Nothing here changes product scope or acceptance criteria. Requirements still come from the
> plan, architecture, pages, and gates specs. The **default scheduler is conservative**: an issue
> waits for every page or service surface it must integrate with. Maximum-throughput relaxations
> are opt-in and never become the default merely because a lane is idle.

---

## Quick resume prompt

The user should be able to resume the phase with one sentence:

> Resume Phase 4 from `specs/claude-lens-phase4-parallelization.md`; reconstruct live state,
> perform all safe in-scope work, and ask me only for the next unavoidable user action.

Do not answer that prompt by drafting a new schedule. Reconstruct state, clear post-merge hygiene,
compute the ready queue, and follow the lifecycle in this document.

---

## 1. Authority and operating contract

Use sources in this order for different questions:

1. **What must ship:** `claude-lens-pages.md`, `gates.md`, `claude-lens-architecture.md`, then the
   matching task in `claude-lens-plan.md`. Page section tables beat HTML mockups.
2. **What one issue owns:** its filed GitHub body and local `specs/issues/` record.
3. **Whether an issue may start:** the conservative start-gate table in this document.
4. **Whether work is complete:** live GitHub PR/issue state plus required tests and sign-offs. A
   plan checkbox or local branch alone is never proof.

Default operating rules:

- Use **three concurrent lanes** after the serial spine. The user may request a different width,
  but the orchestrator must not ask them to choose one routinely.
- One issue = one short-lived branch = one worktree = one worker session = one PR.
- The primary checkout is the control plane. Keep it clean, on current `main`, and free of feature
  implementation.
- Derive state from GitHub + git on every resume. Do not maintain a hand-edited state file or rely
  on conversation memory.
- A successor starts only after every conservative predecessor is closed following a merged PR,
  not merely started, locally complete, or review-ready.
- #P4-18 runs last and alone. Phase 5 cannot start until it closes and Phase 4 hygiene is complete.

---

## 2. Why parallel execution is safe

The shared data platform was verified before Phase 4 began:

- `POST /api/metrics` is the common read-only analytics surface.
- `server/store/store.ts` exposes fleet and per-session reads.
- All 11 client routes already have separate page files and route stubs.
- Every page is primarily filter state + preset `MetricsQuery` values + layout.

Most Phase 4 tasks therefore do not contend on core data plumbing. The real coordination points
are page integration slots, config/gate plumbing, shared primitives, and the terminal E2E suite.

There are three dependency types:

| Dependency | Meaning | Default treatment |
|---|---|---|
| Functional/data | A later task imports code, consumes a route, or needs data created by an earlier task | Always wait for merge |
| Integration target | A later task replaces a page stub, column, badge, feed, or setting created by an earlier task | Wait by default; relax only in maximum-throughput mode |
| Reference order | The plan listed tasks sequentially, but neither task consumes the other | No start gate |

---

## 3. Authoritative conservative start-gate graph

`Depth` is the longest remaining issue path including the task itself. It is used by the ready
queue to protect the finish date. `Reservation` names shared surfaces that must not be edited by two
lanes concurrently unless their start-time plans prove the edits are isolated.

| Plan / GitHub | Start only after these issues close | Depth | Reservation | Status |
|---|---|---:|---|---|
| #P4-1 / #33 Primitives | #32 and #85 | 8 | solo | ✅ closed |
| #P4-19 / #84 Accessible charts | #33 | 7 | solo | ✅ closed |
| #P4-2 / #34 Dashboard | #84 | 6 | solo, Dashboard | ✅ closed |
| #P4-4 / #36 Sessions | #34 | 4 | Sessions | ✅ closed |
| #P4-5 / #37 Session Detail | #34 | 5 | Session Detail | ✅ closed |
| #P4-7 / #39 Projects | #34 | 3 | Projects | ⚪ open |
| #P4-8 / #40 Models | #34 | 4 | Models | ⚪ open |
| #P4-9 / #41 Cache Lab | #34 | 5 | Cache Lab | ✅ closed |
| #P4-10 / #42 Trends/Budget | #34 | 4 | Dashboard, config | ⚪ open |
| #P4-3 / #35 Search | #36 and #37 | 2 | Sessions | ⚪ open |
| #P4-6 / #38 Turn Inspector | #37 | 4 | Turn Inspector | 🟠 In progress (`feat/38/turn-inspector`) |
| #P4-11 / #43 Gates engine | #41 | 4 | gate/config plumbing | ⚪ open |
| #P4-12 / #44 Report Card UI | #36, #37, #38, #39, #42, and #43 | 2 | cross-page integration | ⚪ open |
| #P4-13 / #45 Premium upgrades | #36, #37, #38, #40, and #41 | 3 | cross-page integration | ⚪ open |
| #P4-14 / #46 Data Health | #45 | 2 | Data Health | ⚪ open |
| #P4-15 / #47 Settings | #36, #37, #42, and #43 | 3 | Sessions, config | ⚪ open |
| #P4-16 / #48 Explore | #47 | 2 | Dashboard | ⚪ open |
| #P4-17 / #49 Export | #36 | 2 | global export | ⚪ open |
| #P4-18 / #50 Cross-page E2E | every issue #35–#49 | 1 | solo terminal gate | ⚪ open |

`Status` reflects live GitHub state as of the §13 snapshot date — it is informational here; the orchestrator must still verify against §6 before opening a lane.

The integration waits are deliberate:

- #35 fills the search mount shipped by #36 and links into #37.
- #44 replaces gate stubs across Dashboard, Sessions, Session Detail, Projects, and Trends and
  validates evidence links through Turn Inspector.
- #45 verifies premium behavior across Sessions, Session Detail, Turn Inspector, Models, and Cache
  Lab.
- #47 makes tags filterable on Sessions, configures anomaly behavior used by Dashboard/Session
  Detail, and edits thresholds consumed by #43.

Premium C/B/L fixtures belong to #P4-13. The filed #P4-13 dependency text that calls them a
completed #P0-3 foundation is stale: #P0-3/P2-2 delivered the transcript fixture base. This
scheduling clarification does not mutate the filed issue body.

---

## 4. Default ready-queue scheduler

After applying start gates and reservations, choose work without asking the user:

1. Higher `Depth` first.
2. For equal depth, prefer the task with more not-yet-done descendants.
3. For a remaining tie, use the lower GitHub issue number.
4. Never consume the last free lane with lower-ranked work while a higher-ranked task is ready.

Precomputed priority pairs are `(depth, descendant count)`:

```text
#33 (8,18)  #84 (7,17)  #34 (6,16)
#37 (5,8)   #41 (5,7)
#36 (4,8)   #38 (4,4)   #42 (4,4)   #43 (4,4)   #40 (4,3)
#39 (3,2)   #45 (3,2)   #47 (3,2)
#35 (2,1)   #44 (2,1)   #46 (2,1)   #48 (2,1)   #49 (2,1)
#50 (1,0)
```

With three empty lanes immediately after #34 closes, the default scheduler starts **#37, #41,
and #36**. Recompute the queue whenever an issue merges; do not wait for a whole wave to finish.

### Shared-file reservations

- **Dashboard:** #34, #42, #44, #45, #48.
- **Sessions:** #36, #35, #44, #45, #47.
- **Session Detail:** #37, #44, #45.
- **Turn Inspector:** #38, #45.
- **Config/gate plumbing:** #42, #43, #47.
- **Shared primitives/charts:** #33 and #84 own the foundation. A later page that needs a new
  primitive lands it in a tiny prerequisite PR first.

Two in-flight issues must not hold the same reservation by default. The orchestrator may relax a
reservation without asking the user only when both start-time architecture/task plans identify
disjoint child modules and neither branch edits the same top-level page/config file. Record that
reason in the status update so a resumed agent can reconstruct the decision.

Where an issue contract expects downstream replacement, build a stable child-component integration
slot: search, gate feed, Report Card, gate columns, tags, tier upgrades, budget alert, and
saved-view pins. Later tasks should wire imports/data rather than rewrite large page components.

---

## 5. Optional maximum-throughput mode

This mode exists for a user explicitly optimizing wall-clock time and accepting more branch sync
and merge work. Do not enable it implicitly.

It relaxes only integration-target waits; functional/data dependencies remain hard:

| Issue | Conservative start | Maximum-throughput start | Added risk |
|---|---|---|---|
| #35 Search | #36 + #37 | #37 | Search may land before its Sessions mount exists |
| #44 Report Card | #36 + #37 + #38 + #39 + #42 + #43 | #43 | Several page targets may still be in flight |
| #45 Premium | #36 + #37 + #38 + #40 + #41 | #37 + #40 + #41 | Sessions/Turn Inspector validation may merge later |
| #47 Settings | #36 + #37 + #42 + #43 | #42 | Tags, anomaly consumers, or gate plumbing may still be in flight |

Under those relaxations, the theoretical graph is approximately seven stages:

| Stage | Tasks |
|---|---|
| 0 | #33 |
| 1 | #84 |
| 2 | #34 |
| 3 | #36, #37, #39, #40, #41, #42 |
| 4 | #35, #38, #43, #45, #47, #49 |
| 5 | #44, #46, #48 |
| 6 | #50 alone |

The theoretical initial fan-out is #41/#42/#37. This is a throughput ceiling, not the default
launch sequence. Before relaxing a gate, the orchestrator must verify the target branch can land a
self-contained component/API and state which later issue will perform integration.

---

## 6. Reconstruct live state on every orchestration turn

Never trust a stale snapshot or prior conversation status:

1. Re-read `AGENTS.md`, the Phase 4 plan section, this document, and relevant filed records.
2. Inspect primary with `git status --short --branch`, `git worktree list --porcelain`, and recent
   `main` history. Preserve unexplained user changes; never stash or discard them.
3. Fetch live GitHub state for #33–#50 and #84, plus open PRs whose head branches contain those
   issue numbers.
4. Classify each task:
   - **blocked** — a conservative predecessor is not closed;
   - **ready** — open, all predecessors closed, no active reservation conflict;
   - **in flight** — its worktree, branch, or open PR exists;
   - **merge-ready** — review/tests/sign-off complete and PR awaits merge;
   - **merged-dirty** — PR merged and issue closed, but cleanup remains;
   - **done** — issue closed, main updated, worktree removed, artifacts archived, checkbox correct.
5. Clear `merged-dirty` work before opening another lane.
6. Set `capacity = 3 - active lane count`, then fill only those slots from the ready queue.

If GitHub cannot be read, continue local read-only preparation but do not start a task whose gate
depends on unverified issue state.

---

## 7. Issue mapping and prerequisites

All Phase 4 issues are filed:

| Plan task | GitHub | Plan task | GitHub |
|---|---:|---|---:|
| #P4-1 | #33 | #P4-10 | #42 |
| #P4-2 | #34 | #P4-11 | #43 |
| #P4-3 | #35 | #P4-12 | #44 |
| #P4-4 | #36 | #P4-13 | #45 |
| #P4-5 | #37 | #P4-14 | #46 |
| #P4-6 | #38 | #P4-15 | #47 |
| #P4-7 | #39 | #P4-16 | #48 |
| #P4-8 | #40 | #P4-17 | #49 |
| #P4-9 | #41 | #P4-18 | #50 |
| #P4-19 | #84 | infrastructure | #85 |

Serial prerequisites before the fan-out:

1. #32 (#P3-5 Cypress harness) closed.
2. #85 parallel worktree/port infrastructure merged and closed.
3. #33 primitives merged.
4. #84 accessible chart boundary merged.
5. #34 Dashboard pattern-setter merged.

---

## 8. Worktree lane lifecycle

`/start-task` must run in the primary checkout. A worktree adopts its branch immediately afterward.

### Open

1. Confirm the issue is ready, a lane is free, reservations are clear, and primary is clean on
   current `main`.
2. Give the user one exact command: `/start-task <issue#>`. Do not ask which ready issue to start.
3. Immediately run project-local `/move-to-worktree` when available. It must:
   - verify a clean pushed task branch;
   - return primary to updated `main`;
   - create `.worktrees/<issue#>` (nested inside the repo root, never a `../`
     sibling — keeps every routine worktree-lifecycle command inside `$ROOT`);
   - write the issue-derived port block to `.env.local`;
   - run `npm ci` in the worktree.
4. Report the worktree path and exact next user-level skill for its worker session.

### Work

The worker session owns only its issue:

`/plan-architecture` → `/generate-tasks` → `/implement` → `/review` → `/commit`

These are user-level skills with `disable-model-invocation: true`; agents suggest them by exact
name and never simulate them. Requirements are already settled for plan tasks. Page issues include
their Cypress smoke, Storybook states, and real-data visual sign-off. The PR body carries
`Closes #N`.

### Merge and close

1. Confirm findings resolved, required tests green, `npm run verify` green, and visual sign-off
   present where required.
2. Present one compact checkpoint: PR, issue, evidence, sign-off, and unlocked successors.
3. After squash-merge closes the issue, run `/finish-worktree <issue#>` from primary.
4. Flip the plan checkbox only now, run `/archive-issue` promptly, and commit/push the hygiene.
5. Rebuild the live ready queue and fill the free lane.

### Per-lane port isolation

`CLAUDE_LENS_PORT_BASE` defaults to 4128:

- backend = base;
- Vite = base + 1;
- E2E = base + 2;
- Storybook = base + 3.

`/move-to-worktree` assigns `4128 + 10 × issue#`, so lanes never share ports. Vite uses
`strictPort: true`; collisions fail loudly. `CLAUDE_LENS_E2E_PORT` remains an explicit E2E
override. The CLI's runtime auto-bump remains for end users, but development lanes rely on unique
bases rather than auto-bumping.

---

## 9. Resume algorithm

```text
refresh live issues, PRs, main, worktrees, and local artifacts

if primary has unexplained changes:
    stop mutation; report exact paths and likely owner; never stash/discard

for each merged-dirty issue:
    finish worktree -> flip checkbox -> archive issue -> restore clean primary

active = issues with a worktree or open PR
capacity = 3 - active.count

ready = open issues
    whose conservative predecessors are closed
    whose reservations do not overlap active work

sort ready by:
    depth descending
    descendant count descending
    GitHub issue number ascending

while capacity > 0 and ready is not empty:
    nominate first ready issue
    request only the exact user-only skill invocation required to open it
    refresh after the branch moves to its worktree

if no issue is ready:
    report exact blocking issues/PRs; do not invent unplanned work

if #50 closes and hygiene is complete:
    declare Phase 4 complete; Phase 5 remains strictly serial
```

Every orchestration update contains four short items:

1. **State:** active lanes and merged-dirty cleanup.
2. **Ready now:** ordered issues with the selected next issue first.
3. **Blocked:** only blockers affecting the next unlock.
4. **User action:** one exact action, or “none” while agent-owned work continues.

---

## 10. Failure and recovery

- **Dirty primary/worktree:** stop destructive cleanup; identify paths and ownership.
- **Failed verify/test:** the owning worker fixes it in the same issue.
- **Predecessor merges after a lane starts:** merge current `origin/main` into the consuming lane;
  never rewrite shared history.
- **Merge conflict:** the later consumer resolves against the merged predecessor. Stop only that
  lane if the conflict reveals ambiguous ownership.
- **Review-blocked PR:** keep its reservations; fill only non-conflicting free lanes.
- **Closed issue without merged PR:** do not treat it as satisfying a gate; inspect closure reason.
- **Unavailable GitHub state:** never guess that an issue merged or closed.
- **Spec conflict:** specs win. If authoritative specs conflict with each other, request one user
  decision and record it in the plan decisions log.
- **New feature idea:** route it through the normal requirements/issue pipeline; do not add it to an
  active Phase 4 issue.

---

## 11. Minimal-intervention boundaries

The orchestrator should not ask the user:

- which ready issue to start;
- how many lanes to use normally;
- whether to run routine tests or read-only diagnostics;
- how to allocate ports or clean a successfully merged lane;
- whether to resolve a routine in-scope additive conflict.

Ask only at real authority boundaries:

- invoking a user-level skill;
- manual page visual acceptance;
- approving/performing an external merge or other GitHub mutation;
- choosing between conflicting product requirements;
- handling unexplained user changes or destructive cleanup.

This is not literally zero-touch because implementation skills are intentionally user-only and
page acceptance is intentionally manual. The target is deterministic, exact, and infrequent user
intervention.

---

## 12. Phase 5

Phase 5 is fully serial and gated behind #50:

`#P5-1 Performance → #P5-2 Package hygiene → #P5-3 Docs → #P5-4 Publish`

Do not parallelize it. Each task consumes the prior task's output.

---

## 13. Snapshot when consolidated

Informational only; always refresh using §6.

- 2026-07-19: The serial spine (#33 → #84 → #34) has fully landed. Closed since the
  2026-07-17 snapshot: #33, #84, #34, #36, #37, #41. Remaining open: #35, #38, #39, #40,
  #42, #43, #44, #45, #46, #47, #48, #49, #50. #38 is in flight on
  `feat/38/turn-inspector` (worktree `.worktrees/38`); the orchestrator should schedule
  the next wave from the §4 ready queue, not the serial spine.
- 2026-07-17: #32 and #85 are closed as completed.
- All Phase 4 task issues #33–#50 and #84 are open.
- The serial next issue is #33; #84 and then #34 follow.
- The #85 infrastructure is present on `main`. If #85's local filed record still exists, archive
  that closed issue before opening #33.
