// The plugin's colours stay soft in both styles: no pure black or white text, JetBrains tokens complete.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tokens } from "../client/theme";

const theme = (light: boolean) =>
  ({
    colors: light
      ? { surface0: "#ffffff", surface1: "#f6f7f9", surface2: "#eceef1", border: "#dde0e5", foreground: "#000000", foregroundMuted: "#5b6370", accent: "#3b82f6", accentForeground: "#ffffff" }
      : { surface0: "#0b0c0e", surface1: "#15171b", surface2: "#1d2026", border: "#2a2e35", foreground: "#ffffff", foregroundMuted: "#9aa1ad", accent: "#3b82f6", accentForeground: "#ffffff" },
  }) as unknown as Parameters<typeof tokens>[0];

const PURE = /^#(000000|000|ffffff|fff)$/i;

test("text colours are never pure black or white, in either style or theme", () => {
  for (const light of [false, true]) {
    for (const style of ["kraken", "jetbrains"] as const) {
      const t = tokens(theme(light), style);
      for (const k of ["text", "strong"] as const) assert.doesNotMatch(t[k], PURE, `${style} ${light ? "light" : "dark"} ${k}: ${t[k]}`);
      assert.equal(t.light, light);
      assert.equal(t.style, style);
    }
  }
});

test("JetBrains tokens use the Islands palette; Kraken keeps the host surfaces", () => {
  const jb = tokens(theme(false), "jetbrains");
  assert.equal(jb.bg, jb.jb.island);
  assert.equal(jb.select, jb.jb.treeSelected);
  assert.equal(jb.jb.island, "#191a1c");
  assert.equal(tokens(theme(true), "jetbrains").jb.island, "#fbfbfc", "light island is off-white, not #fff");
  const kraken = tokens(theme(false), "kraken");
  assert.equal(kraken.bg, "#0b0c0e");
  assert.equal(kraken.select, "#313b4e");
});
