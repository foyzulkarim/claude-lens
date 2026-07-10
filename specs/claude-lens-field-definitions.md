# Claude Lens — Field Definitions (meaning layer)

> **Companion to [`claude-lens-data-model.md`](./claude-lens-data-model.md).** That doc is the
> *evidence* layer — every observed field with type, presence (n/N), and one example, regenerated
> by `scripts/survey-fields.py`. **This** doc is the *interpretation* layer — what each field
> **means**. The two are deliberately kept in separate files: the inventory must stay pure,
> reproducible evidence (a re-survey never clobbers prose), and meaning must never be mistaken
> for a measured fact.
>
> **How to read this doc:**
> - **Confidence** is marked on every definition: ✅ known from how the Claude API / Claude Code
>   work · 🔶 reasoned inference from the evidence · ❓ genuine guess. Where I'd only be guessing
>   *and* have nothing to anchor on, the definition is left blank rather than invented.
> - **Value domain / enum** entries are **recalled** from Claude Code / API behavior, **not
>   surveyed** — the inventory only captures one example per field, so it cannot prove a field is
>   an enum. Treat every enum here as *pending verification*; a separate `--distinct-values` pass
>   over the corpus (a small `survey-fields.py` enhancement) is the way to confirm them.
> - Field names, structure, and section numbering mirror `claude-lens-data-model.md` §3–§6 so you
>   can cross-check the two side by side.
>
> **Keeping in sync with Claude Code releases:** when a release adds or changes fields, re-run
> `scripts/survey-fields.py` — the inventory regenerates automatically. Then diff it and reconcile
> **only** the new/changed fields *here* by hand. Two files, two cadences: evidence is machine-refreshed,
> meaning is human-maintained. This doc keys entries by field name (never by count), so a re-survey
> that only shifts numbers never invalidates a definition.

---

## §A The big picture — how the JSONL fits together

You do not need to open a transcript to hold the model in your head. It is this:

- **A session is one file.** `~/.claude/projects/<project-dir-slug>/<uuid>.jsonl`. One project dir
  per working directory; one `.jsonl` per session. Every line in it is a single JSON record.
- **`type` (sometimes `type` + `subtype`) is the discriminator.** 21 distinct line types were
  observed. They fall into three families:
  1. **Conversation** — `assistant` and `user`. This is the actual dialogue plus tool traffic.
  2. **Sidecar metadata** — `mode`, `ai-title`, `permission-mode`, `last-prompt`, `custom-title`,
     `file-history-snapshot`, `bridge-session`, `queue-operation`, `agent-name`, `pr-link`,
     `worktree-state`, `attachment`. Claude Code writes these to track session/UI/hook state.
     They are *not* dialogue.
  3. **System events** — `system/*` subtypes (`turn_duration`, `stop_hook_summary`,
     `compact_boundary`, `away_summary`, `local_command`, `api_error`, `informational`).
- **Records form a reply-chain.** Each line has its own `uuid` and points at its predecessor via
  `parentUuid` — a linked list you walk to reconstruct order. `sessionId` groups every line of one
  session together.
- **The conversational spine** is a cycle: a `user` line (your prompt) → an `assistant` line
  (the model's API response) → if the model calls a tool, the `assistant` emits a **`tool_use`**
  content block with an `id` → the tool runs → the result comes back as a **`user`** line carrying
  a **`tool_result`** block that references that `tool_use_id` (plus a richer `toolUseResult`
  object) → the next `assistant` line, and so on. This is why ~72% of `user` lines are not typed
  input at all — they are tool results feeding back into the model.
- **`assistant` lines carry the money.** Each wraps the raw Anthropic API response under `message`,
  including `message.usage` — the token counts (input, output, cache read, cache creation) that
  every cost and efficiency measure is derived from.
- **Sub-agents** show up as `isSidechain: true`, with an `agentId` and a human `agent-name` line.
- **Premium files (C/B/L) are separate and optional.** They are written by *your* configured
  statusline / stop-hook scripts, not by Claude Code core — a per-sample cost timeline
  (`.cost.jsonl`), turn-boundary markers (`.turn-boundaries.jsonl`), and a one-row-per-session
  rollup (`cost-log.jsonl`). Absence means the capture wasn't set up, not corruption.

### §A.1 Relationships & join keys

The reusable wiring — what an endpoint author needs and would otherwise re-derive each time.

**Within a transcript (T):**

| link | from → to | purpose |
|---|---|---|
| reply chain | `parentUuid` → `uuid` | reconstruct message order (a linked list). |
| logical chain | `logicalParentUuid` → `uuid` | continue the chain across a `compact_boundary`, where `parentUuid` is null. |
| session grouping | `sessionId` | every line of one session/file shares it. |
| session lineage | `session_id` (snake) → ancestor `sessionId` | resumed/continued sessions point back to the origin file; equals `sessionId` for originals. |
| tool call ↔ result | assistant `content[tool_use].id` → user `content[tool_result].tool_use_id` | pair a call with its output. Also `sourceToolUseID` / `sourceToolAssistantUUID` on the user line. |
| dedupe | `message.id` (`msg_…`) | the same response can recur; dedupe on this. |
| API request | `requestId` (`req_…`) | assistant line → its underlying API call. |
| sub-agent | `isSidechain: true` + `agentId` (= `agent-<id>.jsonl`) | attribute lines to a sub-agent; the `agent-name` line supplies its human name. |
| snapshot ↔ message | `file-history-snapshot.messageId` → message `uuid` | which message a file backup belongs to. |
| compaction refs | `compactMetadata.preservedSegment.{head,anchor,tail}Uuid`, `preservedMessages.uuids[]` → line `uuid` | which lines survived a compaction. |

**Across files (the cross-file joins endpoints reuse most):**

| join | key | gives you |
|---|---|---|
| C (cost samples) → T | `C.session_id` = T's `session_id` (snake) | per-sample cost timeline for a session. |
| B (turn boundaries) → T | `B.session_id` = T's `session_id`; `B.transcript_path` = the T file path | slice a session into turns. |
| L (session rollup) → T | `L.session_id` = T's `session_id`; `L.dir` ≈ T's `cwd` | one-row session totals. |

> All three premium files join on the snake `session_id` (the lineage id), **not** the per-file
> `sessionId` — they equal each other for original sessions but diverge on resumed ones.

**"Cost for a session," three ways** — pick by which tier is available: T `assistant.message.usage`
(always present, per-response) · C samples (premium, fine-grained) · L rollup (premium, one row).
The C-vs-L field-name differences are catalogued in inventory §7.

---

## §B The shared envelope (documented once)

These fields repeat across the "real event" line types — `assistant`, `user`, `attachment`, and
every `system/*`. Rather than redefine them in all 21 tables below, they are defined here once; the
per-type sections only cover fields *specific* to that type. (The lightweight sidecar types —
`mode`, `ai-title`, etc. — carry only a minimal subset, usually `type` + `sessionId` + payload.)

| field | definition | value domain | conf |
|---|---|---|---|
| `uuid` | This record's own unique id — the node id in the reply-chain. | UUID | ✅ |
| `parentUuid` | `uuid` of the record this one follows. Reconstructs conversation order. `null` on chain roots (notably every `user` line — a user turn's linkage is tracked separately). | UUID \| null | ✅ |
| `logicalParentUuid` | Logical predecessor across a boundary that broke the physical chain (seen on `compact_boundary`, where `parentUuid` is null but the conversation logically continues). | UUID | 🔶 |
| `sessionId` | The session this line belongs to — the grouping key. Same value as the filename stem. | UUID | ✅ |
| `session_id` | snake_case **origin/lineage** id (verified from the corpus). Equals `sessionId` for an original session; on a **resumed/continued** session it holds the *older ancestor* session's id, which always resolves to a real `.jsonl`. Never appears without `sessionId`; only on content line types (`assistant`/`user`/`attachment`/`system/*`). Also the join key the premium C/B/L capture files use — so it tracks the *capture/lineage* identity across resumes, while `sessionId` is the per-file id. | UUID | ✅ |
| `timestamp` | When the record was written. | ISO-8601 UTC | ✅ |
| `type` | Line-type discriminator. | see §2 of inventory | ✅ |
| `subtype` | Second-level discriminator, only on `type: system`. | `turn_duration`, `stop_hook_summary`, `compact_boundary`, `away_summary`, `local_command`, `api_error`, `informational` | ✅ |
| `cwd` | Working directory at the moment the line was written. | absolute path | ✅ |
| `gitBranch` | Git branch at that moment; `HEAD` = detached / none. | branch name | ✅ |
| `version` | Claude Code version that wrote the line — the field that lets you date-bucket schema drift. | semver | ✅ |
| `userType` | Actor class. `external` = a real end user (vs internal harness identities). | `external` | 🔶 |
| `entrypoint` | How the session was launched. | `cli` | ✅ |
| `isSidechain` | `true` when the line belongs to a sub-agent branch rather than the main thread. | bool | ✅ |
| `isMeta` | `true` when the line is a meta/system message injected into the stream (e.g. command output), not user/model content. | bool | ✅ |
| `slug` | Human-readable session nickname (e.g. `peaceful-weaving-grove`). | slug string | ✅ |
| `agentId` | Short id of the (sub-)agent that produced the line — matches the `agent-<id>.jsonl` filename. Present when an agent is active. | hex id | ✅ |
| `requestId` | Anthropic API request id for the underlying call (`req_…`). | `req_…` | ✅ |

---

## §C Per-line-type meaning

### §3.1 `assistant` — the API response record

One record per model response. Wraps the raw Anthropic API result and is the primary source of
token/cost data. Carries the full envelope (§B) plus:

| field | definition | value domain | conf |
|---|---|---|---|
| `message` | The raw Anthropic API response object (id, model, role, content, usage, stop reason). See §3.1a. | object | ✅ |
| `attributionSkill` | Which skill was responsible for this turn — powers "cost by skill". | skill name | 🔶 |
| `attributionAgent` | Which (sub-)agent was responsible. | agent type | 🔶 |
| `attributionMcpServer` | Which MCP server the active tool belonged to. | server name | 🔶 |
| `attributionMcpTool` | Which MCP tool was invoked. | tool name | 🔶 |
| `attributionPlugin` | Which plugin was responsible. | plugin name | 🔶 |
| `isApiErrorMessage` | `true` when this "assistant" record actually captures an API error response, not a real completion (carries no `usage`). | bool | ✅ |
| `apiErrorStatus` | HTTP status of that error. | `429`, `529`, … | ✅ |
| `error` | Short error class for the above. | `rate_limit`, … | ✅ |

#### §3.1a `message.*`

| field | definition | value domain | conf |
|---|---|---|---|
| `id` | Anthropic message id (`msg_…`). The natural dedupe key for a response. | `msg_…` | ✅ |
| `model` | Model that produced the response. | `claude-fable-5`, `claude-sonnet-5`, … | ✅ |
| `role` | Always `assistant` here. | `assistant` | ✅ |
| `type` | Always `message`. | `message` | ✅ |
| `content` | Array of content blocks — `thinking`, `text`, and/or `tool_use`. See §3.1c. | array | ✅ |
| `usage` | Token accounting for the call. **The cost data.** See §3.1b. | object | ✅ |
| `stop_reason` | Why generation stopped. | `end_turn`, `tool_use`, `max_tokens`, `stop_sequence` | ✅ |
| `stop_sequence` | The stop string hit, if `stop_reason` was `stop_sequence`. | string \| null | ✅ |
| `stop_details` | Populated only when `stop_reason == "refusal"` (Opus 4.7+) — names the policy category that triggered the refusal. Branch on `stop_reason`, not this (it's informational and may be null even on a refusal). | `{type:"refusal", category, explanation}`, category ∈ cyber, bio, reasoning_extraction, frontier_llm; else null | ✅ |
| `diagnostics` | Populated only under the cache-diagnosis beta (request sets `diagnostics.previous_message_id`) — why the prompt cache missed vs the prior turn. Null on first turn / no divergence. | `{cache_miss_reason:{type, cache_missed_input_tokens}}`, type ∈ model_changed, system_changed, tools_changed, messages_changed, previous_message_not_found, unavailable; else null | ✅ |
| `container` | Populated only when the `code_execution` server tool runs — the sandbox container handle. Expires ~4.5 min idle; pass `id` back to reuse state across requests. | `{id:"container_…", expires_at}` or null | ✅ |
| `context_management` | Populated only when the `context_management` beta is set **and** an auto-edit fires — what was cleared from context (clearing invalidates cached prefixes). | `{applied_edits:[{type, cleared_tool_uses/cleared_thinking_turns, cleared_input_tokens}]}` or null | ✅ |

#### §3.1b `message.usage.*` — token accounting

| field | definition | conf |
|---|---|---|
| `input_tokens` | Fresh (non-cached) input tokens billed for this call. | ✅ |
| `output_tokens` | Tokens generated in the response. | ✅ |
| `cache_read_input_tokens` | Input tokens served from the prompt cache — ~10× cheaper than fresh input. | ✅ |
| `cache_creation_input_tokens` | Input tokens written **into** the cache this call — billed at a premium over fresh input. | ✅ |
| `cache_creation` | Breakdown of cache-creation tokens by TTL tier: `ephemeral_5m_input_tokens` (5-minute cache) vs `ephemeral_1h_input_tokens` (1-hour cache). Priced differently, hence split. | ✅ |
| `service_tier` | Capacity pool that served the request; affects price/latency. Response values `standard` \| `priority` \| `batch` (per Anthropic's Service Tiers docs). | ✅ |
| `speed` | Speed tier of the response. Values `standard`, `fast`. | 🔶 |
| `inference_geo` | Inference region; `not_available` when undisclosed. | 🔶 |
| `server_tool_use` | Counts of server-side tool calls billed separately from tokens: `web_search_requests`, `web_fetch_requests`. | ✅ |
| `iterations` | Per-internal-pass token breakdown when one response ran multiple inference passes; each element mirrors the usage shape. `[0]` is the first pass. | 🔶 |

#### §3.1c `content[]` block shapes (assistant)

| block | definition | conf |
|---|---|---|
| `thinking` | Extended-reasoning block. `thinking` = the reasoning text (often empty once redacted); `signature` = a cryptographic integrity token the API uses to validate the block on replay. | ✅ |
| `text` | A visible assistant reply segment. `text` = the prose. | ✅ |
| `tool_use` | A tool call. `name` = tool, `input` = arguments (see §3.1d), `id` = the `toolu_…` id that the matching `tool_result` will reference. `caller.type` = `direct` (model called it) vs a sub-agent caller. | ✅ |

#### §3.1d `tool_use.input[…]` — per-tool argument meaning

These are Claude Code's tool argument schemas (top-10 tools by frequency). ✅ throughout.

- **Bash** — `command` (shell to run), `description` (5–10 word summary shown to user), `timeout` (ms, ≤600000), `run_in_background` (detach and stream).
- **Read** — `file_path` (absolute), `limit`/`offset` (line window), `pages` (PDF page range).
- **Edit** — `file_path`, `old_string` (exact text to replace), `new_string` (replacement), `replace_all` (replace every occurrence).
- **Write** — `file_path`, `content` (full file contents to write/overwrite).
- **AskUserQuestion** — `questions` (array of `{question, header, options[], multiSelect}` to present).
- **mcp__claude-in-chrome__computer** — browser control: `action` (`screenshot`, `click`, `type`, `key`, …), `tabId`, `coordinate` `[x,y]`, `ref` (element ref), `text` (keys/text), `region` `[x,y,w,h]`.
- **TaskUpdate** — `taskId`, `status` (`pending`, `in_progress`, `completed`).
- **TaskCreate** — `subject`, `description`, `activeForm` (present-tense label), `tasks` (batch form).
- **Agent** — `subagent_type`, `description` (3–5 words), `prompt` (the task), `run_in_background`.
- **ToolSearch** — `query` (e.g. `select:Tool1,Tool2` or keywords), `max_results`.

### §3.2 `user` — typed input **and** tool-result continuations

Two distinct things share this type: (a) your actual prompts (`origin.kind: human`,
`promptSource: typed`) and (b) tool-result records feeding a tool's output back to the model
(carry `toolUseResult`). Full envelope (§B) plus:

| field | definition | value domain | conf |
|---|---|---|---|
| `message` | `{role: "user", content}` — `content` is either a plain string (typed prompt) or an array of `tool_result`/`text`/`image` blocks. | object | ✅ |
| `promptId` | Id of the prompt this line belongs to. | UUID | 🔶 |
| `promptSource` | How the prompt arrived. | `typed`, `queued`, … | 🔶 |
| `origin` | Provenance of the input; `kind` = `human` for real typed input. | object | 🔶 |
| `sourceToolAssistantUUID` | Links a tool-result `user` line back to the `assistant` line whose `tool_use` it answers. | UUID | 🔶 |
| `sourceToolUseID` | The specific `toolu_…` id being answered. | `toolu_…` | ✅ |
| `toolUseResult` | Rich structured result of the tool call. Union across all tools — see §3.2b. | object | 🔶 |
| `permissionMode` | Permission mode in effect. | `default`, `acceptEdits`, `plan`, `bypassPermissions` | 🔶 |
| `toolDenialKind` | Set when you rejected a permission prompt. | `user-rejected` | ✅ |
| `interruptedMessageId` | `msg_…` of the assistant response you interrupted. | `msg_…` | ✅ |
| `isCompactSummary` | `true` when this user line is the summary injected after a context compaction. | bool | ✅ |
| `isVisibleInTranscriptOnly` | Rendered in the transcript but not sent to the model. | bool | 🔶 |
| `imagePasteIds` | Ids of pasted images referenced by this input. | int[] | ✅ |

#### §3.2a `content[]` block shapes (user)

| block | definition | conf |
|---|---|---|
| `text` | A plain text segment of user input. | ✅ |
| `tool_result` | The output returned to the model for a prior `tool_use`. `tool_use_id` links them; `content` is the (string or array) payload; `is_error` marks a failed call. | ✅ |
| `image` | A pasted image. `source` = `{type: base64, media_type, data}`. | ✅ |

#### §3.2b `toolUseResult.*` — grouped by what produced it

The single richest object in the corpus: a union of every tool's structured result. Grouped by
origin rather than listed flat, since that's how to understand it:

- **Bash / shell** — `stdout`, `stderr`, `interrupted`, `code`/`codeText` (exit), `returnCodeInterpretation` (human reading of the exit code), `durationMs`, `noOutputExpected`, `isImage`. ✅
- **Edit / Write** — `filePath`, `oldString`/`newString`, `replaceAll`, `originalFile` (prior contents), `structuredPatch` (diff hunks), `userModified` (did the user edit before accept), `content` (written body), `file` (`{filePath, content, …}`). ✅
- **Read** — `file` (`{filePath, content, numLines, …}`), `type` (`text`/`image`). ✅
- **AskUserQuestion** — `questions` (as asked), `answers` (chosen). ✅
- **Task / background agents** — `taskId`/`task_id`, `task` (`{id, subject}`), `status`, `statusChange` (`{from,to}`), `updatedFields`, `backgroundTaskId`, `task_type`, `isAsync`, `isAgent`, `agentType`, `agentId`, `canReadOutputFile`, `outputFile`/`persistedOutputPath`/`persistedOutputSize` (where the agent's transcript was saved), `assistantAutoBackgrounded`, `allowedTools`, `description`, `prompt`, and the sub-agent completion rollup `toolStats`/`totalDurationMs`/`totalTokens`/`totalToolUseCount`/`usage`. 🔶
- **ToolSearch** — `query`, `matches`, `total_deferred_tools`, `count`, `resolvedModel`. 🔶
- **Web fetch / search** — `url`, `bytes`, `result`, `results`, `durationSeconds`. ✅
- **ExitPlanMode** — `plan` (the proposed plan), `planWasEdited`, `message`. ✅
- **Git / commit** — `gitOperation` (`{commit:{sha,kind}}`), `success`. ✅
- **SendUserFile / notifications** — `attachments`, `caption`, `display` (`render`/`attach`), `localSent`/`pushSent`/`sentAt` (delivery), `count`, `source`, `findings`, `sentinel`. 🔶
- **misc** — `commandName` (slash command run), `command`, `message`, `annotations`, `searchCount`, `worktreeBranch`/`worktreePath`. 🔶

### §3.3 `attachment` — injected context blocks

Content Claude Code injects into the stream: deferred-tool deltas, skill loads, hook output, file
snippets, plan/PRD references, IDE state. `attachment.type` is the discriminator (many variants).
Full envelope (§B) plus `attachment` (the payload object). Key `attachment.*` fields, grouped by
`type` family:

- **`deferred_tools_delta`** — `addedNames`/`removedNames`/`readdedNames`/`addedLines` (tool names becoming (un)available), `isInitial`. Tracks which deferred tools are loaded. 🔶
- **hook output** (`hookName`/`hookEvent`) — `command`, `exitCode`, `stdout`, `stderr`, `durationMs`, `toolUseID`. A hook that fired around a tool call (e.g. the `rtk` PreToolUse hook). ✅
- **skill / plugin state** — `names`, `skillCount`, `skills`, `addedTypes`/`removedTypes` (agent types), `allowedTools`, `pendingMcpServers`/`needsAuthMcpServers`, `showConcurrencyNote`. 🔶
- **plan / condition** — `planExists`, `planFilePath`, `condition`/`met`/`reason` (a background-task completion condition being evaluated), `commandMode`, `prompt`. 🔶
- **file snippet / IDE** — `filename`/`displayPath`/`path`, `snippet`, `lineStart`/`lineEnd`, `fileSize`, `pageCount`, `ideName`, `reminderType`. ✅
- **misc** — `content`, `itemCount`, `tokens`, `iterations`, `isSubAgent`, `origin`, `sentinel`, `source_uuid`, `imagePasteIds`, `newDate`, `tip`, `timestamp`. 🔶

### §3.4 `mode` — operating-mode snapshot

Records the current operating mode. `mode` ∈ `normal`, … · `sessionId` · `type`. 🔶

### §3.5 `last-prompt` — most-recent-prompt pointer

`leafUuid` = uuid of the latest leaf (most recent line) at snapshot time · `lastPrompt` = the
prompt text · `sessionId` · `type`. Used to restore "where were we". 🔶

### §3.6 `file-history-snapshot` — revert checkpoints

Per-message backup of tracked files so edits can be undone. `messageId` (the message this
snapshots), `isSnapshotUpdate`, `snapshot` = `{messageId, timestamp, trackedFileBackups}`
(`trackedFileBackups` maps file → backup, `{}` when none). ✅

### §3.7 `ai-title` — auto-generated session title

`aiTitle` = the model-generated session name · `sessionId` · `type`. ✅

### §3.8 `permission-mode` — permission-mode snapshot

`permissionMode` ∈ `default`, `acceptEdits`, `plan`, `bypassPermissions` · `sessionId` · `type`. ✅

### §3.9 `system/stop_hook_summary` — stop-hook results

Result of Stop-event hooks firing at turn end. `hookInfos[]` = `{command, durationMs}` per hook
(e.g. your `turn-logger.js`), `hookCount`, `hookErrors`, `hookAdditionalContext`, `hasOutput`,
`preventedContinuation` (did a hook block the turn ending), `stopReason`, `level`
(`suggestion`/…), `toolUseID`. Full envelope. ✅

### §3.10 `system/turn_duration` — per-turn timing

The only native "how long did that take" signal. `durationMs` = wall-clock of the turn,
`messageCount` = records in the turn, `pendingBackgroundAgentCount` = background agents still
running. ✅

### §3.11 `bridge-session` — cloud-bridge linkage

Emitted by Claude Code's **Bridge / Remote Control** subsystem, which lets the local CLI act as a
remote executor for a **cloud-hosted session** (driven from the claude.ai web UI or another Claude
session): the local process long-polls a server for work and streams activity back. `bridgeSessionId`
= the cloud session id, prefixed `cse_…` ("cloud session"); `lastSequenceNum` = an SSE stream
cursor — the ordinal of the last bridge event the local process consumed on its streaming
connection to `cse_…`, persisted so a restarted daemon resumes the stream without gaps or replays;
`sessionId` = the local session; `type`. ✅ for the subsystem; 🔶 for `lastSequenceNum` (inferred
from reverse-engineered CLI source, not an Anthropic-documented contract). *(Note: distinct from
the third-party "session-bridge" plugin, which is filesystem-based and uses different fields.)*

### §3.12 `queue-operation` — message-queue events

Handles messages sent **during tool execution** — queued while Claude was busy and replayed after.
`operation` ∈ `enqueue`, `dequeue` · `content` (the queued payload, e.g. a `<task-notification>`) ·
`sessionId` · `timestamp`. ✅

### §3.13 `agent-name` — sub-agent naming

Human name assigned to a spawned sub-agent. `agentName` · `sessionId` · `type`. ✅

### §3.14 `system/away_summary` — idle recap

Generated when Claude Code detects you've been **idle** — a no-tools generation run that recaps the
goal, the current task, and the next action, so you're caught up when you return. `content` = the
recap, `level`. ✅

### §3.15 `system/local_command` — slash-command output

Output of a locally-run slash command. `content` (often `<local-command-stdout>…</…>`), `level`
∈ `info`, … . Full envelope. ✅

### §3.16 `pr-link` — pull request created

Records a PR opened during the session. `prNumber`, `prRepository`, `prUrl`, `sessionId`,
`timestamp`. ✅

### §3.17 `worktree-state` — git worktree entry

Session entered a git worktree. `worktreeSession` = `{originalCwd, worktreePath, worktreeBranch,
worktreeName, enteredExisting, sessionId}` — `originalCwd` is the main checkout, `worktreePath`
the isolated copy. ✅

### §3.18 `system/informational` — harness notices

Free-text harness notices (e.g. "a hook blocked the turn ending 9 times — overriding"). `content`,
`level` ∈ `info`, `warning`, `error`. Full envelope. 🔶

### §3.19 `custom-title` — user-set session title

`customTitle` = the title you set · `sessionId` · `type`. ✅

### §3.20 `system/api_error` — retried API failure

A recoverable API failure and its retry bookkeeping. `error` = `{status, message, formatted,
connection, isNetworkDown, rateLimits}`, `retryAttempt`, `maxRetries`, `retryInMs`, `level:
error`. Full envelope. ✅

### §3.21 `system/compact_boundary` — context compaction marker

Marks where the conversation was compacted to reclaim context. `compactMetadata`:
- `trigger` ∈ `manual`, `auto` — what caused it.
- `preTokens` → `postTokens` — context size before vs after (e.g. 175304 → 14725 = what compaction bought).
- `cumulativeDroppedTokens` — running total of tokens dropped across compactions.
- `durationMs` — how long compaction took.
- `preservedSegment` = `{headUuid, anchorUuid, tailUuid}` — the contiguous span kept verbatim.
- `preservedMessages` = `{anchorUuid, uuids[], allUuids[]}` — the individual messages kept.

✅ for the token/trigger fields; 🔶 for the exact preserved-vs-dropped selection semantics.

---

## §D Premium capture files (C / B / L)

Written by your statusline / stop-hook scripts, not Claude Code core. See inventory §4–§6 for the
field tables; meanings below.

### C — `<uuid>.cost.jsonl` — per-sample cost timeline

Many rows per session, one per sampling tick. ✅ throughout.

| field | definition |
|---|---|
| `session_id` | Session this sample belongs to (joins to T's `sessionId`). |
| `timestamp` | When the sample was taken. |
| `cost_delta_usd` | Incremental cost since the previous sample. |
| `cumulative_cost_usd` | Running total cost for the session up to this sample. |
| `api_duration_ms` | API wall-time attributed to this sample. |
| `cache_read_tokens` / `cache_write_tokens` | Cache read / creation tokens at this sample. |
| `lines_added` / `lines_removed` | Code churn counters at this sample. |
| `context_pct` | How full the context window is (%). |
| `turn` | Turn index — **turn-indexed** shape only. |
| `epoch` / `sample` | Unix epoch + sample counter — **epoch-indexed** shape only. |

The two indexing shapes are a version-era change in how the logger keyed samples (see inventory §4).

### B — `<uuid>.turn-boundaries.jsonl` — turn markers

One row per turn end; lets you slice the transcript into turns without computing durations. ✅

| field | definition |
|---|---|
| `session_id` | Session. |
| `transcript_path` | Absolute path to the T `.jsonl` this marks. |
| `turn_end` | Timestamp of the turn boundary. |
| `turn_end_epoch` | Same instant as Unix epoch. |

### L — `cost-log.jsonl` — one-row-per-session rollup

Lives at `~/.claude/` (not under `projects/`). The cheap session-total summary; C is the
fine-grained timeline of the same thing. ✅

| field | definition |
|---|---|
| `session_id` | Session. |
| `timestamp` | Session time. |
| `cost_usd` | Total cost for the session. |
| `dir` | Working directory (L's stand-in for T's `cwd`; C has no `dir`). |
| `model` | Model label (display form, e.g. `Sonnet 4.6`). |
| `duration_ms` | Total session wall-time. |
| `cache_read` / `cache_write` | Session-total cache tokens. |
| `lines_added` / `lines_removed` | Session-total churn. |
| `context_pct` | Context fill at log time. |

---

## §E Cross-tier naming

The same concepts are named differently across C and L (`cache_read_tokens` vs `cache_read`,
`cost_delta_usd`/`cumulative_cost_usd` vs `cost_usd`, `api_duration_ms` vs `duration_ms`, C has no
`dir`). The differences are catalogued in **inventory §7**; the rule of thumb is *C is per-sample,
L is per-session*. Reconciliation is `#P2-1`'s job, not this doc's.

---

## §F Sources & remaining unknowns

Several definitions above were firmed up (2026-07-10) from Anthropic docs plus community
reverse-engineering of the transcript format, rather than the model's recall alone:

- **`service_tier` values** — [Anthropic Service Tiers docs](https://platform.claude.com/docs/en/api/service-tiers).
- **`bridge-session` / `bridgeSessionId` / `cse_`** — the Bridge / Remote Control subsystem: [DeepWiki: Bridge Protocol & Session Management](https://deepwiki.com/fazxes/Claude-code/8.1-bridge-protocol-and-session-management), [Claude Code Sessions docs](https://code.claude.com/docs/en/sessions).
- **`isMeta`, `isSidechain`, `agentId`, `requestId`** — [claude-code data-structures gist (samkeen)](https://gist.github.com/samkeen/dc6a9771a78d1ecee7eb9ec1307f1b52), [Anatomy of a Claude Code Conversation Transcript (Huy Tieu)](https://huytieu.com/blog/anatomy-of-a-claude-code-conversation-transcript/).
- **`system/away_summary`** — [claude-code-log issue #111](https://github.com/daaain/claude-code-log/issues/111).
- **`queue-operation`, `turn_duration`** — community transcript analyses (as above).
- **`session_id` (snake) = origin/lineage id** — derived directly from this corpus (2026-07-10):
  where snake ≠ the file's own `sessionId`, the snake value is always an older, real session
  `.jsonl` (5/5 cases, ancestor always earlier by timestamp). Terminal-verified, not recalled.
- **`stop_details`, `container`, `context_management`, `diagnostics`** — the four Messages-API
  fields that are `null` in this corpus; populated shapes from Anthropic docs (2026-07-10):
  [handling stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons) /
  [refusals](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback),
  [code-execution tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool),
  [context-management cookbook](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools),
  [cache diagnostics](https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics).
- **`lastSequenceNum`** — an SSE stream cursor, inferred from a third-party static analysis of the
  bundled CLI ([zread: bridge communication protocol](https://zread.ai/instructkr/claude-code/22-bridge-communication-protocol)),
  not an Anthropic-documented contract.

**Still genuinely unknown / inferred** — worth a targeted check before anything depends on them:

- **`attribution*` family** — behavior is clear from the data, but not documented; treat the
  meanings as inferred.
- **All enum / value-domain entries** remain recalled, pending a `survey-fields.py --distinct-values`
  pass over the corpus.
