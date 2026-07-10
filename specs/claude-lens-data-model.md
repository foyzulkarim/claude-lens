# Claude Lens — Data Inventory (observed-field evidence)

> Evidence-only — every observed field across T/C/B/L, with name / type / presence / inline
> anonymized example. **No** CompactCall contract, no Turn/Session derivation rules, no
> TierFlags design, no measure formulas, no API envelopes, no behavior contracts, no sign-off
> gates. Downstream `#P2-1` cites this as the field source-of-truth; the derived contract layer
> is a separate future task.
>
> **Field *meanings* live in the companion [`claude-lens-field-definitions.md`](./claude-lens-field-definitions.md)** —
> kept separate on purpose so this inventory stays pure, regenerable evidence and interpretation is
> never mistaken for a measured fact.
>
> Draft — supersedes the merged "Data Model & Contracts" doc dated 2026-07-08 whose REQ/ARCH
> scaffolding has been deleted.
>
> Corpus at investigation time (2026-07-09 snapshot): 108 T files (19,545 lines), 95 C files
> (3,472 lines), 34 B files (242 lines), 1 L file (48 lines). Every count below is a snapshot,
> not a contract — refresh by re-running `scripts/survey-fields.py`.

---

## §1 File classification

| Tier | Pattern | Location | File count | Line count | Notes |
|---|---|---|---|---|---|
| **T** | `<uuid>.jsonl` | `~/.claude/projects/**` | 108 | 19,545 | Default — every user has this |
| **C** | `<uuid>.cost.jsonl` | same dirs as T | 95 | 3,472 | Premium — opt-in via statusline setup; two mutually-exclusive indexing shapes (turn-indexed / epoch-indexed) |
| **B** | `<uuid>.turn-boundaries.jsonl` | same dirs as T | 34 | 242 | Premium — opt-in via stop-hook setup; single stable shape |
| **L** | `cost-log.jsonl` | `~/.claude/` (parent of projects scan root — discovery must search explicitly) | 1 | 48 | Premium — opt-in via statusline setup; **one shared file across all sessions**, not per-session |

**Defensive note:** Absence of C/B/L files is **not corruption** — they appear only when the user has set up cost-capturing statuslines/stop-hooks. Their optional nature is exactly why they need their own first-class tables.

---

## §2 T line-type distribution

> **Note on counts:** every count below is the observation at 2026-07-09. Re-run `scripts/survey-fields.py` to refresh; these are placeholders the script regenerates, not constants.

| `type/subtype` | Count (at investigation time) | See |
|---|---|---|
| `assistant` | 6928 | §3.1 |
| `user` | 4327 | §3.2 |
| `attachment` | 1434 | §3.3 |
| `mode` | 1032 | §3.4 |
| `last-prompt` | 989 | §3.5 |
| `file-history-snapshot` | 988 | §3.6 |
| `ai-title` | 929 | §3.7 |
| `permission-mode` | 811 | §3.8 |
| `system/stop_hook_summary` | 546 | §3.9 |
| `system/turn_duration` | 492 | §3.10 |
| `bridge-session` | 484 | §3.11 |
| `queue-operation` | 252 | §3.12 |
| `agent-name` | 123 | §3.13 |
| `system/away_summary` | 94 | §3.14 |
| `system/local_command` | 63 | §3.15 |
| `pr-link` | 20 | §3.16 |
| `worktree-state` | 18 | §3.17 |
| `system/informational` | 6 | §3.18 |
| `custom-title` | 4 | §3.19 |
| `system/api_error` | 3 | §3.20 |
| `system/compact_boundary` | 2 | §3.21 |

---

## §3 Per-line-type field tables

One sub-section per line type, ordered by count desc. Columns: `field | type | presence (n/N) | example | notes`. Nested objects recur up to two levels with `####` sub-tables.

### §3.1 `assistant`  (n=6928 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `cwd` | str | 6928/6928 | /Users/<redacted>/.claude |  |
| `entrypoint` | str | 6928/6928 | cli |  |
| `gitBranch` | str | 6928/6928 | HEAD |  |
| `isSidechain` | bool | 6928/6928 | false |  |
| `message` | object | 6928/6928 | {"model": "claude-fable-5", "id": "msg_012JtQfM1vSG5VTRuxRsiZ2R", "type": "me... |  |
| `parentUuid` | str | 6928/6928 | <uuid:f2c41044...> |  |
| `sessionId` | str | 6928/6928 | <uuid:866138e1...> |  |
| `timestamp` | str | 6928/6928 | 2026-07-03T04:46:51.065Z |  |
| `type` | str | 6928/6928 | assistant |  |
| `userType` | str | 6928/6928 | external |  |
| `uuid` | str | 6928/6928 | <uuid:ab50aab8...> |  |
| `version` | str | 6928/6928 | 2.1.199 |  |
| `requestId` | str | 6853/6928 | req_011CceWx7gqgbJxLfwZ4d6pS |  |
| `session_id` | str | 2982/6928 | <uuid:866138e1...> |  |
| `slug` | str | 2800/6928 | peaceful-weaving-grove |  |
| `attributionSkill` | str | 791/6928 | session-stats |  |
| `agentId` | str | 542/6928 | a26c705418923abca |  |
| `attributionAgent` | str | 541/6928 | Explore |  |
| `attributionMcpServer` | str | 215/6928 | claude-in-chrome |  |
| `attributionMcpTool` | str | 215/6928 | tabs_context_mcp |  |
| `attributionPlugin` | str | 134/6928 | dev-pipeline |  |
| `isApiErrorMessage` | bool | 11/6928 | true |  |
| `apiErrorStatus` | int | 8/6928 | 429 |  |
| `error` | str | 8/6928 | rate_limit |  |

#### `message.* (assistant)`  (n=6928 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `content` | array[1] | 6928/6928 | [{"type": "thinking", "thinking": "", "signature": "CAIShAMKYggPGAIqQJ2Rfgz/b... |  |
| `id` | str | 6928/6928 | msg_012JtQfM1vSG5VTRuxRsiZ2R |  |
| `model` | str | 6928/6928 | claude-fable-5 |  |
| `role` | str | 6928/6928 | assistant |  |
| `type` | str | 6928/6928 | message |  |
| `usage` | object | 6928/6928 | {"input_tokens": 12031, "cache_creation_input_tokens": 17176, "cache_read_inp... |  |
| `stop_details` | null | 6868/6928 | null |  |
| `stop_reason` | str | 6868/6928 | tool_use |  |
| `stop_sequence` | null | 6832/6928 | null |  |
| `diagnostics` | null | 6806/6928 | null |  |
| `container` | null | 11/6928 | null |  |
| `context_management` | null | 11/6928 | null |  |

##### `content[]` block shapes (assistant)

_Per-shape counts at investigation time: see scope names below. Each block-type's keys tabulated in its own sub-table._

#### `content[text].*`  (n=1616 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `text` | str | 1616/1616 | Let me look at what's actually in your skills directory to see the extent of ... |  |
| `type` | str | 1616/1616 | text |  |

#### `content[thinking].*`  (n=1905 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `signature` | str | 1905/1905 | CAIShAMKYggPGAIqQJ2Rfgz/bQvzL2clJRAGLvcDQ29UMev1iSx+TBLLFIOuAttZ7PrmSSiFnRvAi... |  |
| `thinking` | str | 1905/1905 |  |  |
| `type` | str | 1905/1905 | thinking |  |

#### `content[tool_use].*`  (n=3407 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `id` | str | 3407/3407 | toolu_016pRW2fK9gdjj3qkH6uc2FK |  |
| `input` | object | 3407/3407 | {"command": "ls -la /Users/<redacted>/.claude/skills/", "description": "List ... |  |
| `name` | str | 3407/3407 | Bash |  |
| `type` | str | 3407/3407 | tool_use |  |
| `caller` | object | 3354/3407 | {"type": "direct"} |  |

#### `message.usage.*`  (n=6928 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `input_tokens` | int | 6928/6928 | 12031 |  |
| `output_tokens` | int | 6928/6928 | 184 |  |
| `cache_creation` | object | 6868/6928 | {"ephemeral_1h_input_tokens": 17176, "ephemeral_5m_input_tokens": 0} |  |
| `cache_creation_input_tokens` | int | 6868/6928 | 17176 |  |
| `cache_read_input_tokens` | int | 6868/6928 | 0 |  |
| `inference_geo` | str | 6868/6928 | not_available |  |
| `service_tier` | str | 6868/6928 | standard |  |
| `iterations` | array[1] | 6543/6928 | [{"input_tokens": 12031, "output_tokens": 184, "cache_read_input_tokens": 0, ... |  |
| `server_tool_use` | object | 6543/6928 | {"web_search_requests": 0, "web_fetch_requests": 0} |  |
| `speed` | str | 6543/6928 | standard |  |

#### `message.usage.cache_creation.*`  (n=6868 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `ephemeral_1h_input_tokens` | int | 6868/6868 | 17176 |  |
| `ephemeral_5m_input_tokens` | int | 6868/6868 | 0 |  |

#### `message.usage.iterations[0].*  — only [0] surveyed; `[0]` is real subscript not '≥1 by convention'`  (n=6520 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `cache_creation` | object | 6520/6520 | {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 17176} |  |
| `cache_creation_input_tokens` | int | 6520/6520 | 17176 |  |
| `cache_read_input_tokens` | int | 6520/6520 | 0 |  |
| `input_tokens` | int | 6520/6520 | 12031 |  |
| `output_tokens` | int | 6520/6520 | 184 |  |
| `type` | str | 6520/6520 | message |  |

#### `message.usage.iterations[0].cache_creation.*`  (n=6520 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `ephemeral_1h_input_tokens` | int | 6520/6520 | 17176 |  |
| `ephemeral_5m_input_tokens` | int | 6520/6520 | 0 |  |

#### `message.usage.server_tool_use.*`  (n=6543 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `web_fetch_requests` | int | 6543/6543 | 0 |  |
| `web_search_requests` | int | 6543/6543 | 0 |  |

##### `tool_use.input` keys per tool — top 10 by occurrence count (n = tool_use blocks observed with a dict `input`)

#### `tool_use.input[Bash].*`  (n=1309 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `command` | str | 1309/1309 | ls -la /Users/<redacted>/.claude/skills/ |  |
| `description` | str | 1071/1309 | List personal skills directory |  |
| `timeout` | int | 26/1309 | 300000 |  |
| `run_in_background` | bool | 3/1309 | true |  |

#### `tool_use.input[Read].*`  (n=788 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `file_path` | str | 788/788 | /Users/<redacted>/.claude/scripts/turn-logger.js |  |
| `limit` | int | 198/788 | 6 |  |
| `offset` | int | 175/788 | 24 |  |
| `pages` | str | 2/788 | 1-6 |  |

#### `tool_use.input[Edit].*`  (n=778 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `file_path` | str | 778/778 | /Users/<redacted>/.claude/scripts/cost-logger.js |  |
| `new_string` | str | 778/778 |   // Activity detection — fires when API_DURATION_MS changes since last poll.... |  |
| `old_string` | str | 778/778 | // Turn detection — fires when API_DURATION_MS changes since last poll le... |  |
| `replace_all` | bool | 778/778 | false |  |

#### `tool_use.input[Write].*`  (n=199 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `content` | str | 199/199 | #!/usr/bin/env node // Cost logger — the single source of truth for capturin... |  |
| `file_path` | str | 199/199 | /Users/<redacted>/.claude/scripts/cost-logger.js |  |

#### `tool_use.input[AskUserQuestion].*`  (n=59 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `questions` | array[2] | 59/59 | [{"question": "What should I do with the 8 Cloudflare skills sitting in ~/.cl... |  |

#### `tool_use.input[mcp__claude-in-chrome__computer].*`  (n=54 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `action` | str | 54/54 | screenshot |  |
| `tabId` | int | 54/54 | 1155364964 |  |
| `coordinate` | array[2] | 11/54 | [746, 15] |  |
| `ref` | str | 11/54 | ref_7 |  |
| `text` | str | 6/54 | F5 |  |
| `region` | array[4] | 2/54 | [680, 0, 970, "..."] |  |

#### `tool_use.input[TaskUpdate].*`  (n=50 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `status` | str | 50/50 | in_progress |  |
| `taskId` | str | 50/50 | 1 |  |

#### `tool_use.input[TaskCreate].*`  (n=30 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `description` | str | 29/30 | package.json, tsconfig, src/ layout, prices/prices.json seeded per SPEC §5.3,... |  |
| `subject` | str | 29/30 | S0 — Bootstrap: scaffold + CLAUDE.md + price seed |  |
| `activeForm` | str | 9/30 | Scaffolding project |  |
| `tasks` | str | 1/30 | [{"description":"Scaffold Vite + React + TS app in project root"},{"descripti... |  |

#### `tool_use.input[Agent].*`  (n=29 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `description` | str | 29/29 | Verify distillation completeness |  |
| `prompt` | str | 29/29 | I'm verifying that a distillation of 7 planning docs into 4 new docs is compl... |  |
| `subagent_type` | str | 19/29 | Explore |  |
| `run_in_background` | bool | 13/29 | true |  |

#### `tool_use.input[ToolSearch].*`  (n=27 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `query` | str | 27/27 | select:TaskCreate,TaskUpdate |  |
| `max_results` | int | 23/27 | 2 |  |

### §3.2 `user`  (n=4327 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `cwd` | str | 4327/4327 | /Users/<redacted>/.claude |  |
| `entrypoint` | str | 4327/4327 | cli |  |
| `gitBranch` | str | 4327/4327 | HEAD |  |
| `isSidechain` | bool | 4327/4327 | false |  |
| `message` | object | 4327/4327 | {"role": "user", "content": "it seems when i mistakenly installed cloudfalre ... |  |
| `parentUuid` | null | 4327/4327 | null |  |
| `sessionId` | str | 4327/4327 | <uuid:866138e1...> |  |
| `timestamp` | str | 4327/4327 | 2026-07-03T04:46:46.767Z |  |
| `type` | str | 4327/4327 | user |  |
| `userType` | str | 4327/4327 | external |  |
| `uuid` | str | 4327/4327 | <uuid:7c50ba86...> |  |
| `version` | str | 4327/4327 | 2.1.199 |  |
| `promptId` | str | 4324/4327 | <uuid:c6c52da2...> |  |
| `sourceToolAssistantUUID` | str | 3398/4327 | <uuid:227daa06...> |  |
| `toolUseResult` | object | 3343/4327 | {"stdout": "total 16\ndrwx------  18 foyzul  staff   576 Jul  3 14:43 .\ndrwx... |  |
| `slug` | str | 1667/4327 | peaceful-weaving-grove |  |
| `session_id` | str | 1610/4327 | <uuid:866138e1...> |  |
| `permissionMode` | str | 467/4327 | default |  |
| `promptSource` | str | 467/4327 | typed |  |
| `agentId` | str | 361/4327 | a26c705418923abca |  |
| `origin` | object | 287/4327 | {"kind": "human"} |  |
| `isMeta` | bool | 228/4327 | true |  |
| `imagePasteIds` | array[2] | 17/4327 | [1, 2] |  |
| `sourceToolUseID` | str | 12/4327 | toolu_01AYNZS2CV1ouV7CGuUWrufU |  |
| `toolDenialKind` | str | 7/4327 | user-rejected |  |
| `interruptedMessageId` | str | 4/4327 | msg_018EeczxckPT4ZZFxaf4qnAL |  |
| `isCompactSummary` | bool | 2/4327 | true |  |
| `isVisibleInTranscriptOnly` | bool | 2/4327 | true |  |

#### `message.* (user)`  (n=4327 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `content` | str | 4327/4327 | it seems when i mistakenly installed cloudfalre skills or something similar i... |  |
| `role` | str | 4327/4327 | user |  |

##### `content[]` block shapes (user)

#### `content[text].*`  (n=111 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `text` | str | 111/111 | Base directory for this skill: /Users/<redacted>/.claude/skills/session-stats... |  |
| `type` | str | 111/111 | text |  |

#### `content[tool_result].*`  (n=3398 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `content` | str | 3398/3398 | total 16 drwx------ 18 foyzul staff 576 Jul 3 14:43 . drwxr-xr-x@ 46 foy... |  |
| `tool_use_id` | str | 3398/3398 | toolu_016pRW2fK9gdjj3qkH6uc2FK |  |
| `type` | str | 3398/3398 | tool_result |  |
| `is_error` | bool | 1393/3398 | false |  |

#### `content[image].*`  (n=19 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `source` | object | 19/19 | {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgoAAAANSUhEUg... |  |
| `type` | str | 19/19 | image |  |

#### `origin.*`  (n=287 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `kind` | str | 287/287 | human |  |

#### `toolUseResult.*  — top-level field observed on user records; treated like any nested object`  (n=3094 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `interrupted` | bool | 1210/3094 | false |  |
| `isImage` | bool | 1210/3094 | false |  |
| `noOutputExpected` | bool | 1210/3094 | false |  |
| `stderr` | str | 1210/3094 |  |  |
| `stdout` | str | 1210/3094 | total 16 drwx------ 18 foyzul staff 576 Jul 3 14:43 . drwxr-xr-x@ 46 foy... |  |
| `type` | str | 948/3094 | text |  |
| `filePath` | str | 913/3094 | /Users/<redacted>/.claude/scripts/cost-logger.js |  |
| `originalFile` | null | 907/3094 | null |  |
| `structuredPatch` | array[0] | 907/3094 | [] |  |
| `userModified` | bool | 907/3094 | false |  |
| `file` | object | 753/3094 | {"filePath": "/Users/<redacted>/.claude/scripts/turn-logger.js", "content": "... |  |
| `newString` | str | 712/3094 |   // Activity detection — fires when API_DURATION_MS changes since last poll.... |  |
| `oldString` | str | 712/3094 | // Turn detection — fires when API_DURATION_MS changes since last poll le... |  |
| `replaceAll` | bool | 712/3094 | false |  |
| `content` | str | 201/3094 | #!/usr/bin/env node // Cost logger — the single source of truth for capturin... |  |
| `success` | bool | 62/3094 | true |  |
| `answers` | object | 53/3094 | {"What should I do with the 8 Cloudflare skills sitting in ~/.claude/skills?"... |  |
| `questions` | array[2] | 53/3094 | [{"question": "What should I do with the 8 Cloudflare skills sitting in ~/.cl... |  |
| `statusChange` | object | 50/3094 | {"from": "pending", "to": "in_progress"} |  |
| `taskId` | str | 50/3094 | 1 |  |
| `updatedFields` | array[1] | 50/3094 | ["status"] |  |
| `annotations` | object | 39/3094 | {} |  |
| `gitOperation` | object | 37/3094 | {"commit": {"sha": "d7bd524", "kind": "committed"}} |  |
| `agentId` | str | 29/3094 | a26c705418923abca |  |
| `prompt` | str | 29/3094 | I'm verifying that a distillation of 7 planning docs into 4 new docs is compl... |  |
| `status` | str | 29/3094 | completed |  |
| `task` | object | 29/3094 | {"id": "1", "subject": "S0 \u2014 Bootstrap: scaffold + CLAUDE.md + price seed"} |  |
| `query` | str | 28/3094 | select:TaskCreate,TaskUpdate |  |
| `resolvedModel` | str | 28/3094 | claude-sonnet-5 |  |
| `returnCodeInterpretation` | str | 28/3094 | No matches found |  |
| `matches` | array[2] | 27/3094 | ["TaskCreate", "TaskUpdate"] |  |
| `total_deferred_tools` | int | 27/3094 | 79 |  |
| `canReadOutputFile` | bool | 23/3094 | true |  |
| `description` | str | 23/3094 | Code-quality review of PR #1 diff |  |
| `isAsync` | bool | 23/3094 | true |  |
| `outputFile` | str | 23/3094 | /private/tmp/claude-501/-Users-foyzul-personal-llm-ledger/ee626025-be03-4fb4-... |  |
| `persistedOutputPath` | str | 15/3094 | /Users/<redacted>/.claude/projects/-Users-foyzul-personal-llm-ledger/717ac411... |  |
| `persistedOutputSize` | int | 15/3094 | 39217 |  |
| `commandName` | str | 12/3094 | dev-pipeline:start-task |  |
| `bytes` | int | 7/3094 | 0 |  |
| `code` | int | 7/3094 | 404 |  |
| `codeText` | str | 7/3094 | Not Found |  |
| `durationMs` | int | 7/3094 | 573 |  |
| `result` | str | 7/3094 | The server returned HTTP 404 Not Found. The response body was not retrieved.... |  |
| `url` | str | 7/3094 | https://platform.claude.com/docs/en/pricing.md |  |
| `agentType` | str | 6/3094 | Explore |  |
| `isAgent` | bool | 6/3094 | false |  |
| `message` | str | 6/3094 | Entered plan mode. You should now focus on exploring the codebase and designi... |  |
| `plan` | str | 6/3094 | # Remove localStorage entirely (personal overlay + compare-selection) ## Con... |  |
| `planWasEdited` | bool | 6/3094 | true |  |
| `toolStats` | object | 6/3094 | {"readCount": 13, "searchCount": 6, "bashCount": 17, "editFileCount": 0, "lin... |  |
| `totalDurationMs` | int | 6/3094 | 242527 |  |
| `totalTokens` | int | 6/3094 | 97244 |  |
| `totalToolUseCount` | int | 6/3094 | 36 |  |
| `usage` | object | 6/3094 | {"input_tokens": 363, "cache_creation_input_tokens": 0, "cache_read_input_tok... |  |
| `backgroundTaskId` | str | 5/3094 | brpya8aao |  |
| `allowedTools` | array[4] | 2/3094 | ["Read", "Grep", "Glob", "..."] |  |
| `assistantAutoBackgrounded` | bool | 2/3094 | false |  |
| `attachments` | array[1] | 2/3094 | [{"path": "/private/tmp/claude-501/-Users-foyzul-personal-skills/609c213b-32d... |  |
| `caption` | str | 2/3094 | Titles-only card for the LinkedIn post — dark theme, sized 1200×630 for socia... |  |
| `command` | str | 2/3094 | npx next dev -p 3001 > /tmp/hifz-dev.log 2>&1 |  |
| `count` | int | 2/3094 | 3 |  |
| `display` | str | 2/3094 | render |  |
| `findings` | array[3] | 2/3094 | [{"file": "specs/claude-lens-data-model.md", "line": 301, "summary": "\u00a76... |  |
| `localSent` | bool | 2/3094 | true |  |
| `pushSent` | bool | 2/3094 | true |  |
| `sentAt` | str | 2/3094 | 2026-07-08T21:20:41.100Z |  |
| `task_id` | str | 2/3094 | b9q134jgd |  |
| `task_type` | str | 2/3094 | local_bash |  |
| `durationSeconds` | float | 1/3094 | 7.6251733329999265 |  |
| `results` | array[2] | 1/3094 | [{"tool_use_id": "srvtoolu_01J3YdCzvaTDQKxxtvtWghfZ", "content": [{"title": "... |  |
| `searchCount` | int | 1/3094 | 1 |  |
| `source` | str | 1/3094 | seeded |  |
| `worktreeBranch` | str | 1/3094 | audit-claude |  |
| `worktreePath` | str | 1/3094 | /Users/<redacted>/personal/agentic-swe-vod/audit-claude |  |

### §3.3 `attachment`  (n=1434 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `attachment` | object | 1434/1434 | {"type": "deferred_tools_delta", "addedNames": ["CronCreate", "CronDelete", "... |  |
| `cwd` | str | 1434/1434 | /Users/<redacted>/.claude |  |
| `entrypoint` | str | 1434/1434 | cli |  |
| `gitBranch` | str | 1434/1434 | HEAD |  |
| `isSidechain` | bool | 1434/1434 | false |  |
| `parentUuid` | str | 1434/1434 | <uuid:7c50ba86...> |  |
| `sessionId` | str | 1434/1434 | <uuid:866138e1...> |  |
| `timestamp` | str | 1434/1434 | 2026-07-03T04:46:46.767Z |  |
| `type` | str | 1434/1434 | attachment |  |
| `userType` | str | 1434/1434 | external |  |
| `uuid` | str | 1434/1434 | <uuid:733c9b9e...> |  |
| `version` | str | 1434/1434 | 2.1.199 |  |
| `session_id` | str | 577/1434 | <uuid:866138e1...> |  |
| `slug` | str | 553/1434 | peaceful-weaving-grove |  |
| `agentId` | str | 57/1434 | a26c705418923abca |  |

#### `attachment.*  — many variant discriminator values; union of all keys shown`  (n=1434 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `type` | str | 1434/1434 | deferred_tools_delta |  |
| `content` | str | 548/1434 | - agents-sdk: Build AI agents on Cloudflare Workers using the Agents SDK. Loa... |  |
| `itemCount` | int | 380/1434 | 0 |  |
| `durationMs` | int | 274/1434 | 117323 |  |
| `command` | str | 261/1434 | rtk hook claude |  |
| `exitCode` | int | 261/1434 | 127 |  |
| `hookEvent` | str | 261/1434 | PreToolUse |  |
| `hookName` | str | 261/1434 | PreToolUse:Bash |  |
| `stderr` | str | 261/1434 | Failed with non-blocking status code: /bin/sh: rtk: command not found |  |
| `stdout` | str | 261/1434 |  |  |
| `toolUseID` | str | 261/1434 | toolu_019Picwe5zMnXWqM5RpzceVS |  |
| `isInitial` | bool | 193/1434 | true |  |
| `addedNames` | array[103] | 185/1434 | ["CronCreate", "CronDelete", "CronList", "..."] |  |
| `removedNames` | array[0] | 185/1434 | [] |  |
| `addedLines` | array[103] | 184/1434 | ["CronCreate", "CronDelete", "CronList", "..."] |  |
| `filename` | str | 170/1434 | /Users/<redacted>/.claude/skills/sandbox-sdk/SKILL.md |  |
| `names` | array[51] | 119/1434 | ["agents-sdk", "cloudflare", "cloudflare-email-service", "..."] |  |
| `skillCount` | int | 119/1434 | 51 |  |
| `readdedNames` | array[0] | 110/1434 | [] |  |
| `condition` | str | 96/1434 | now scaffold the skill for teammates, copy the necessary files into the skill... |  |
| `met` | bool | 96/1434 | false |  |
| `pendingMcpServers` | array[0] | 80/1434 | [] |  |
| `reason` | str | 80/1434 | The skill has been fully scaffolded and files copied into the directory struc... |  |
| `addedBlocks` | array[2] | 75/1434 | ["## claude-in-chrome\n**IMPORTANT: If the Chrome browser tools are deferred ... |  |
| `addedTypes` | array[8] | 74/1434 | ["claude", "claude-code-guide", "code-simplifier:code-simplifier", "..."] |  |
| `removedTypes` | array[0] | 74/1434 | [] |  |
| `showConcurrencyNote` | bool | 74/1434 | false |  |
| `displayPath` | str | 57/1434 | llm-benchmark-tracker-prd.md |  |
| `allowedTools` | array[0] | 53/1434 | [] |  |
| `snippet` | str | 52/1434 | 9 }, 10 "license": "MIT", 11 "author": "Foyzul Karim <foyzulkarim@gmail... |  |
| `planExists` | bool | 35/1434 | false |  |
| `planFilePath` | str | 35/1434 | /Users/<redacted>/.claude/plans/peaceful-weaving-grove.md |  |
| `commandMode` | str | 25/1434 | task-notification |  |
| `prompt` | str | 25/1434 | <task-notification> <task-id>aaec2ded48a5eaa4a</task-id> <tool-use-id>toolu_0... |  |
| `sentinel` | bool | 16/1434 | true |  |
| `origin` | object | 14/1434 | {"kind": "human"} |  |
| `iterations` | int | 13/1434 | 1 |  |
| `tokens` | int | 13/1434 | 6472 |  |
| `isSubAgent` | bool | 10/1434 | false |  |
| `reminderType` | str | 10/1434 | full |  |
| `timestamp` | str | 10/1434 | 2026-07-04T23:56:46.784Z |  |
| `ideName` | str | 8/1434 | Visual Studio Code |  |
| `lineEnd` | int | 8/1434 | 154 |  |
| `lineStart` | int | 8/1434 | 154 |  |
| `path` | str | 7/1434 | /Users/<redacted>/personal/llm-ledger/standalone |  |
| `newDate` | str | 6/1434 | 2026-07-05 |  |
| `tip` | object | 5/1434 | {"tip": "You're asking about the diffs \u2014 /diff shows all uncommitted cha... |  |
| `needsAuthMcpServers` | array[5] | 3/1434 | ["claude.ai Cloudflare Developer Platform", "claude.ai Gmail", "claude.ai Goo... |  |
| `source_uuid` | str | 2/1434 | <uuid:650f70bb...> |  |
| `fileSize` | int | 1/1434 | 1026386 |  |
| `imagePasteIds` | array[1] | 1/1434 | [4] |  |
| `pageCount` | int | 1/1434 | 11 |  |
| `skills` | array[3] | 1/1434 | [{"name": "plan-requirements", "path": "userSettings:plan-requirements", "con... |  |

### §3.4 `mode`  (n=1032 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `mode` | str | 1032/1032 | normal |  |
| `sessionId` | str | 1032/1032 | <uuid:866138e1...> |  |
| `type` | str | 1032/1032 | mode |  |

### §3.5 `last-prompt`  (n=989 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `leafUuid` | str | 989/989 | <uuid:f2c41044...> |  |
| `sessionId` | str | 989/989 | <uuid:866138e1...> |  |
| `type` | str | 989/989 | last-prompt |  |
| `lastPrompt` | str | 933/989 | it seems when i mistakenly installed cloudfalre skills or something similar i... |  |

### §3.6 `file-history-snapshot`  (n=988 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `isSnapshotUpdate` | bool | 988/988 | false |  |
| `messageId` | str | 988/988 | <uuid:7c50ba86...> |  |
| `snapshot` | object | 988/988 | {"messageId": "<uuid:7c50ba86...>", "trackedFileBackups": {}, "timestamp": "2... |  |
| `type` | str | 988/988 | file-history-snapshot |  |

#### `snapshot.*`  (n=988 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `messageId` | str | 988/988 | <uuid:7c50ba86...> |  |
| `timestamp` | str | 988/988 | 2026-07-03T04:46:46.767Z |  |
| `trackedFileBackups` | object | 988/988 | {} |  |

### §3.7 `ai-title`  (n=929 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `aiTitle` | str | 929/929 | Clean up cluttered skills directory from misinstalled Cloudflare |  |
| `sessionId` | str | 929/929 | <uuid:866138e1...> |  |
| `type` | str | 929/929 | ai-title |  |

### §3.8 `permission-mode`  (n=811 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `permissionMode` | str | 811/811 | default |  |
| `sessionId` | str | 811/811 | <uuid:866138e1...> |  |
| `type` | str | 811/811 | permission-mode |  |

### §3.9 `system/stop_hook_summary`  (n=546 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `cwd` | str | 546/546 | /Users/<redacted>/.claude/skills |  |
| `entrypoint` | str | 546/546 | cli |  |
| `gitBranch` | str | 546/546 | HEAD |  |
| `hasOutput` | bool | 546/546 | false |  |
| `hookAdditionalContext` | array[0] | 546/546 | [] |  |
| `hookCount` | int | 546/546 | 1 |  |
| `hookErrors` | array[0] | 546/546 | [] |  |
| `hookInfos` | array[1] | 546/546 | [{"command": "/opt/homebrew/bin/node /Users/<redacted>/.claude/scripts/turn-l... |  |
| `isSidechain` | bool | 546/546 | false |  |
| `level` | str | 546/546 | suggestion |  |
| `parentUuid` | str | 546/546 | <uuid:eee2e2f7...> |  |
| `preventedContinuation` | bool | 546/546 | false |  |
| `sessionId` | str | 546/546 | <uuid:866138e1...> |  |
| `stopReason` | str | 546/546 |  |  |
| `subtype` | str | 546/546 | stop_hook_summary |  |
| `timestamp` | str | 546/546 | 2026-07-03T04:50:42.485Z |  |
| `toolUseID` | str | 546/546 | <uuid:50168a24...> |  |
| `type` | str | 546/546 | system |  |
| `userType` | str | 546/546 | external |  |
| `uuid` | str | 546/546 | <uuid:ec6c42ac...> |  |
| `version` | str | 546/546 | 2.1.199 |  |
| `session_id` | str | 248/546 | <uuid:866138e1...> |  |
| `slug` | str | 173/546 | peaceful-weaving-grove |  |

#### `hookInfos[0].*`  (n=546 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `command` | str | 546/546 | /opt/homebrew/bin/node /Users/<redacted>/.claude/scripts/turn-logger.js |  |
| `durationMs` | int | 546/546 | 40 |  |

### §3.10 `system/turn_duration`  (n=492 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `cwd` | str | 492/492 | /Users/<redacted>/.claude/skills |  |
| `durationMs` | int | 492/492 | 112778 |  |
| `entrypoint` | str | 492/492 | cli |  |
| `gitBranch` | str | 492/492 | HEAD |  |
| `isMeta` | bool | 492/492 | false |  |
| `isSidechain` | bool | 492/492 | false |  |
| `messageCount` | int | 492/492 | 44 |  |
| `parentUuid` | str | 492/492 | <uuid:ec6c42ac...> |  |
| `sessionId` | str | 492/492 | <uuid:866138e1...> |  |
| `subtype` | str | 492/492 | turn_duration |  |
| `timestamp` | str | 492/492 | 2026-07-03T04:50:42.486Z |  |
| `type` | str | 492/492 | system |  |
| `userType` | str | 492/492 | external |  |
| `uuid` | str | 492/492 | <uuid:cfc9e26a...> |  |
| `version` | str | 492/492 | 2.1.199 |  |
| `slug` | str | 173/492 | peaceful-weaving-grove |  |
| `pendingBackgroundAgentCount` | int | 17/492 | 3 |  |

### §3.11 `bridge-session`  (n=484 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `bridgeSessionId` | str | 484/484 | cse_01BT2V97zu3Q34e16Lk9Q7jJ |  |
| `lastSequenceNum` | int | 484/484 | 0 |  |
| `sessionId` | str | 484/484 | <uuid:866138e1...> |  |
| `type` | str | 484/484 | bridge-session |  |

### §3.12 `queue-operation`  (n=252 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `operation` | str | 252/252 | enqueue |  |
| `sessionId` | str | 252/252 | <uuid:25814b88...> |  |
| `timestamp` | str | 252/252 | 2026-07-03T21:33:43.539Z |  |
| `type` | str | 252/252 | queue-operation |  |
| `content` | str | 126/252 | <task-notification> <task-id>brpya8aao</task-id> <tool-use-id>toolu_01XnL54ib... |  |

### §3.13 `agent-name`  (n=123 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `agentName` | str | 123/123 | remove-localstorage-overlay |  |
| `sessionId` | str | 123/123 | <uuid:ee626025...> |  |
| `type` | str | 123/123 | agent-name |  |

### §3.14 `system/away_summary`  (n=94 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `content` | str | 94/94 | You wanted your cluttered ~/.claude/skills directory cleaned up. I deleted th... |  |
| `cwd` | str | 94/94 | /Users/<redacted>/.claude/skills |  |
| `entrypoint` | str | 94/94 | cli |  |
| `gitBranch` | str | 94/94 | HEAD |  |
| `isMeta` | bool | 94/94 | false |  |
| `isSidechain` | bool | 94/94 | false |  |
| `parentUuid` | str | 94/94 | <uuid:cfc9e26a...> |  |
| `sessionId` | str | 94/94 | <uuid:866138e1...> |  |
| `subtype` | str | 94/94 | away_summary |  |
| `timestamp` | str | 94/94 | 2026-07-03T04:53:48.332Z |  |
| `type` | str | 94/94 | system |  |
| `userType` | str | 94/94 | external |  |
| `uuid` | str | 94/94 | <uuid:88db7c62...> |  |
| `version` | str | 94/94 | 2.1.199 |  |
| `slug` | str | 35/94 | peaceful-weaving-grove |  |

### §3.15 `system/local_command`  (n=63 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `content` | str | 63/63 | <local-command-stdout></local-command-stdout> |  |
| `cwd` | str | 63/63 | /Users/<redacted>/personal/agentic-swe-vod/audit-claude |  |
| `entrypoint` | str | 63/63 | cli |  |
| `gitBranch` | str | 63/63 | audit-claude |  |
| `isMeta` | bool | 63/63 | false |  |
| `isSidechain` | bool | 63/63 | false |  |
| `level` | str | 63/63 | info |  |
| `parentUuid` | str | 63/63 | <uuid:e908ce63...> |  |
| `sessionId` | str | 63/63 | <uuid:b5a9532c...> |  |
| `subtype` | str | 63/63 | local_command |  |
| `timestamp` | str | 63/63 | 2026-06-11T08:10:03.336Z |  |
| `type` | str | 63/63 | system |  |
| `userType` | str | 63/63 | external |  |
| `uuid` | str | 63/63 | <uuid:11b3d970...> |  |
| `version` | str | 63/63 | 2.1.169 |  |
| `slug` | str | 12/63 | your-online-claude-code-expressive-bubble |  |

### §3.16 `pr-link`  (n=20 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `prNumber` | int | 20/20 | 5 |  |
| `prRepository` | str | 20/20 | foyzulkarim/claude-lens |  |
| `prUrl` | str | 20/20 | https://github.com/foyzulkarim/claude-lens/pull/5 |  |
| `sessionId` | str | 20/20 | <uuid:c985ab86...> |  |
| `timestamp` | str | 20/20 | 2026-07-05T22:58:53.043Z |  |
| `type` | str | 20/20 | pr-link |  |

### §3.17 `worktree-state`  (n=18 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `sessionId` | str | 18/18 | <uuid:b5a9532c...> |  |
| `type` | str | 18/18 | worktree-state |  |
| `worktreeSession` | object | 18/18 | {"originalCwd": "/Users/<redacted>/personal/agentic-swe-vod", "worktreePath":... |  |

#### `worktreeSession.*`  (n=16 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `enteredExisting` | bool | 16/16 | true |  |
| `originalCwd` | str | 16/16 | /Users/<redacted>/personal/agentic-swe-vod |  |
| `sessionId` | str | 16/16 | <uuid:7083ffca...> |  |
| `worktreeBranch` | str | 16/16 | audit-claude |  |
| `worktreeName` | str | 16/16 | audit-claude |  |
| `worktreePath` | str | 16/16 | /Users/<redacted>/personal/agentic-swe-vod/audit-claude |  |

### §3.18 `system/informational`  (n=6 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `content` | str | 6/6 | A hook blocked the turn from ending 9 consecutive times — overriding and endi... |  |
| `cwd` | str | 6/6 | /Users/<redacted>/personal/claude-lens |  |
| `entrypoint` | str | 6/6 | cli |  |
| `gitBranch` | str | 6/6 | feat/12/data-model-contracts-spec |  |
| `isMeta` | bool | 6/6 | false |  |
| `isSidechain` | bool | 6/6 | false |  |
| `level` | str | 6/6 | warning |  |
| `parentUuid` | str | 6/6 | <uuid:389e1b6a...> |  |
| `sessionId` | str | 6/6 | <uuid:630a8bd7...> |  |
| `subtype` | str | 6/6 | informational |  |
| `timestamp` | str | 6/6 | 2026-07-08T21:07:54.020Z |  |
| `type` | str | 6/6 | system |  |
| `userType` | str | 6/6 | external |  |
| `uuid` | str | 6/6 | <uuid:08711e5a...> |  |
| `version` | str | 6/6 | 2.1.202 |  |
| `session_id` | str | 5/6 | <uuid:35dc3d64...> |  |

### §3.19 `custom-title`  (n=4 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `customTitle` | str | 4/4 | Token Oscilloscope test 1 |  |
| `sessionId` | str | 4/4 | <uuid:3ce44dfb...> |  |
| `type` | str | 4/4 | custom-title |  |

### §3.20 `system/api_error`  (n=3 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `cwd` | str | 3/3 | /Users/<redacted>/personal/tokenowl |  |
| `entrypoint` | str | 3/3 | cli |  |
| `error` | object | 3/3 | {"message": "401 {\"error\":{\"message\":\"Invalid API Key\",\"param\":\"Plea... |  |
| `gitBranch` | str | 3/3 | main |  |
| `isSidechain` | bool | 3/3 | false |  |
| `level` | str | 3/3 | error |  |
| `maxRetries` | int | 3/3 | 10 |  |
| `parentUuid` | str | 3/3 | <uuid:f30b10ff...> |  |
| `retryAttempt` | int | 3/3 | 1 |  |
| `retryInMs` | float | 3/3 | 538.1610999314915 |  |
| `sessionId` | str | 3/3 | <uuid:00e4ef67...> |  |
| `subtype` | str | 3/3 | api_error |  |
| `timestamp` | str | 3/3 | 2026-06-12T01:07:44.356Z |  |
| `type` | str | 3/3 | system |  |
| `userType` | str | 3/3 | external |  |
| `uuid` | str | 3/3 | <uuid:0bc8cf30...> |  |
| `version` | str | 3/3 | 2.1.173 |  |

#### `error.*`  (n=3 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `connection` | null | 3/3 | null |  |
| `formatted` | str | 3/3 | 401 Invalid API Key |  |
| `isNetworkDown` | bool | 3/3 | false |  |
| `message` | str | 3/3 | 401 {"error":{"message":"Invalid API Key","param":"Please provide valid API K... |  |
| `rateLimits` | null | 3/3 | null |  |
| `status` | int | 3/3 | 401 |  |

### §3.21 `system/compact_boundary`  (n=2 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `compactMetadata` | object | 2/2 | {"trigger": "manual", "preTokens": 175304, "postTokens": 14725, "cumulativeDr... |  |
| `content` | str | 2/2 | Conversation compacted |  |
| `cwd` | str | 2/2 | /Users/<redacted>/personal/claude-lens |  |
| `entrypoint` | str | 2/2 | cli |  |
| `gitBranch` | str | 2/2 | feat/12/data-model-contracts-spec |  |
| `isSidechain` | bool | 2/2 | false |  |
| `level` | str | 2/2 | info |  |
| `logicalParentUuid` | str | 2/2 | <uuid:d525834d...> |  |
| `parentUuid` | null | 2/2 | null |  |
| `sessionId` | str | 2/2 | <uuid:35dc3d64...> |  |
| `slug` | str | 2/2 | goofy-churning-sun |  |
| `subtype` | str | 2/2 | compact_boundary |  |
| `timestamp` | str | 2/2 | 2026-07-07T22:52:16.737Z |  |
| `type` | str | 2/2 | system |  |
| `userType` | str | 2/2 | external |  |
| `uuid` | str | 2/2 | <uuid:d70c5560...> |  |
| `version` | str | 2/2 | 2.1.202 |  |
| `isMeta` | bool | 1/2 | false |  |

#### `compactMetadata.*`  (n=2 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `durationMs` | int | 2/2 | 145517 |  |
| `postTokens` | int | 2/2 | 14725 |  |
| `preTokens` | int | 2/2 | 175304 |  |
| `preservedMessages` | object | 2/2 | {"anchorUuid": "<uuid:5c9f18f2...>", "uuids": ["<uuid:4795e4bd...>", "<uuid:0... |  |
| `preservedSegment` | object | 2/2 | {"headUuid": "<uuid:4795e4bd...>", "anchorUuid": "<uuid:5c9f18f2...>", "tailU... |  |
| `trigger` | str | 2/2 | manual |  |
| `cumulativeDroppedTokens` | int | 1/2 | 160579 |  |

#### `compactMetadata.preservedSegment.*  (two levels deep)`  (n=2 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `anchorUuid` | str | 2/2 | <uuid:5c9f18f2...> |  |
| `headUuid` | str | 2/2 | <uuid:4795e4bd...> |  |
| `tailUuid` | str | 2/2 | <uuid:d525834d...> |  |

#### `compactMetadata.preservedMessages.*`  (n=2 at investigation time)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `allUuids` | array[5] | 2/2 | ["<uuid:4795e4bd...>", "<uuid:0b8fdd2a...>", "<uuid:978fd30c...>", "..."] |  |
| `anchorUuid` | str | 2/2 | <uuid:5c9f18f2...> |  |
| `uuids` | array[4] | 2/2 | ["<uuid:4795e4bd...>", "<uuid:0b8fdd2a...>", "<uuid:ff467862...>", "..."] |  |

---

## §4 C corpus field table (`.cost.jsonl`) — shared 10-field core + two mutually-exclusive indexing variants

_Single combined table; `notes` column carries the per-field shape flag._

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `api_duration_ms` | int | 3472/3472 | 7606 | core (all 3,472 lines) |
| `cache_read_tokens` | int | 3472/3472 | 89165 | core (all 3,472 lines) |
| `cache_write_tokens` | int | 3472/3472 | 1662 | core (all 3,472 lines) |
| `context_pct` | int | 3472/3472 | 9 | core (all 3,472 lines) |
| `cost_delta_usd` | float | 3472/3472 | 0.139625 | core (all 3,472 lines) |
| `cumulative_cost_usd` | float | 3472/3472 | 6.682555999999999 | core (all 3,472 lines) |
| `lines_added` | int | 3472/3472 | 0 | core (all 3,472 lines) |
| `lines_removed` | int | 3472/3472 | 0 | core (all 3,472 lines) |
| `session_id` | str | 3472/3472 | <uuid:8ab044f2...> | core (all 3,472 lines) |
| `timestamp` | str | 3472/3472 | 2026-07-03T04:39:35Z | core (all 3,472 lines) |
| `turn` | int | 1883/3472 | 43 | turn-indexed only (1,883/3,472) |
| `epoch` | int | 1589/3472 | 1783057922 | epoch-indexed only (1,589/3,472) |
| `sample` | int | 1589/3472 | 64 | epoch-indexed only (1,589/3,472) |

_Two line schemas observed (turn-indexed vs epoch-indexed); mutually exclusive within a single line. Both shapes co-occur in some files (3 files exhibit a version-era switchover — Claude Code version upgrade during a long-running or resumed session)._

---

## §5 B corpus field table (`.turn-boundaries.jsonl`)

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `session_id` | str | 242/242 | <uuid:866138e1...> |  |
| `transcript_path` | str | 242/242 | /Users/<redacted>/.claude/projects/-Users-foyzul--claude/866138e1-998a-499b-b... |  |
| `turn_end` | str | 242/242 | 2026-07-03T05:54:53Z |  |
| `turn_end_epoch` | int | 242/242 | 1783058093 |  |

---

## §6 L corpus field table (`cost-log.jsonl`)

_L lives at `~/.claude/` — the parent of the projects scan root — not under `~/.claude/projects/`. Discovery must search it explicitly, not rely on the projects glob._

| field | type | presence (n/N) | example | notes |
|---|---|---|---|---|
| `cache_read` | int | 48/48 | 3283204 |  |
| `cache_write` | int | 48/48 | 85929 |  |
| `context_pct` | int | 48/48 | 45 |  |
| `cost_usd` | float | 48/48 | 1.8167905999999998 |  |
| `dir` | str | 48/48 | /Users/<redacted>/personal/agentic-swe-vod |  |
| `duration_ms` | int | 48/48 | 3521047 |  |
| `lines_added` | int | 48/48 | 16 |  |
| `lines_removed` | int | 48/48 | 16 |  |
| `model` | str | 48/48 | Sonnet 4.6 |  |
| `session_id` | str | 48/48 | <uuid:bedd1780...> |  |
| `timestamp` | str | 48/48 | 2026-06-26T23:39:54Z |  |

---

## §7 Cross-tier field-name collision table

| Concept | C field | L field | Note |
|---|---|---|---|
| Cache reads | `cache_read_tokens` | `cache_read` | Same concept, different names |
| Cache writes | `cache_write_tokens` | `cache_write` | Same concept, different names |
| Cost (delta) | `cost_delta_usd` | (none — L only has cumulative) | L carries one row per session, no delta |
| Cost (cumulative) | `cumulative_cost_usd` | `cost_usd` | L's per-session total; C's running cumulative |
| API duration | `api_duration_ms` | `duration_ms` | L's is session-total wall; C's is per-sample |
| Working directory | (none — C has no dir) | `dir` | L carries the cwd equivalent; C relies on the session-id mapping back to T's `cwd` |
| Indexing | `epoch` + `sample` | (none — L is one row per session) | C uses both turn-indexed and epoch/sample schemes |
| Indexing | `turn` | (none) | C turn-indexed shape only |

_No interpretation, no remediation — just observed differences. The downstream `#P2-1` will reconcile at code-time._

---

## §8 Out of scope

- Per-tool `tool_use.input` schemas beyond the top-10 (only the union of input keys is tabulated)
- `attachment.*` per-type discriminator breakdown (only the key union is tabulated, not a per-`type` breakdown)
- Any future JSONL fields not observed in the actual corpus surveyed
- Retain/drop decisions for `CompactCall` (that's `#P2-1`'s scope)
- Tier assignment (`🟢`/`🟡`/`🔴` classification is a derived concept — not in this doc)
- `CompactCall`, `Turn`, `Session`, `TierFlags` field-for-field contract design
- Measure formulas (cache hit %, wall minutes, etc.)
- API envelopes (`Series`, sessions list/detail, health)
- Behavior contracts (dedupe semantics, malformed-line handling, time bucketing, query-key serialization, rounding)
- Sign-off decisions (multi-model attribution, premium coverage granularity)
- Corrections to `architecture.md` / `pages.md`
