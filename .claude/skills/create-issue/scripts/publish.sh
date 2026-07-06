#!/usr/bin/env bash
# Publish issue drafts from specs/issues/ to GitHub in one sequential run.
# Files every draft with `status: ready`, in natural sort order (P0-2 before P0-10),
# then rewrites its frontmatter to `status: filed` + issue number + URL so the
# draft becomes a frozen local record of what was published.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
drafts_dir="$repo_root/specs/issues"
[ -d "$drafts_dir" ] || { echo "no drafts directory at $drafts_dir" >&2; exit 1; }

filed=0
for f in $(ls "$drafts_dir"/*.md 2>/dev/null | sort -V); do
  status=$(sed -n 's/^status:[[:space:]]*//p' "$f" | head -1)
  [ "$status" = "ready" ] || continue

  title=$(sed -n 's/^title:[[:space:]]*//p' "$f" | head -1 | sed 's/^"\(.*\)"$/\1/')
  labels=$(sed -n 's/^labels:[[:space:]]*//p' "$f" | head -1)
  milestone=$(sed -n 's/^milestone:[[:space:]]*//p' "$f" | head -1)
  [ -n "$title" ] || { echo "skipping $f: no title in frontmatter" >&2; continue; }

  body=$(mktemp)
  # everything after the closing `---` of the frontmatter
  awk '/^---$/{c++; if(c<=2) next} c>=2' "$f" > "$body"

  args=(--title "$title" --body-file "$body")
  [ -n "$labels" ] && args+=(--label "$labels")
  [ -n "$milestone" ] && args+=(--milestone "$milestone")

  echo "filing: $title"
  url=$(gh issue create "${args[@]}")
  num=${url##*/}

  perl -pi -e "s|^status:[ \t]*ready[ \t]*\$|status: filed\nissue: $num\nurl: $url|" "$f"
  rm -f "$body"
  filed=$((filed + 1))
  echo "  → $url"
  sleep 2 # stay under GitHub's secondary rate limits on rapid creates
done

echo "$filed issue(s) filed."
