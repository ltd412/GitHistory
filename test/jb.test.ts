import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLogFilter, buildBranchTree, buildFileTree, jbTime, NO_FILTER, reachableFrom, refTarget, rewriteParents } from '../core/jb.ts';
import type { Commit, Refs } from '../core/types.ts';

const c = (hash: string, parents: string[] = [], over: Partial<Commit> = {}): Commit => ({ hash, parents, author: 'Ann', email: 'ann@x', time: 1000, subject: `msg ${hash}`, ...over });
const refs = (over: Partial<Refs> = {}): Refs => ({ local: [], remote: [], tags: [], head: 'main', headSha: 'd', headDetached: false, ...over });

test('file tree: folders first, single-child folder chains merged, counts', () => {
  const tree = buildFileTree([{ path: 'README.md' }, { path: 'src/main/java/A.java' }, { path: 'src/main/java/B.java' }, { path: 'docs/a.md' }, { path: 'docs/z/b.md' }]);
  assert.deepEqual(tree.map((n) => [n.name, n.dir, n.count]), [['docs', true, 2], ['src/main/java', true, 2], ['README.md', false, 1]]);
  assert.equal(tree[1].path, 'src/main/java');
  assert.deepEqual(tree[0].children.map((n) => n.name), ['z', 'a.md']);
});

test('branch tree: HEAD, local folders, remotes grouped by remote, tags; query prunes', () => {
  const r = refs({
    local: [
      { name: 'main', target: 'd', upstream: 'origin/main', upstreamGone: false, ahead: 0, behind: 0, current: true },
      { name: 'feature/login', target: 'c', upstream: null, upstreamGone: false, ahead: 0, behind: 0, current: false },
    ],
    remote: [{ name: 'origin/main', remote: 'origin', branch: 'main', target: 'd' }, { name: 'origin/HEAD', remote: 'origin', branch: 'HEAD', target: 'd' }],
    tags: [{ name: 'v1', target: 'a', annotated: false }],
  });
  const tree = buildBranchTree(r);
  assert.deepEqual(tree.map((n) => n.label), ['HEAD (Current Branch)', 'Local', 'Remote', 'Tags']);
  assert.deepEqual(tree[1].children.map((n) => [n.label, n.kind]), [['feature', 'folder'], ['main', 'local']]);
  assert.equal(tree[1].children[0].children[0].ref, 'feature/login');
  assert.deepEqual(tree[2].children[0].children.map((n) => n.ref), ['origin/main'], 'origin/HEAD is hidden');
  const q = buildBranchTree(r, 'login');
  assert.deepEqual(q.map((n) => n.label), ['Local']);
  assert.equal(q[0].children[0].children[0].ref, 'feature/login');
});

test('reachableFrom follows parents among loaded commits', () => {
  const log = [c('d', ['b', 'c']), c('c', ['a']), c('b', ['a']), c('a')];
  assert.deepEqual([...reachableFrom(log, 'c')].sort(), ['a', 'c']);
  assert.equal(refTarget(refs({ tags: [{ name: 'v1', target: 'a', annotated: false }] }), 'v1'), 'a');
});

test('rewriteParents attaches to the nearest kept ancestors across hidden commits', () => {
  // d merges b and c; b -> a, c -> a. Hide b: d keeps parents [a (via b), c].
  const log = [c('d', ['b', 'c']), c('c', ['a']), c('b', ['a']), c('a')];
  const out = rewriteParents(log, new Set(['d', 'c', 'a']));
  assert.deepEqual(out.map((x) => [x.hash, x.parents]), [['d', ['a', 'c']], ['c', ['a']], ['a', []]]);
  // Linear chain with the middle hidden.
  assert.deepEqual(rewriteParents([c('z', ['y']), c('y', ['x']), c('x')], new Set(['z', 'x'])).map((x) => x.parents), [['x'], []]);
});

test('log filter: author, date, text and branch compose; no filter returns the same array', () => {
  const now = 100 * 86400 * 1000;
  const log = [
    c('d', ['c'], { time: 99 * 86400, author: 'Bob', email: 'bob@x' }),
    c('c', ['b'], { time: 98 * 86400 }),
    c('b', ['a'], { time: 10 * 86400, subject: 'fix login' }),
    c('a', [], { time: 5 * 86400 }),
  ];
  const r = refs({ headSha: 'c' });
  assert.equal(applyLogFilter(log, NO_FILTER, r, now), log);
  assert.deepEqual(applyLogFilter(log, { ...NO_FILTER, author: 'bob@x' }, r, now).map((x) => x.hash), ['d']);
  assert.deepEqual(applyLogFilter(log, { ...NO_FILTER, days: 7 }, r, now).map((x) => [x.hash, x.parents]), [['d', ['c']], ['c', []]]);
  assert.deepEqual(applyLogFilter(log, { ...NO_FILTER, text: 'login' }, r, now).map((x) => x.hash), ['b']);
  assert.deepEqual(applyLogFilter(log, { ...NO_FILTER, branch: 'HEAD' }, r, now).map((x) => x.hash), ['c', 'b', 'a']);
  assert.deepEqual(applyLogFilter(log, { ...NO_FILTER, branch: 'nope' }, r, now), []);
});

test('jbTime: Today / Yesterday / short date', () => {
  const now = new Date(2026, 9, 30, 15, 0).getTime();
  const at = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m, d, h, mi).getTime() / 1000;
  assert.equal(jbTime(at(2026, 9, 30, 9, 5), now), 'Today 09:05');
  assert.equal(jbTime(at(2026, 9, 29, 23, 59), now), 'Yesterday 23:59');
  assert.equal(jbTime(at(2026, 8, 2, 8, 0), now), '02/09/26 08:00');
});

// ---------------------------------------------------------------- graph rows for the plugin (no CSS variables)

import { JB_LANE, JB_LANE_HEX, JB_ROW, computeJbGraph, hideLongEdges, jbRowShapes, jbRowSvg, jbRowWidth } from '../core/jb-graph.ts';

const fork = () => computeJbGraph([{ id: 'm', parents: ['b', 'f'] }, { id: 'f', parents: ['a'] }, { id: 'b', parents: ['a'] }, { id: 'a', parents: [] }]).rows;

test('jbRowSvg: valid Paseo inline icon, hex colours only, one path per segment', async () => {
  const { findSvgIconProblem } = await import('../plugins/paseo/node_modules/@getpaseo/plugin/dist/icons.js');
  const rows = fork();
  for (const theme of ['dark', 'light'] as const) {
    rows.forEach((row, i) => {
      const svg = jbRowSvg(row, { theme, bg: '#191a1c', head: i === 0 });
      assert.equal(findSvgIconProblem(svg), null, `${theme} row ${i}`);
      assert.equal((svg.match(/<path /g) ?? []).length, row.up.length + row.down.length, `${theme} row ${i} segments`);
      assert.doesNotMatch(svg, /var\(|id=|url\(#|<style|<script/, 'self-contained: no CSS variables, ids or styles');
      assert.match(svg, new RegExp(`width="${jbRowWidth(row)}" height="${JB_ROW}"`));
    });
  }
  // HEAD is a ring plus a dot; a plain commit is one dot; WIP / stash are dashed rings.
  const row = rows[1];
  assert.equal((jbRowSvg(row, { theme: 'dark', bg: '#000', head: true }).match(/<circle /g) ?? []).length, 2);
  assert.equal((jbRowSvg(row, { theme: 'dark', bg: '#000' }).match(/<circle /g) ?? []).length, 1);
  assert.match(jbRowSvg(row, { theme: 'dark', bg: '#000', dashedNode: true }), /stroke-dasharray="2 1.6"/);
});

test('jbRowWidth is one lane per slot, capped; a lane running through 40 rows is cut and ends in arrows', () => {
  const rows = fork();
  assert.equal(jbRowWidth(rows[0]), rows[0].width * JB_LANE);
  assert.equal(jbRowWidth({ ...rows[0], width: 99 }), 24 * JB_LANE);
  // top merges the main chain m0..m39 and a side branch s whose lane runs alongside all of it down to m40.
  const log = [
    { id: 'top', parents: ['m0', 's'] },
    ...Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, parents: [`m${i + 1}`] })),
    { id: 's', parents: ['m40'] },
    { id: 'm40', parents: [] },
  ];
  const all = computeJbGraph(log).rows;
  const cut = hideLongEdges(all, 30);
  const count = (r: typeof all) => r.reduce((n, row) => n + row.up.length + row.down.length, 0);
  assert.ok(count(cut) < count(all), 'the middle of the long lane is not drawn');
  assert.ok(cut.some((r) => r.down.some((x) => x.arrow === 'down')), 'a stub ends in a down arrow');
  assert.ok(cut.some((r) => r.up.some((x) => x.arrow === 'up')), 'the other end starts with an up arrow');
  assert.match(jbRowSvg(cut.find((r) => r.down.some((x) => x.arrow === 'down'))!, { theme: 'dark', bg: '#000' }), /L\d+ \d+M|M[\d. ]+L[\d. ]+M/, 'arrow heads are drawn');
});

test('jbRowShapes: the same row as straight strokes that join the same ends', () => {
  const rows = fork();
  const shapes = jbRowShapes(rows[0], { theme: 'dark', bg: '#000', head: true });
  assert.equal(shapes.node.ring, true);
  assert.equal(shapes.node.r, 5);
  // The merge row curves one lane over: chords start on lane 0 / lane 1 and end on the other lane.
  const xs = new Set(shapes.segments.flatMap((s) => [s.x1, s.x2]));
  assert.ok(xs.has(7) && xs.has(21), 'both lanes are touched');
  for (const s of shapes.segments) assert.ok(s.y1 >= 0 && s.y2 <= JB_ROW, 'strokes stay inside the row');
  // A straight lane is one whole stroke, not chopped chords.
  const linear = computeJbGraph([{ id: 'b', parents: ['a'] }, { id: 'a', parents: [] }]).rows;
  const one = jbRowShapes(linear[0], { theme: 'light', bg: '#fff' });
  assert.deepEqual(one.segments.map((s) => [s.x1, s.y1, s.x2, s.y2]), [[7, 13, 7, 26]]);
});

test('lane hex palettes avoid pure black and white (soft colours)', () => {
  for (const colors of Object.values(JB_LANE_HEX)) for (const c of colors) assert.ok(!/^#(000000|ffffff)$/i.test(c), c);
});
