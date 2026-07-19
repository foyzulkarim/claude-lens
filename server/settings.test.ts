import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "./settings.js";

describe("readConfig / writeConfig", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "claude-lens-settings-"));
    configPath = join(dir, "nested", "config.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the default when the file does not exist", async () => {
    expect(await readConfig(configPath)).toEqual({ budget: null });
  });

  it("returns the default when the file is unparseable JSON", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(configPath, "not json", "utf8");
    expect(await readConfig(configPath)).toEqual({ budget: null });
  });

  it("returns the default when the file is valid JSON but not an object", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(configPath, JSON.stringify([1, 2, 3]), "utf8");
    expect(await readConfig(configPath)).toEqual({ budget: null });
  });

  it("writeConfig creates the file (and parent dir) and persists the patch", async () => {
    const result = await writeConfig({ budget: 300 }, configPath);
    expect(result).toEqual({ budget: 300 });
    expect(await readConfig(configPath)).toEqual({ budget: 300 });
  });

  it("writeConfig merges onto existing content rather than replacing it", async () => {
    await writeConfig({ budget: 300 }, configPath);
    // Simulate a future field #P4-15 might add, written directly to disk.
    const { readFile, writeFile } = await import("node:fs/promises");
    const onDisk = JSON.parse(await readFile(configPath, "utf8"));
    onDisk.pricingLabel = "custom";
    await writeFile(configPath, JSON.stringify(onDisk), "utf8");

    const result = await writeConfig({ budget: 500 }, configPath);
    expect(result).toEqual({ budget: 500, pricingLabel: "custom" });
    expect(await readConfig(configPath)).toEqual({ budget: 500, pricingLabel: "custom" });
  });

  it("writeConfig({ budget: null }) clears a previously set budget", async () => {
    await writeConfig({ budget: 300 }, configPath);
    const result = await writeConfig({ budget: null }, configPath);
    expect(result).toEqual({ budget: null });
  });
});
