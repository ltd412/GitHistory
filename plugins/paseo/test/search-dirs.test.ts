// Project picker search: name search under home ranks name matches first and skips noise; path input completes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { searchDirs } from "../server/search-dirs";

test("search finds repos by name under home, skips hidden/node_modules, completes paths", async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "githistory-home-")));
  // os.homedir() reads HOME on macOS/Linux and USERPROFILE on Windows.
  const old = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    for (const d of ["work/gitkraken/.git", "work/gitkraken/src", "work/other/node_modules/gitkraken-x", ".hidden/gitkraken", "gitkraken-notes"])
      fs.mkdirSync(path.join(home, d), { recursive: true });
    const d = (...parts: string[]) => ["~", ...parts].join(path.sep);
    const r = await searchDirs({ query: "gitkra" });
    const shown = r.entries.map((e) => e.display);
    assert.deepEqual(shown.slice(0, 2), [d("gitkraken-notes"), d("work", "gitkraken")], "name matches first, shallower first");
    assert.ok(shown.includes(d("work", "gitkraken", "src")), "path matches follow");
    assert.ok(!shown.some((s) => s.includes("node_modules") || s.includes(".hidden")));
    assert.equal(r.entries.find((e) => e.display === d("work", "gitkraken"))?.isRepo, true);
    assert.deepEqual((await searchDirs({ query: "~/work/g" })).entries.map((e) => e.display), [d("work", "gitkraken")]);
    assert.deepEqual((await searchDirs({ query: "~/work/" })).entries.map((e) => e.display), [d("work", "gitkraken"), d("work", "other")]);
    assert.deepEqual((await searchDirs({ query: "" })).entries, []);
  } finally {
    process.env.HOME = old.HOME;
    process.env.USERPROFILE = old.USERPROFILE;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
