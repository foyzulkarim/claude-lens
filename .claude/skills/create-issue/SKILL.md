---
name: create-issue
model: inherit
description: File GitHub issues for the claude-lens project with the right shape for the work type — plan tasks from specs/claude-lens-plan.md, Phase 4 page tasks, spikes, bugs, enhancements, chores. Use this whenever the user asks to create/file/open an issue, turn a plan task (e.g. "#P2-3") into an issue, scaffold issues for a phase, log a bug, or propose a spike/investigation — even if they don't say the word "issue" (e.g. "let's get P1 into GitHub", "track this as a task").
---

# Create Issue

Issues in this repo come in different shapes because the work does: a plan task carries acceptance criteria written months in advance; a bug carries a repro; a spike carries a question and a timebox. One rigid template can't serve all of these, so this skill generates the right body per type and files it with `gh issue create`.

The specs are the source of truth. Never invent scope or acceptance criteria — pull them from the docs, and if a plan task is missing something, flag the gap to the user instead of papering over it.

## Step 1 — Classify the request

| Type | Signals |
|---|---|
| **plan-task** | A task ID like `#P2-3`, or "file the Phase 1 issues" — anything that maps to a checkbox in `specs/claude-lens-plan.md` |
| **page** | A plan-task that is one of the 11 Phase 4 page tasks (#P4-2, 4–10, 14–16). Same as plan-task plus extra page-specific content (see Step 2) |
| **spike** | Open question, investigation, "figure out whether…", timeboxed research. Not in the plan doc |
| **bug** | Something built is behaving wrongly |
| **enhancement** | New feature/improvement idea that is *not* in the plan doc. If it belongs in the plan, suggest adding it there first — the plan is the backlog of record |
| **chore** | Repo/tooling/docs upkeep with no user-facing behavior |

If the request maps to several plan tasks (e.g. a whole phase), file one issue per task, sequentially in plan order.

## Step 2 — Source the content

**plan-task / page:** Read the task's entry in `specs/claude-lens-plan.md` — the task body is the scope, and the *Acceptance:* line must be copied **verbatim** into the issue (plan-doc rule). Follow the task's spec references before writing the body:

- architecture §N → `specs/claude-lens-architecture.md`
- pages §N → `specs/claude-lens-pages.md`
- gates → `specs/gates.md`
- mockups → `specs/pages/<page>.html`

Derive **Depends on / Unblocks** from plan order: phases 0–3 are strictly sequential; within Phase 4 the plan's ordering notes apply. Reference dependencies by task ID — don't hit GitHub during drafting; if a dependency was already filed, its issue number is in its own draft's frontmatter under `specs/issues/`.

**page (extra):** The issue must also carry:
- The binding section list from the page's table in `claude-lens-pages.md` (spec wins over mockup).
- The mockup path (`specs/pages/X.html`) as *visual reference, not exhaustive contract*.
- Any of the six known spec-vs-mockup gaps that affect this page (listed in the plan's Phase 4 standing rules) — implement from the spec table.
- The three standing rules as a Definition of Done: Cypress smoke spec (render + one drill-link), Storybook for component states, manual mockup sign-off on real data.

**spike / bug / enhancement / chore:** Content comes from the conversation. Before filing, make sure you have: for a bug, a repro and expected-vs-actual; for a spike, the question, why it matters now, and a timebox/exit criterion. If these are missing, ask — a bug without a repro or a spike without an exit criterion is not worth filing.

**enhancement, when it's more than a one-liner:** first check `specs/requirements/` for a REQ doc covering it. If one exists, source the issue from it exactly as plan tasks are sourced from the plan doc — summary from its problem statement, acceptance criteria copied verbatim, REQ path linked under References. If none exists and the scope is fuzzy (multiple behaviors, unstated edge cases, no verifiable done-signal), pause and suggest the user run `/plan-requirements` first — it's their user-invocable interview skill (you cannot invoke it yourself) and produces the REQ doc this issue should be derived from. Only file straight from conversation when the enhancement is small enough that its acceptance line is obvious. This keeps one rule across all issue types: issues cite a requirements source; they never invent one.

## Step 3 — Title, labels, milestone

| Type | Title | Labels | Milestone |
|---|---|---|---|
| plan-task / page | `#P<phase>-<n> — <task title from plan>` | `phase-<N>` | `Phase <N> — <name>` |
| spike | `spike: <question in one line>` | `spike` + `phase-<N>` if it blocks a phase | phase milestone if applicable |
| bug | `bug: <symptom>` | `bug` + `phase-<N>` of the affected area | current phase |
| enhancement | `feat: <capability>` | `enhancement` | usually none until planned |
| chore | `chore: <what>` | `documentation`/none as fits | usually none |

Phase labels (`phase-0`…`phase-5`) and the six phase milestones already exist. The `spike` label may not — create it on first use: `gh label create spike --description "Timeboxed investigation" --color 1d76db`.

## Step 4 — Body shapes

Shapes below; drop sections that would be empty rather than leaving placeholders. Reference dependencies by task ID — GitHub issue numbers usually don't exist yet at drafting time (a filed dependency's number is in its own draft's frontmatter if you need it).

**plan-task / page**

```markdown
Task **#P<X>-<Y>** from [specs/claude-lens-plan.md](../blob/main/specs/claude-lens-plan.md) — Phase <X>.

## Summary
<one or two sentences: what this delivers and why it's in this phase>

## Scope
<bullets pulled from the task body; spec section refs inline, e.g. "per architecture §4">

## Acceptance criteria
<the plan doc's *Acceptance:* line, verbatim, as bullets>

## Dependencies
- Depends on: <task IDs / #issue numbers, or "none — first in phase">
- Unblocks: <next task(s)>

## References
<spec sections, mockup path, decisions-log rows that constrain this task>
```

For **page** tasks, add between Acceptance and Dependencies:

```markdown
## Page contract (pages spec §<N>)
<the section table rows: section → data dep → tier behavior → drill target>
Spec-vs-mockup gaps to implement from the spec table: <the relevant items, or "none for this page">

## Definition of done (Phase 4 standing rules)
- [ ] Cypress smoke spec: route renders key sections from fixtures; one drill-link lands filtered
- [ ] Component states covered in Storybook (not Cypress)
- [ ] Manual visual sign-off vs `specs/pages/<page>.html` on real data; plan checkbox flipped
```

**spike**

```markdown
## Question
<the single question this spike answers>

## Why now
<what decision or task is blocked on the answer>

## Approach
<how to investigate — prototype, measurement, reading; keep it cheap>

## Timebox & exit criterion
<e.g. "1 day; exits with a decisions-log row + recommendation, regardless of outcome">
```

**bug**

```markdown
## Symptom
<what happens, where — page/route/module>

## Repro
<numbered steps, or the fixture/data that triggers it>

## Expected vs actual
<one line each>

## Suspected area
<file/module if known; omit if not>
```

**enhancement / chore**

```markdown
## What & why
<the capability or upkeep, and the motivation>

## Acceptance
<how we'll know it's done — verifiable, in the spirit of the plan doc's acceptance lines;
copied verbatim from the REQ doc when one exists>

## References
<`specs/requirements/REQ-<slug>.md` if the issue was derived from one>
```

## Step 5 — Draft locally (never file directly)

Issues are **drafted as local files first** so the user can edit them until happy, then published to GitHub in one batch — not one HTTP round-trip per revision. Write each draft to `specs/issues/<ID>-<slug>.md` (e.g. `P0-2-move-v1-into-legacy.md`; for ad-hoc types use `bug-<slug>.md`, `spike-<slug>.md`, …):

```markdown
---
title: "#P0-2 — Move V1 app into legacy/"
labels: phase-0
milestone: Phase 0 — Spec closure & repo prep
status: draft
---

<issue body per Step 4>
```

Frontmatter rules: `labels` comma-separated; omit `milestone` if none; `status` is the lifecycle:

- `draft` — being edited. The user owns drafts once written: before regenerating or updating one, re-read it — their manual edits must survive, so never overwrite except on their explicit ask.
- `ready` — user has approved it for publishing. Flip drafts to `ready` only when the user says they're final ("publish these", "file them", "looks good, ship it").
- `filed` — on GitHub; `issue:` and `url:` lines were added by the publish script. Filed drafts are frozen local records — GitHub is the source of truth from then on; don't edit them.

## Step 6 — Publish in one run

When the user says the drafts are final, flip the approved ones to `status: ready`, then run the bundled script from the repo root:

```bash
bash .claude/skills/create-issue/scripts/publish.sh
```

It files every `ready` draft sequentially in natural-sort order (P0-2 before P0-10) via `gh issue create`, marks each `filed` with its issue number and URL, and paces requests to respect GitHub rate limits. Afterwards, report the URLs.

- Do **not** check off plan checkboxes on filing — boxes flip when issues *close*, per the plan doc's usage note. Flip `[ ]` to `[~]` only if the user says work is starting now.
- If `gh` fails mid-run (auth, missing label/milestone), already-filed drafts are safely marked `filed` — fix the cause (e.g. `gh label create spike …`), rerun the script, and it resumes with the remaining `ready` drafts.
