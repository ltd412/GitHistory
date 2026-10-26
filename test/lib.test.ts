import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodes, firstParentChain, layoutGraph, WIP_HASH } from '../core/graph.ts';
import { buildPatch, parseConflicts, parseDiff, splitRows } from '../core/diff.ts';

const c = (hash: string, parents: string[] = []) => ({ hash, parents, author: 'a', email: 'e', time: 0, subject: hash });

test('linear history stays in lane 0 with straight edges', () => {
  const { rows, edges } = layoutGraph([c('c', ['b']), c('b', ['a']), c('a')]);
  assert.deepEqual(rows.map((r) => r.col), [0, 0, 0]);
  assert.deepEqual(edges.map((e) => [e.from, e.to, e.fromCol, e.lane, e.toCol]), [
    [0, 1, 0, 0, 0],
    [1, 2, 0, 0, 0],
  ]);
});

test('merge edge bends out into the branch lane and the branch rejoins at the fork point', () => {
  // m merges f into main; f and b both descend from a.
  const { rows, edges } = layoutGraph([c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')]);
  assert.deepEqual(rows.map((r) => r.col), [0, 1, 0, 0], 'mainline stays leftmost');
  const merge = edges.find((e) => e.from === 0 && e.to === 1)!;
  assert.deepEqual([merge.fromCol, merge.lane, merge.toCol], [0, 1, 1], 'bends at the merge commit');
  const rejoin = edges.find((e) => e.from === 1 && e.to === 3)!;
  assert.deepEqual([rejoin.fromCol, rejoin.lane, rejoin.toCol], [1, 1, 0], 'bends into the fork point');
});

test('a branch runs down its own lane and joins at the fork point', () => {
  const { rows, edges } = layoutGraph([c('x', ['a']), c('y', ['a']), c('a')]);
  assert.deepEqual(rows.map((r) => r.col), [0, 1, 0]);
  const e = edges.find((x) => x.from === 1)!;
  assert.deepEqual([e.fromCol, e.lane, e.toCol], [1, 1, 0], 'straight down lane 1, turning in at the fork point');
});

test('the mainline never joins a lane to its right', () => {
  // f (right) waits for a; when mainline b also needs a it keeps lane 0.
  const { rows } = layoutGraph([c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')]);
  assert.deepEqual(rows.map((r) => r.col), [0, 1, 0, 0]);
});

test('parents outside the loaded page run off the bottom in their lane', () => {
  const { edges } = layoutGraph([c('b', ['a'])]);
  assert.deepEqual(edges, [{ from: 0, to: 1, fromCol: 0, toCol: 0, lane: 0, color: 0, dashed: false }]);
});

test('WIP during a merge has both HEAD and MERGE_HEAD as parents', () => {
  const nodes = buildNodes([c('h', ['a']), c('m', ['a']), c('a')], { headSha: 'h', mergeHead: 'm', wip: true, stashes: [] });
  assert.deepEqual(nodes[0].parents, ['h', 'm']);
});

test('buildNodes places WIP on top and stashes above their base', () => {
  const nodes = buildNodes([c('b', ['a']), c('a')], {
    headSha: 'b',
    wip: true,
    stashes: [{ hash: 's', base: 'a', index: 0, message: 'stash', time: 0 }],
  });
  assert.deepEqual(nodes.map((n) => n.hash), [WIP_HASH, 'b', 's', 'a']);
  const { rows } = layoutGraph(nodes);
  assert.equal(rows[0].col, rows[1].col, 'WIP shares the HEAD lane');
});

const DIFF = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -1,4 +1,4 @@
 one
-two
-three
+TWO
+THREE
 four
`;

test('parseDiff numbers lines', () => {
  const d = parseDiff(DIFF);
  assert.equal(d.hunks.length, 1);
  const h = d.hunks[0];
  assert.deepEqual(h.lines.map((l) => [l.type, l.oldNo, l.newNo]), [
    [' ', 1, 1],
    ['-', 2, null],
    ['-', 3, null],
    ['+', null, 2],
    ['+', null, 3],
    [' ', 4, 4],
  ]);
});

test('buildPatch forward keeps unselected removals as context and drops unselected additions', () => {
  const d = parseDiff(DIFF);
  // Select only "-two" (index 1) and "+TWO" (index 3).
  const p = buildPatch(d, d.hunks[0], new Set([1, 3]), false);
  const body = p.split('\n').filter((l) => /^[ +\-]/.test(l) && !l.startsWith('---') && !l.startsWith('+++'));
  assert.deepEqual(body, [' one', '-two', '+TWO', ' three', ' four']);
  assert.match(p, /@@ -1,4 \+1,4 @@/);
});

test('buildPatch reverse keeps unselected additions as context and drops unselected removals', () => {
  const d = parseDiff(DIFF);
  const p = buildPatch(d, d.hunks[0], new Set([1, 3]), true);
  const body = p.split('\n').filter((l) => /^[ +\-]/.test(l) && !l.startsWith('---') && !l.startsWith('+++'));
  assert.deepEqual(body, [' one', '-two', '+TWO', ' THREE', ' four']);
});

test('buildPatch selecting only the second pair keeps the first line in place', () => {
  const d = parseDiff(DIFF);
  const p = buildPatch(d, d.hunks[0], new Set([2, 4]), false);
  const body = p.split('\n').filter((l) => /^[ +\-]/.test(l) && !l.startsWith('---') && !l.startsWith('+++'));
  assert.deepEqual(body, [' one', ' two', '-three', '+THREE', ' four']);
});

test('buildPatch keeps the no-newline marker with its line', () => {
  const d = parseDiff('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n');
  const p = buildPatch(d, d.hunks[0], null, false);
  assert.match(p, /-old\n\\ No newline at end of file\n\+new\n\\ No newline at end of file/);
});

test('splitRows pairs removals with additions', () => {
  const d = parseDiff(DIFF);
  const rows = splitRows(d.hunks[0]);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].left?.text, 'two');
  assert.equal(rows[1].right?.text, 'TWO');
});

test('parseConflicts splits markers, including diff3 base sections', () => {
  const chunks = parseConflicts(['a', '<<<<<<< HEAD', 'ours', '||||||| base', 'orig', '=======', 'theirs', '>>>>>>> feat', 'z'].join('\n'));
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[1], { kind: 'conflict', ours: ['ours'], base: ['orig'], theirs: ['theirs'], oursLabel: 'HEAD', theirsLabel: 'feat' });
});

test('wordDiff marks only the changed words of a similar line', async () => {
  const { wordDiff } = await import('../core/diff.ts');
  const wd = wordDiff('const total = price * qty;', 'const total = price * quantity;')!;
  assert.deepEqual(wd.left.filter((s) => s.changed).map((s) => s.text), ['qty']);
  assert.deepEqual(wd.right.filter((s) => s.changed).map((s) => s.text), ['quantity']);
  assert.equal(wd.left.map((s) => s.text).join(''), 'const total = price * qty;');
});

test('wordDiff gives up on unrelated lines', async () => {
  const { wordDiff } = await import('../core/diff.ts');
  assert.equal(wordDiff('import fs from "fs";', 'return result.map(transform);'), null);
});

test('pairLines pairs the k-th removal with the k-th addition', async () => {
  const { pairLines } = await import('../core/diff.ts');
  const d = parseDiff(DIFF);
  const p = pairLines(d.hunks[0]);
  assert.equal(p.get(1), 3);
  assert.equal(p.get(4), 2);
  assert.equal(p.has(0), false);
});

test('merge tool: apply/ignore sides, base shown until a side is chosen', async () => {
  const m = await import('../core/merge.ts');
  const chunks = parseConflicts(['top', '<<<<<<< ours', 'A', '||||||| base', 'B', '=======', 'C', '>>>>>>> theirs', 'end'].join('\n'));
  let rs = m.initialResolutions(chunks);
  assert.equal(m.buildOutput(chunks, rs), 'top\nB\nend', 'unresolved conflict shows the base');
  assert.equal(m.isResolved(rs[0]), false);
  rs = [m.applySide(rs[0], 'theirs')];
  rs = [m.applySide(rs[0], 'ours')];
  assert.equal(m.buildOutput(chunks, rs), 'top\nC\nA\nend', 'both sides kept in click order');
  assert.equal(m.isResolved(rs[0]), true);
  rs = [m.ignoreSide(rs[0], 'theirs')];
  assert.equal(m.buildOutput(chunks, rs), 'top\nA\nend');
  rs = [{ ...rs[0], manual: 'hand\nedited' }];
  assert.equal(m.buildOutput(chunks, rs), 'top\nhand\nedited\nend', 'manual edit wins');
  assert.equal(m.buildOutput(chunks, m.acceptAll(rs, 'theirs')), 'top\nC\nend');
  const ignoredBoth = [m.ignoreSide(m.ignoreSide(m.initialResolutions(chunks)[0], 'ours'), 'theirs')];
  assert.ok(m.isResolved(ignoredBoth[0]));
  assert.equal(m.buildOutput(chunks, ignoredBoth), 'top\nB\nend', 'ignoring both keeps the base');
});

test('the checked-out branch keeps lane 0 even when another tip comes first', () => {
  // other (newer tip) and head both descend from a; head is checked out.
  const nodes = [c('other', ['a']), c('head', ['a']), c('a')];
  const { rows } = layoutGraph(nodes, { mainChain: firstParentChain(nodes, 'head') });
  assert.deepEqual(rows.map((r) => r.col), [1, 0, 0]);
});

test('a merge of a branch with no lane yet opens one to the right', () => {
  // main (lane 0) merges f; the merge parent f sits on a lane opened to the right.
  const nodes = [c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')];
  const { edges } = layoutGraph(nodes, { mainChain: firstParentChain(nodes, 'm') });
  for (const e of edges) assert.ok(e.lane >= e.fromCol, `edge ${e.from}->${e.to} turns left out of its commit`);
});

test('a merged branch that already has a lane runs up it and curves into the merge commit', () => {
  // r (release, lane 1) merges d, whose branch develop (lane 0) is already waiting for:
  // the edge rides lane 0 and turns at r's row, not at d's.
  const nodes = [c('dev', ['d']), c('r', ['r0', 'd']), c('d', ['base']), c('r0', ['base']), c('base')];
  const { rows, edges } = layoutGraph(nodes, { mainChain: firstParentChain(nodes, 'dev') });
  assert.equal(rows[1].col, 1);
  const merge = edges.find((e) => e.from === 1 && e.to === 2)!;
  assert.deepEqual([merge.fromCol, merge.lane, merge.toCol], [1, 0, 0]);
});

test('theme schedule: light between the two times, dark otherwise', async () => {
  const { isLightAt, effectiveTheme } = await import('../core/theme.ts');
  const at = (h: number, m = 0) => h * 60 + m;
  assert.equal(isLightAt('06:00', '18:00', at(5, 59)), false);
  assert.equal(isLightAt('06:00', '18:00', at(6, 0)), true);
  assert.equal(isLightAt('06:00', '18:00', at(17, 59)), true);
  assert.equal(isLightAt('06:00', '18:00', at(18, 0)), false);
  // A window that wraps past midnight.
  assert.equal(isLightAt('20:00', '08:00', at(23)), true);
  assert.equal(isLightAt('20:00', '08:00', at(7, 59)), true);
  assert.equal(isLightAt('20:00', '08:00', at(12)), false);
  // Garbage falls back to 06:00–18:00.
  assert.equal(isLightAt('nope', '??', at(12)), true);
  const now = new Date(2026, 9, 26, 21, 0);
  assert.equal(effectiveTheme('schedule', { systemDark: false, now, lightFrom: '06:00', darkFrom: '18:00' }), 'dark');
  assert.equal(effectiveTheme('system', { systemDark: false, now, lightFrom: '06:00', darkFrom: '18:00' }), 'light');
  assert.equal(effectiveTheme('dark', { systemDark: false, now, lightFrom: '06:00', darkFrom: '18:00' }), 'dark');
});

test('rowSvg: each row is a valid Paseo inline icon and carries every edge crossing it', async () => {
  const { rowSvg, NORMAL } = await import('../core/graph-draw.ts');
  const { findSvgIconProblem } = await import('../plugins/paseo/node_modules/@getpaseo/plugin/dist/icons.js');
  // m merges f into main; f and b both descend from a.
  const nodes = [c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')];
  const layout = layoutGraph(nodes);
  const opts = { m: NORMAL, width: 120, scrollX: 0, contentW: 80, bg: '#000', labelled: (h: string) => h === 'm' };
  for (let i = 0; i < nodes.length; i++) {
    const svg = rowSvg(layout, nodes, i, opts);
    assert.equal(findSvgIconProblem(svg), null, `row ${i}`);
    const crossing = layout.edges.filter((e) => e.from <= i && e.to >= i).length;
    assert.equal((svg.match(/<path /g) ?? []).length, crossing, `row ${i} edges`);
  }
  assert.match(rowSvg(layout, nodes, 0, opts), /<line /, 'checked-out branch gets its connector');
  assert.doesNotMatch(rowSvg(layout, nodes, 1, opts), /<line /);
  assert.match(rowSvg(layout, nodes, 0, opts), /viewBox="0 0 120 28" preserveAspectRatio="xMinYMin meet"/, 'row-sized canvas, never scaled');
  const scrolled = rowSvg(layout, nodes, 0, { ...opts, width: 40, scrollX: 24 });
  assert.match(scrolled, /translate\(-24 0\)/, 'lanes shift by the scroll offset');
  assert.doesNotMatch(scrolled, /id=|url\(#/, 'no document-wide ids: many row SVGs share one page');
});

test('rowSvg escapes author initials', async () => {
  const { rowSvg, NORMAL } = await import('../core/graph-draw.ts');
  const nodes = [{ ...c('x'), author: '<b> &' }];
  const svg = rowSvg(layoutGraph(nodes), nodes, 0, { m: NORMAL, width: 60, scrollX: 0, contentW: 60, bg: '#000', labelled: () => false });
  assert.doesNotMatch(svg, /<b>/);
});

test('createRowSvgCache draws each row exactly like rowSvg at full width, and only once', async () => {
  const { createRowSvgCache, rowSvg, NORMAL } = await import('../core/graph-draw.ts');
  const nodes = [c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')];
  const layout = layoutGraph(nodes);
  const o = { m: NORMAL, contentW: 90, bg: '#000', labelled: (h: string) => h === 'm' };
  const svgFor = createRowSvgCache(layout, nodes, o);
  for (let i = 0; i < nodes.length; i++) assert.equal(svgFor(i), rowSvg(layout, nodes, i, { ...o, width: 90, scrollX: 0 }), `row ${i}`);
  assert.equal(svgFor(1), svgFor(1));
});

test('flattenPath keeps straight runs whole and splits curves into chords', async () => {
  const { flattenPath } = await import('../core/graph-draw.ts');
  const lines = flattenPath('M10 0H30V50C30 60 40 70 50 70');
  assert.deepEqual(lines[0], [[10, 0], [30, 0]]);
  assert.deepEqual(lines[1], [[30, 0], [30, 50]]);
  assert.equal(lines.length, 2 + 6);
  assert.deepEqual(lines[lines.length - 1][1], [50, 70]);
});

test('row shapes: every crossing edge contributes segments clipped to the row, plus its node', async () => {
  const { createRowShapesCache, NORMAL } = await import('../core/graph-draw.ts');
  const nodes = [c('m', ['b', 'f']), c('f', ['a']), c('b', ['a']), c('a')];
  const layout = layoutGraph(nodes);
  const shapes = createRowShapesCache(layout, nodes, { m: NORMAL, contentW: 90, bg: '#000', labelled: (h: string) => h === 'm' });
  for (let i = 0; i < nodes.length; i++) {
    const { segments, node } = shapes(i);
    for (const s of segments) for (const y of [s.y1, s.y2]) assert.ok(y >= 0 && y <= NORMAL.row, `row ${i} y=${y}`);
    assert.equal(node.y, NORMAL.row / 2);
    if (layout.edges.some((e) => e.from <= i && e.to >= i)) assert.ok(segments.length > 0, `row ${i} has edges`);
  }
  assert.equal(shapes(0).node.kind, 'merge');
  assert.equal(shapes(1).node.kind, 'avatar');
  assert.ok(shapes(0).segments.some((s) => s.x1 === 0 && s.y1 === s.y2), 'connector of the checked-out branch');
});

test('shortcut labels: macOS glyphs on macOS, Ctrl/Shift/Alt elsewhere', async () => {
  const { formatKeys } = await import('../src/lib/keys.ts');
  assert.equal(formatKeys('⇧⌘S', true), '⇧⌘S');
  assert.equal(formatKeys('⇧⌘S', false), 'Ctrl+Shift+S');
  assert.equal(formatKeys('⌥T', false), 'Alt+T');
  assert.equal(formatKeys('⌘,', false), 'Ctrl+,');
  assert.equal(formatKeys('Merged dev — ⌘Z to undo', false), 'Merged dev — Ctrl+Z to undo');
  assert.equal(formatKeys('Tip: ⌘-click two commits, or ⌘P', false), 'Tip: Ctrl-click two commits, or Ctrl+P');
});
