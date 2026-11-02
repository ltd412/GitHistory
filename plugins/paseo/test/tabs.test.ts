// Saved project tabs survive a reload: what is written is read back; a missing or corrupt file is empty.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { legacyTabsFile, readTabs, tabsFile, writeTabs } from "../server/tabs";

test("tabs are written atomically and read back; bad files read as empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "githistory-tabs-"));
  try {
    const file = tabsFile({ PASEO_HOME: dir });
    const legacy = legacyTabsFile({ PASEO_HOME: dir });
    assert.equal(file, path.join(dir, "plugin-data", "githistory", "tabs.json"));
    assert.deepEqual(readTabs(file, legacy), { tabs: [], active: null });
    // Tabs saved under the old plugin id are picked up until the first save under the new one.
    const old = { tabs: [{ ref: { kind: "workspace" as const, id: "w1" }, title: "old" }], active: "ws:w1" };
    writeTabs(old, legacy);
    assert.deepEqual(readTabs(file, legacy), old);
    const state = { tabs: [{ ref: { kind: "path" as const, path: "/repo" }, title: "repo" }], active: "dir:/repo" };
    writeTabs(state, file);
    assert.deepEqual(readTabs(file, legacy), state, "the new file wins once written");
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["tabs.json"], "no temp file left");
    fs.writeFileSync(file, "{not json");
    assert.deepEqual(readTabs(file), { tabs: [], active: null });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the chosen interface style is saved with the tabs; files without it, or with a bad one, have none", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "githistory-tabs-style-"));
  try {
    const file = tabsFile({ PASEO_HOME: dir });
    const legacy = legacyTabsFile({ PASEO_HOME: dir });
    writeTabs({ tabs: [], active: null, style: "jetbrains" }, file);
    assert.deepEqual(readTabs(file, legacy), { tabs: [], active: null, style: "jetbrains" });
    // Choosing again replaces it; clearing it (null) leaves no style behind.
    writeTabs({ tabs: [], active: null, style: "kraken" }, file);
    assert.equal(readTabs(file, legacy).style, "kraken");
    writeTabs({ tabs: [], active: null, style: null }, file);
    assert.deepEqual(readTabs(file, legacy), { tabs: [], active: null });
    // A file from an older plugin (no style) or a hand-edited bad value reads as "not chosen yet".
    fs.writeFileSync(file, JSON.stringify({ version: 1, tabs: [], active: null }));
    assert.equal(readTabs(file, legacy).style, undefined);
    fs.writeFileSync(file, JSON.stringify({ version: 1, tabs: [], active: null, style: "rainbow" }));
    assert.equal(readTabs(file, legacy).style, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
