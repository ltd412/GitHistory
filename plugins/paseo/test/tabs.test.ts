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
