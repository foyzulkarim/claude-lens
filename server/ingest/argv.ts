/**
 * Parses the `--roots` flag from `process.argv`, accumulating all values.
 * Mirrors the `--roots` branch of `server/cli.ts`'s `parseArgs`. Both
 * forms (`--roots a b c` and `--roots=a`) are accepted; repeats
 * accumulate; positional-value consumption stops at the next
 * `--`-prefixed token. No commander per architecture §1.
 *
 * Returns the collected roots and a `Set<number>` of argv indices that
 * were consumed. The benchmark tool just needs `.roots`; `cli.ts`'s
 * `parseArgs` uses both so its main loop can skip already-processed
 * `--roots` tokens without double-handling them.
 */
export function parseRootsFlag(argv: string[]): {
  roots: string[];
  skipIndices: Set<number>;
} {
  const roots: string[] = [];
  const skipIndices = new Set<number>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.split("=", 2);
    if (flag !== "--roots") continue;
    skipIndices.add(i);
    if (inlineValue) roots.push(inlineValue);
    let j = i + 1;
    while (argv[j] && !argv[j].startsWith("--")) {
      skipIndices.add(j);
      roots.push(argv[j]);
      j++;
    }
    i = j - 1;
  }
  return { roots, skipIndices };
}
