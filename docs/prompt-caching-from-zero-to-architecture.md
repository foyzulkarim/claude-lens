# Prompt Caching, From Zero to Architecture

*What I learned after looking at my own numbers*

---

I built a tiny dashboard last week.

Not for any particular reason — just curiosity. I'd been using Claude Code as my main development tool for almost two years and I had no real sense of where my tokens were going. So I wrote a small Node.js server that reads the JSONL transcripts under `~/.claude/projects/`, sums up the usage fields, and renders a single-page dashboard with the totals. Maybe two hundred lines of code. A weekend afternoon's work.

The first thing it told me was unsurprising: I'd spent about $316 over the month, across 54 sessions and 2,295 messages.

The second thing it told me was the one I keep thinking about.

> **Cost with cache:** $316.53
> **Cost if cache didn't exist:** $666.99
> **Saved by caching:** $350.46 (53% cheaper)

*(Note: I'm on a Claude Pro subscription, so these aren't actual charges — they're reverse-calculated from token usage at API rates to give a sense of the underlying economics.)*

The cache had quietly saved me more money than I'd actually spent. And I had no idea how it worked. I hadn't configured it. I'd never read about it. I just used Claude Code, and apparently something in the system was doing 53% of the cost-control work for me, invisibly.

That bothered me — not because the savings were a problem, but because I clearly didn't understand a load-bearing piece of how my own tools worked. Worse, the daily breakdown showed wild variance:

| Date | Hit rate | Cost |
|---|---|---|
| 2026-03-28 | 91.6% | $1.34 |
| 2026-03-29 | 88.8% | $5.29 |
| 2026-03-31 | 79.8% | $1.68 |
| **2026-04-02** | **53.8%** | **$56.41** |
| **2026-04-03** | **48.1%** | **$117.25** |

A 40-point drop in cache hit rate had walked me into a 90x jump in daily cost. Something was happening on my best days that wasn't happening on my worst, and I couldn't name what.

So I sat down and tried to learn this from zero. This post is what I figured out, and what I'm going to do about it.

---

## The mental model I had wrong

Before any of the cache stuff makes sense, there's a foundational fact about how LLM APIs work that I had vaguely understood but never really *internalised*.

> **The model has no memory between turns. None at all.**

When you're 50 messages into a Claude Code session and it "remembers" what you said earlier — that memory isn't living anywhere on the server. The Anthropic side is stateless. What actually happens is that, every turn, Claude Code on your laptop packages up the *entire* conversation so far — the system prompt, every previous user message, every assistant reply, every tool call, every tool result, every skill that's been loaded — and ships the whole bundle to the API as one giant request.

The model reads all of it, generates the next reply, and forgets everything.

Next turn, the bundle gets re-sent, plus the new stuff. And again. And again.

A 50-turn session isn't 50 small API calls. It's 50 progressively larger API calls, each one carrying everything that came before. The "conversation" you experience is an illusion produced by replay.

This is why output tokens look so small in my data (1.3M output across the whole month) while input-side numbers are enormous (over 130M input tokens, the bulk of which is cached replay). The model is barely *writing* anything. The cost is overwhelmingly in how much it has to *re-read*.

Once that clicks, two questions become obvious:

1. **Doesn't replaying a million tokens every turn waste an enormous amount of GPU time?**
2. **Doesn't the user wait forever while the server reprocesses the same prefix it just processed?**

Yes and yes. And those two problems are exactly what prompt caching solves.

---

## So what is "the cache"?

When a request arrives at the inference server, the model has to compute internal representations for every token — the "key" and "value" tensors at each attention layer. This is the heavy work; it's what your input-token bill is actually paying for.

Prompt caching stores those computed representations on the server, keyed by the exact token content. On the next request, the server checks: *have I already computed these exact tokens, in this exact order, recently?* If yes, it loads the saved tensors instead of redoing the math. The model still produces a reply as if it had processed everything — but mechanically, it skipped most of the work.

The pricing reflects this. Looking at the rough ratios (the absolute numbers vary by model and platform, but the ratios are the thing):

| | Cost relative to fresh input |
|---|---|
| Fresh input (uncached) | 1× |
| **Cache write** (the first time a chunk is sent) | **~1.25×** |
| **Cache read** (every subsequent time) | **~0.10×** |

Read that table again. A token costs 1.25× normal price the first time, and 0.10× every time after. **Break-even is two reads.** After ten reads — which is *nothing* in a long Claude Code session — you've paid 2.25× instead of 10×.

This is why my dashboard showed cache reads at 79.8 million tokens versus cache writes at only 8 million. The same context was being read back over and over for cents on the dollar, while the writes were a one-time cost. The 53% savings figure isn't a bonus feature. It's the tool being economically viable at all.

---

## The Jenga rule

Here is the single most important property of the cache, and the one that determines whether your workflow is cache-friendly or cache-hostile:

> **The cache is prefix-based. The server can only reuse cached computation for a contiguous block of tokens starting from the very beginning of the request. The moment one token differs from what was cached, everything from that point onward is a miss and must be reprocessed.**

Picture a Claude Code request as a stack of tokens, in order:

```
1. System prompt (Anthropic's + Claude Code's)
2. Skill frontmatter menu
3. Tool definitions
4. CLAUDE.md / project context
5. Turn 1
6. Turn 2
   ...
N. Turn (N-4)
N+1. Your newest prompt
```

It's a Jenga tower. Pull a block from the top — the newest prompt — and the rest of the tower stands. Pull a block from anywhere lower, and everything above it collapses into cache misses.

This is why long, focused sessions get such high hit rates. Each new turn just adds one new block on top of an enormous cached prefix. Turn 30's request is "turn 1 through turn 29 (cached, 99% hit) + turn 30 (new, written to cache)". Turn 31 is "turn 1 through 30 (cached) + turn 31 (new)". Append-only. The cache compounds.

And this is why my bad days were bad. Something was happening on April 2nd and 3rd that broke the prefix mid-session — something that pulled a block from the bottom of the tower.

---

## The four things that collapse the tower

Once you have the prefix-invalidation rule clear, every cache-hostile thing in Claude Code falls into one of these four categories:

**1. `/clear`.** This is the explicit one. You're telling Claude Code to throw away the conversation and start over. The new request begins with a fresh prefix that has nothing in common with the old one. The cache from before `/clear` is dead to you. *(Sub-five-minute sessions where you cleared and tried again? That's where your worst hit rates come from.)*

**2. Auto-compaction.** When a session approaches the context window limit, Claude Code automatically summarises the older turns to make room. The summary *replaces* the original turns in the prefix. That replacement happens high up in the request, so everything below it invalidates. A single auto-compaction event can cost more than dozens of normal turns. This was almost certainly what happened on my worst days — I was running long, dense sessions on a complex project, hitting the context limit, and triggering compaction.

**3. Tool definitions changing mid-session.** Rare in practice, but real. If MCP servers connect or disconnect, or if hooks reshape the available toolset partway through a session, the tool-definitions block in the prefix changes, and everything after it invalidates.

**4. Edits anywhere near the top of the prefix.** Editing CLAUDE.md *between* sessions is fine — you'll just build a fresh cache on the next session. Editing the system prompt mid-session would be catastrophic, but Claude Code doesn't let you. The realistic version of this category is: anything that gets injected near the top of the request after the first turn — including, sometimes, a freshly-loaded skill (more on this below).

The common pattern across all four: **something near the top of the request changes, the prefix breaks, the tower collapses.**

---

## Skills are smarter than I thought

I'd assumed that having lots of skills installed was a tax — every skill must be sitting in my context, taking up space, adding to every turn's cache cost. I was wrong.

A skill in Claude Code consists of two parts:

- **Frontmatter** — a YAML block at the top of `SKILL.md` with a `name` and a `description`. Tiny. Maybe 50–100 tokens per skill.
- **Body** — the actual instructions, examples, code patterns. The substance. Sometimes thousands of tokens.

At session start, Claude Code only loads the **frontmatter** for every available skill. It assembles a kind of menu — *"you have these 12 skills available; here's what each one does in one sentence"* — and injects that into the system prompt area. Cheap, fits in the cache, gets read back at 10% pricing for the rest of the session.

The **body** stays on disk. It only enters your context when Claude actually decides to use the skill, by issuing a tool call to read the SKILL.md file. The full body then arrives as a tool result, *appended* to the conversation at whatever turn that happened.

This design has two beautiful properties:

1. **Awareness is cheap.** Claude knows every skill exists, but only pays the cost of skills it actually uses.
2. **Loading a skill mid-session doesn't collapse the tower.** Because the body arrives as a tool result, it lands in the middle of the conversation as a normal append. The prefix above it is untouched. From that turn onward, the skill body is part of the cache like everything else.

So the rule isn't "don't have many skills installed." It's more nuanced:

> **Don't have Claude speculatively invoke skills you don't need. Each invoked skill body permanently adds to your context, eating context-window budget and bringing auto-compaction closer. But the skills you don't invoke cost you nothing.**

This was a relief. It means the skills marketplace can grow without each new skill being a tax on every session.

---

## The cache is per-account

I had assumed — without thinking about it carefully — that if two different users sent identical prefixes (the exact same Claude Code system prompt, the exact same default tool definitions), they'd share a cache entry. Token-for-token identical input, why compute it twice?

It turns out the cache is **scoped per-account**. Two different accounts sending identical prefixes each build their own cache entries. No cross-account sharing.

At first this surprised me. Then I thought about why, and the reasoning is sound:

**Side-channel attacks.** If caches were globally shared, an attacker could probe the cache by sending guesses and measuring response latency. A fast response would mean *"those exact tokens were already cached by someone else recently."* That's a real, documented attack class against shared caches in ML systems — and it leaks information about what other users are doing. Per-account scoping eliminates the entire attack surface.

**Predictable billing.** If your hit rate depended on what other customers happened to be doing, your bill would be non-deterministic. With per-account scoping, your cache behaviour is a function of *your* usage only. You can reason about it. You can build dashboards about it.

**Defensible defaults on privacy.** Drawing a line between "non-sensitive prefix tokens" and "sensitive prefix tokens" is hard. Per-account scoping is the simple, defensible default — it doesn't require anyone to make that judgment.

So the picture is: within my own account, across all my Claude Code sessions on all my machines, identical prefixes can share cache entries (subject to the 5-minute TTL). Across accounts, never. That's the right boundary.

---

## The trap: a high hit rate doesn't mean a cheap session

Here's the thing that tripped me up the longest. I thought "high cache hit rate = cheap session" was a clean equivalence. It isn't.

Cache hit rate measures one thing: whether the prefix you replay each turn is being served from the cache or recomputed. It does **not** measure:

- How many turns the session has
- How many tool calls happened on each turn
- How many output tokens the model generated
- How big the context grew over the session

A session can have a 95% cache hit rate and still be expensive — if it's doing tons of round trips, generating tons of output tokens, and bloating its context with tool results that are cheap-to-re-read but never go away.

Tool calls are where this hides. Every tool call that Claude makes is a full API round trip. Concretely, when Claude decides to read a file:

1. **Round trip 1:** Send the conversation so far. Server processes it. Model generates "I want to call `Read` with `path=/foo/bar.py`." That generation is *output tokens*, billed at the high output rate. Response comes back to your laptop.
2. **Local execution:** Claude Code reads the file (free).
3. **Round trip 2:** Send the conversation again — now including Claude's tool-call message *and* the file contents as a tool result. Server processes it. Model generates the next thing — maybe another tool call, maybe a reply. More output tokens.

So one tool call is two round trips, two cache writes (for the new tail each time), and two batches of output tokens. If Claude does an exploratory wander through your codebase with 30 tool calls before answering you, that's 30 round trips, 30 batches of output, and 30 file contents permanently glued into your context for the rest of the session.

This is why "let Claude figure it out" can be ruinously expensive even when the cache hit rate is fine. The cache is doing its job on the prefix replay. It can't do anything about the round trips, the output tokens, or the bloat.

The implication: **cache hit rate is necessary but not sufficient. A truly cheap session has high hit rate AND directed tool use AND restrained context growth.**

---

## Six principles I'm following now

These are the rules I've extracted for myself. They aren't original — they fall out of the mechanics above — but it took me a while to derive them, and writing them down feels useful.

**1. Manual handoff summaries instead of auto-compaction.** When a session is getting long, I'll proactively ask for a dense summary of the important state and start a new session with it as the seed. This trades mid-session cache invalidation (catastrophic) for a controlled fresh cache on the next session (just a one-time write). The summary is small; what survives is what I chose, not what the auto-compactor chose.

**2. Don't invoke skills speculatively.** Frontmatter loads automatically and is tiny. Skill bodies only enter the context when invoked, and they stay there until compaction. So I treat skill invocation as a deliberate decision: "yes, this session needs the PDF skill; load it now and it'll be cached for the rest of the session." Not "load five skills just in case."

**3. Front-load context.** A file read at turn 2 is dramatically cheaper over the lifetime of a session than the same file read at turn 20. Turn 2 means the file sits in the cache, read cheaply, for the next 50 turns. Turn 20 means turns 1–19 had to do without it (probably with extra exploratory tool calls), and *then* the file enters. So whenever I can predict what a session will need, I gather it upfront in the first prompt.

**4. State the goal at turn one.** Course-corrections at turn 15 don't directly invalidate the cache (they just append), but they waste context window space on misunderstandings, which brings auto-compaction closer. A clear goal upfront is cache-friendly via the context-window-pressure path. It's also just better prompting, but the cache angle adds a real cost reason.

**5. Decompose into subagents.** This is the big one and I'll come back to it in the next section. Subagents run in their own context window with their own cache. The main session only sees their final, compact output.

**6. Direct tool use, not exploratory tool use.** Telling Claude *which* file to read is one round trip. Telling Claude to "go figure out the codebase" is twenty round trips, twenty output-token bursts, and twenty file contents bloating the context forever. Same answer, very different bill. I don't try to eliminate tool calls — I try to make every tool call a directed one.

The single principle behind all six: **a session is cheap when it has a single coherent purpose, eager context loading, and directed work. A session is expensive when it drifts, backtracks, or forces Claude to figure out what to do.**

---

## The architecture leap: workflows as subagent compositions

Principle #5 is where this stops being about "make individual sessions cheaper" and starts being about how to architect an entire development workflow.

A subagent in Claude Code is a separate context — a separate conversation, with its own cache, its own tool history, its own context-window budget. The main agent dispatches work to it, the subagent runs to completion, and only the subagent's final output is returned to the main conversation. The subagent's intermediate exploration — all the tool calls, the file reads, the dead ends, the reasoning — never enters the main agent's context.

Said in cache terms:

- The main session's prefix stays small, so its cache stays warm and auto-compaction stays far away.
- The subagent's exploration doesn't pollute the main cache.
- The subagent gets to do messy, exploratory work in isolation without poisoning the parent.
- Five subagents working on five sub-problems are five independent caches, none of them invalidating each other. **This is parallelism in cache terms.**

Which means: if you stop thinking of Claude Code as one long conversation and start thinking of it as a *composition of small, focused subagents*, you've described a software architecture.

The shape that's been forming in my head is something like:

> Each recurring development operation — code review, test running, PR drafting, dependency triage, log triage, migration generation — becomes its own *micro-skill*. The skill's body is small (instructions for how to do that one thing well). The skill always dispatches its work to a subagent, so its multi-turn exploration is hidden from the main conversation. The skill returns a compact, mature result.

The main session — the one I'm actually talking to — becomes more like a coordinator. It orchestrates. It says "go review this PR" and gets back a structured review, without ever seeing the 40 file reads and grep calls the reviewer-subagent did to produce it. It says "run the tests and tell me what failed" and gets back a pass/fail summary, without the 5,000 lines of test output cluttering its context.

This is a different way of working. In the old way, my session was a single long conversation that wandered through whatever I needed that day, accumulating context until it got too big and collapsed. In the new way, my session is short and focused — I delegate the heavy lifting to specialised subagents and ask them to bring back only what matters.

If this works the way the mechanics suggest it should, the effect on my numbers should be significant:

- Main sessions stay small → auto-compaction events disappear or become rare.
- Heavy work happens in isolated subagent contexts → main-session cache hit rate stays near the ceiling.
- Tool-call cardinality in the main conversation drops → fewer round trips, less output token cost, less bloat.

I don't yet know how big the effect actually is. I'm going to find out.

---

## What's next

The dashboard I built is the baseline. I'm going to leave it running for another month, after I've moved my workflow toward the principles above. The plan is concrete:

- Build three subagent-based skills first: a code-context gatherer, a test runner, and a PR-prep skill. These cover most of the multi-tool-call sequences I noticed eating my context.
- Stop using `/clear` as a reflex. When I'd normally clear, write a summary instead, and start a new session with that summary as the seed.
- Front-load file context aggressively in opening prompts — paste the relevant paths in the first message when I know what I'll need.
- Keep an eye on auto-compaction events. If I'm hitting them often, the session was wrong-shaped — either too broad in scope or not delegating enough to subagents.

I'm not expecting miracles. I'm expecting the variance in my daily cost to shrink — fewer 48% hit-rate days, more days that look like the 91% ones — and for the average to creep up. The 53% savings the cache is already giving me should grow toward something like 75–85% if the mechanics are as clean as they look.

I'll know in a month.

---

The thing I keep coming back to, after a week of learning this from zero, is that the cache isn't a feature you turn on. It's a property of the *shape* of how you work. Every workflow choice — how long your sessions are, when you load skills, when you dispatch to subagents, how directed your prompts are, how you handle the end of a session — has a cache-shaped consequence. The dashboard didn't tell me to change my workflow. It told me my workflow had a shape I'd never thought about, and that the shape was already costing me money.

I think that's the part worth sharing. Not the specific numbers, not the specific tools, but the realisation: **once you understand the prefix rule, the rest is just paying attention to what changes the prefix.**

The cache rewards a certain kind of discipline. I'd rather develop that discipline deliberately than discover its absence on a $117 day.
