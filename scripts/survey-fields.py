#!/usr/bin/env python3
"""
claude-lens — field inventory survey script (deliverable 3 of plan-data-inventory.md).

Walks ~/.claude/projects/**/*.jsonl and ~/.claude/cost-log.jsonl across four passes
(A: transcript-only, B: cost, C: turn-boundaries, D: cost-log), and for every observed
line type, nested object, content-block shape, and per-tool tool_use.input union, emits
a structured record describing one field: name, JSON type, presence (n/N), and one
anonymized example value. Output is JSON to stdout (use --pretty for indented).

The emitted records are consumed by Phase 2 (manual walk by an executing agent) to
format specs/claude-lens-data-model.md as pure observed-field evidence. Counts refresh
naturally on re-run; the doc structure is fixed and stable.

Self-contained stdlib only; Python >= 3.8. No third-party deps.
"""

import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict

HOME = os.path.expanduser("~/.claude")
PROJ = os.path.join(HOME, "projects")
L_PATH = os.path.join(HOME, "cost-log.jsonl")
HOME_DIR = os.path.expanduser("~")                        # real home, e.g. /Users/foyzul
# Dashed form Claude uses in tmp/project paths: /private/tmp/.../-Users-foyzul-...
DASHED_HOME = HOME_DIR[1:].replace("/", "-")              # e.g. Users-foyzul

# Anonymization rules (per plan §4); applied at extraction time before emitting.

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def anonymize_value(v, depth=0):
    """Return an anonymized copy/snapshot of v per plan §4."""
    if depth > 3:
        return "<truncated>"
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        s = v.replace(HOME_DIR, "/Users/<redacted>").replace(DASHED_HOME, "Users-<redacted>")
        if UUID_RE.match(s):
            return f"<uuid:{s[:8]}...>"
        if len(s) > 80:
            s = s[:77] + "..."
        return s
    if isinstance(v, list):
        if len(v) > 3:
            return [anonymize_value(x, depth + 1) for x in v[:3]] + ["..."]
        return [anonymize_value(x, depth + 1) for x in v]
    if isinstance(v, dict):
        out = {}
        for k in list(v.keys())[:6]:
            out[k] = anonymize_value(v[k], depth + 1)
        if len(v) > 6:
            out["..."] = "(more)"
        return out
    return type(v).__name__


def type_name(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "str"
    if isinstance(v, list):
        return f"array[{len(v)}]"
    if isinstance(v, dict):
        return "object"
    return type(v).__name__


# Field inventory helper


class Scope:
    """Accumulates field union, presence, example-per-field for one scope."""

    def __init__(self, name):
        self.name = name
        self.total = 0  # number of records walked
        self.present = Counter()
        self.examples = {}
        self.types = {}

    def observe(self, obj):
        self.total += 1
        if not isinstance(obj, dict):
            return
        for k, v in obj.items():
            self.present[k] += 1
            if k not in self.examples:
                self.examples[k] = anonymize_value(v)
                self.types[k] = type_name(v)

    def records(self):
        out = []
        for field in sorted(self.present, key=lambda k: (-self.present[k], k)):
            out.append(
                {
                    "scope": self.name,
                    "field": field,
                    "type": self.types.get(field, "?"),
                    "present": self.present[field],
                    "total": self.total,
                    "example": self.examples.get(field),
                }
            )
        return out


def walk_path(obj, path):
    """Follow a list of keys/indices into obj; return None if anything missing."""
    cur = obj
    for step in path:
        if isinstance(step, int):
            if isinstance(cur, list) and 0 <= step < len(cur):
                cur = cur[step]
            else:
                return None
        else:
            if isinstance(cur, dict) and step in cur:
                cur = cur[step]
            else:
                return None
    return cur


# Four passes — each returns a dict {scopes: {name: Scope}, meta: {...}}


def pass_transcript():
    """Pass A: transcript-only .jsonl (exclude .cost., .turn-boundaries.)."""
    files = [
        f
        for f in glob.glob(os.path.join(PROJ, "**", "*.jsonl"), recursive=True)
        if ".cost." not in f and ".turn-boundaries." not in os.path.basename(f)
    ]
    scopes = {}
    line_type_keys = Counter()
    malformed = 0
    file_count = 0
    line_count = 0

    # Helper to get-or-create scope
    def get_scope(name):
        if name not in scopes:
            scopes[name] = Scope(name)
        return scopes[name]

    for path in files:
        file_count += 1
        with open(path) as f:
            for line in f:
                line_count += 1
                try:
                    r = json.loads(line)
                except Exception:
                    malformed += 1
                    continue
                t = r.get("type", "?")
                sub = r.get("subtype", "")
                key = f"{t}/{sub}" if sub else t
                line_type_keys[key] += 1

                # Top-level field inventory per line-type
                get_scope(f"T:{key}").observe(r)

                # assistant-specific nested objects
                if t == "assistant":
                    if isinstance(r.get("message"), dict):
                        get_scope("T:assistant:message.*").observe(r["message"])
                        # content[] blocks
                        c = r["message"].get("content")
                        if isinstance(c, list):
                            for block in c:
                                if isinstance(block, dict):
                                    bt = block.get("type")
                                    if bt:
                                        get_scope(
                                            f"T:assistant:content[{bt}].*"
                                        ).observe(block)
                        # usage + nested
                        usage = r["message"].get("usage")
                        if isinstance(usage, dict):
                            get_scope("T:assistant:message.usage.*").observe(usage)
                            cc = usage.get("cache_creation")
                            if isinstance(cc, dict):
                                get_scope(
                                    "T:assistant:message.usage.cache_creation.*"
                                ).observe(cc)
                            iters = usage.get("iterations")
                            if isinstance(iters, list) and iters:
                                # only [0] per plan §15.2
                                first = iters[0]
                                if isinstance(first, dict):
                                    # Special scope name preserves [0]-only behavior
                                    s = get_scope(
                                        "T:assistant:message.usage.iterations[0].*"
                                    )
                                    s.observe(first)
                                    # cache_creation inside iterations[0]
                                    icc = first.get("cache_creation")
                                    if isinstance(icc, dict):
                                        get_scope(
                                            "T:assistant:message.usage.iterations[0].cache_creation.*"
                                        ).observe(icc)
                            stu = usage.get("server_tool_use")
                            if isinstance(stu, dict):
                                get_scope(
                                    "T:assistant:message.usage.server_tool_use.*"
                                ).observe(stu)
                        # tool_use.input per tool name
                        if isinstance(c, list):
                            for block in c:
                                if (
                                    isinstance(block, dict)
                                    and block.get("type") == "tool_use"
                                ):
                                    name = block.get("name", "?")
                                    inp = block.get("input")
                                    if isinstance(inp, dict):
                                        get_scope(
                                            f"T:assistant:tool_use.input[{name}].*"
                                        ).observe(inp)

                # user-specific nested objects
                if t == "user":
                    if isinstance(r.get("message"), dict):
                        get_scope("T:user:message.*").observe(r["message"])
                        c = r["message"].get("content")
                        if isinstance(c, list):
                            for block in c:
                                if isinstance(block, dict):
                                    bt = block.get("type")
                                    if bt:
                                        get_scope(
                                            f"T:user:content[{bt}].*"
                                        ).observe(block)
                    if isinstance(r.get("origin"), dict):
                        get_scope("T:user:origin.*").observe(r["origin"])
                    if isinstance(r.get("toolUseResult"), dict):
                        get_scope("T:user:toolUseResult.*").observe(r["toolUseResult"])

                # attachment.*
                if t == "attachment" and isinstance(r.get("attachment"), dict):
                    get_scope("T:attachment:attachment.*").observe(r["attachment"])

                # file-history-snapshot.snapshot.*
                if (
                    t == "file-history-snapshot"
                    and isinstance(r.get("snapshot"), dict)
                ):
                    get_scope(
                        "T:file-history-snapshot:snapshot.*"
                    ).observe(r["snapshot"])

                # system/stop_hook_summary.hookInfos[0].*
                if sub == "stop_hook_summary":
                    hi = r.get("hookInfos")
                    if isinstance(hi, list) and hi and isinstance(hi[0], dict):
                        get_scope(
                            "T:system/stop_hook_summary:hookInfos[0].*"
                        ).observe(hi[0])

                # worktree-state.worktreeSession.*
                if (
                    t == "worktree-state"
                    and isinstance(r.get("worktreeSession"), dict)
                ):
                    get_scope("T:worktree-state:worktreeSession.*").observe(
                        r["worktreeSession"]
                    )

                # system/api_error.error.*
                if sub == "api_error" and isinstance(r.get("error"), dict):
                    get_scope("T:system/api_error:error.*").observe(r["error"])

                # system/compact_boundary.compactMetadata.* (and 2-level deep)
                if sub == "compact_boundary":
                    cm = r.get("compactMetadata")
                    if isinstance(cm, dict):
                        get_scope(
                            "T:system/compact_boundary:compactMetadata.*"
                        ).observe(cm)
                        ps = cm.get("preservedSegment")
                        if isinstance(ps, dict):
                            get_scope(
                                "T:system/compact_boundary:compactMetadata.preservedSegment.*"
                            ).observe(ps)
                        pm = cm.get("preservedMessages")
                        if isinstance(pm, dict):
                            get_scope(
                                "T:system/compact_boundary:compactMetadata.preservedMessages.*"
                            ).observe(pm)

    meta = {
        "pass": "A",
        "files": file_count,
        "lines": line_count,
        "malformed_count": malformed,
        "line_type_keys": dict(line_type_keys),
    }
    return {"scopes": scopes, "meta": meta}


def pass_cost():
    """Pass B: .cost.jsonl. Single shape, two indexing variants (turn-indexed / epoch-indexed)."""
    files = glob.glob(os.path.join(PROJ, "**", "*.cost.jsonl"), recursive=True)
    scope = Scope("C:cost-line.*")
    malformed = 0
    file_count = 0
    line_count = 0
    shape_split = Counter()
    for path in files:
        file_count += 1
        with open(path) as f:
            for line in f:
                line_count += 1
                try:
                    r = json.loads(line)
                except Exception:
                    malformed += 1
                    continue
                has_turn = "turn" in r
                has_epoch = "epoch" in r and "sample" in r
                if has_turn and has_epoch:
                    shape_split["both"] += 1
                elif has_turn:
                    shape_split["turn"] += 1
                elif has_epoch:
                    shape_split["epoch"] += 1
                else:
                    shape_split["core_only"] += 1
                scope.observe(r)
    meta = {
        "pass": "B",
        "files": file_count,
        "lines": line_count,
        "malformed_count": malformed,
        "shape_split": dict(shape_split),
    }
    return {"scopes": {"C:cost-line.*": scope}, "meta": meta}


def pass_turn_boundaries():
    """Pass C: .turn-boundaries.jsonl."""
    files = glob.glob(os.path.join(PROJ, "**", "*.turn-boundaries.jsonl"), recursive=True)
    scope = Scope("B:turn-boundary-line.*")
    malformed = 0
    file_count = 0
    line_count = 0
    for path in files:
        file_count += 1
        with open(path) as f:
            for line in f:
                line_count += 1
                try:
                    r = json.loads(line)
                except Exception:
                    malformed += 1
                    continue
                scope.observe(r)
    meta = {
        "pass": "C",
        "files": file_count,
        "lines": line_count,
        "malformed_count": malformed,
    }
    return {"scopes": {"B:turn-boundary-line.*": scope}, "meta": meta}


def pass_cost_log():
    """Pass D: cost-log.jsonl (single file at ~/.claude/cost-log.jsonl)."""
    scope = Scope("L:cost-log-line.*")
    malformed = 0
    line_count = 0
    if not os.path.exists(L_PATH):
        meta = {
            "pass": "D",
            "files": 0,
            "lines": 0,
            "malformed_count": 0,
            "warning": "cost-log.jsonl not found at ~/.claude/",
        }
        return {"scopes": {}, "meta": meta}
    with open(L_PATH) as f:
        for line in f:
            line_count += 1
            try:
                r = json.loads(line)
            except Exception:
                malformed += 1
                continue
            scope.observe(r)
    meta = {
        "pass": "D",
        "files": 1,
        "lines": line_count,
        "malformed_count": malformed,
    }
    return {"scopes": {"L:cost-log-line.*": scope}, "meta": meta}


def main():
    p = argparse.ArgumentParser(
        description="claude-lens field inventory survey — emits structured JSON to stdout"
    )
    p.add_argument("--pretty", action="store_true", help="indent JSON for human review")
    p.add_argument("--out", help="write to a file (default: stdout)")
    args = p.parse_args()

    results = {
        "A_transcript": pass_transcript(),
        "B_cost": pass_cost(),
        "C_turn_boundaries": pass_turn_boundaries(),
        "D_cost_log": pass_cost_log(),
    }

    # Flatten scopes into record list
    records = []
    metas = {}
    for pass_key, payload in results.items():
        metas[pass_key] = payload["meta"]
        for scope_name, scope in payload["scopes"].items():
            records.extend(scope.records())

    output = {
        "meta": metas,
        "records": records,
    }

    text = json.dumps(output, indent=2 if args.pretty else None, default=str)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
        print(f"wrote {args.out} ({len(text)} chars)", file=sys.stderr)
    else:
        sys.stdout.write(text)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()