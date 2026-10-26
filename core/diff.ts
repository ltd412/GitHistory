export interface DiffLine {
  type: ' ' | '+' | '-' | '\\';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Everything before the first hunk ("diff --git", index, ---/+++ lines). */
  header: string[];
  hunks: Hunk[];
  binary: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseDiff(text: string): FileDiff {
  const rows = text.split('\n');
  if (rows.length && rows[rows.length - 1] === '') rows.pop();
  const header: string[] = [];
  const hunks: Hunk[] = [];
  let binary = false;
  let cur: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const row of rows) {
    const m = HUNK_RE.exec(row);
    if (m) {
      cur = {
        header: row,
        oldStart: Number(m[1]),
        oldLines: m[2] == null ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] == null ? 1 : Number(m[4]),
        lines: [],
      };
      oldNo = cur.oldStart;
      newNo = cur.newStart;
      hunks.push(cur);
      continue;
    }
    if (!cur) {
      if (/^Binary files .* differ$/.test(row) || row.startsWith('GIT binary patch')) binary = true;
      header.push(row);
      continue;
    }
    const t = row[0] as DiffLine['type'];
    const body = row.slice(1);
    if (t === '+') cur.lines.push({ type: '+', text: body, oldNo: null, newNo: newNo++ });
    else if (t === '-') cur.lines.push({ type: '-', text: body, oldNo: oldNo++, newNo: null });
    else if (t === '\\') cur.lines.push({ type: '\\', text: body, oldNo: null, newNo: null });
    else cur.lines.push({ type: ' ', text: body, oldNo: oldNo++, newNo: newNo++ });
  }
  return { header, hunks, binary };
}

/**
 * Builds a patch containing only the selected lines of one hunk.
 *
 * Forward (stage from the working tree): an unselected `-` line is still present on the
 * target side, so it becomes context; an unselected `+` line is not wanted, so it is dropped.
 * Reverse (unstage, or discard from the working tree, applied with `git apply -R`): the
 * patch is applied backwards, so the roles swap — unselected `+` lines become context and
 * unselected `-` lines are dropped.
 *
 * `selected` holds indexes into `hunk.lines`; null means the whole hunk.
 */
export function buildPatch(diff: FileDiff, hunk: Hunk, selected: Set<number> | null, reverse: boolean): string {
  // Attach "\ No newline at end of file" markers to the line they follow.
  const items: { type: ' ' | '+' | '-'; text: string; idx: number; noEol: boolean }[] = [];
  hunk.lines.forEach((l, i) => {
    if (l.type === '\\') {
      if (items.length) items[items.length - 1].noEol = true;
    } else items.push({ type: l.type, text: l.text, idx: i, noEol: false });
  });
  const isSel = (idx: number) => selected == null || selected.has(idx);

  const out: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  const emit = (sign: ' ' | '+' | '-', it: (typeof items)[number]) => {
    out.push(sign + it.text);
    if (it.noEol) out.push('\\ No newline at end of file');
    if (sign !== '+') oldCount++;
    if (sign !== '-') newCount++;
  };

  // WHY: within one change block (removals followed by additions) the k-th removal is paired
  // with the k-th addition. Emitting pairs in order keeps a partially selected replacement on
  // the line it replaces; emitting all removals first would move kept context above it.
  let i = 0;
  while (i < items.length) {
    if (items[i].type === ' ') {
      emit(' ', items[i++]);
      continue;
    }
    const dels: (typeof items)[number][] = [];
    const adds: (typeof items)[number][] = [];
    while (i < items.length && items[i].type === '-') dels.push(items[i++]);
    while (i < items.length && items[i].type === '+') adds.push(items[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const d = dels[k];
      const a = adds[k];
      if (!reverse) {
        // Forward: unselected removals stay as context; unselected additions are dropped.
        if (d) emit(isSel(d.idx) ? '-' : ' ', d);
        if (a && isSel(a.idx)) emit('+', a);
      } else {
        // Reverse (applied with -R): unselected additions stay as context; unselected removals are dropped.
        if (d && isSel(d.idx)) emit('-', d);
        if (a) emit(isSel(a.idx) ? '+' : ' ', a);
      }
    }
  }
  const head = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@`;
  const fileHeader = diff.header.filter((h) => h.startsWith('diff --git') || h.startsWith('---') || h.startsWith('+++') || h.startsWith('new file mode') || h.startsWith('deleted file mode') || h.startsWith('old mode') || h.startsWith('new mode'));
  return [...fileHeader, head, ...out].join('\n') + '\n';
}

/** Pairs removed/added lines of a hunk side by side for the split view. */
export function splitRows(hunk: Hunk): { left: DiffLine | null; right: DiffLine | null; index: [number, number] }[] {
  const rows: { left: DiffLine | null; right: DiffLine | null; index: [number, number] }[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.type === ' ') {
      rows.push({ left: l, right: l, index: [i, i] });
      i++;
      continue;
    }
    if (l.type === '\\') {
      i++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (i < lines.length && lines[i].type === '-') dels.push(i++);
    while (i < lines.length && (lines[i].type === '+' || lines[i].type === '\\')) {
      if (lines[i].type === '+') adds.push(i);
      i++;
    }
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      rows.push({
        left: k < dels.length ? lines[dels[k]] : null,
        right: k < adds.length ? lines[adds[k]] : null,
        index: [dels[k] ?? -1, adds[k] ?? -1],
      });
    }
  }
  return rows;
}

/** Splits a file containing conflict markers into common and conflicting regions. */
export interface ConflictChunk {
  kind: 'common' | 'conflict';
  lines?: string[];
  ours?: string[];
  /** Common-ancestor lines; present only with diff3-style markers. */
  base?: string[];
  theirs?: string[];
  oursLabel?: string;
  theirsLabel?: string;
}

export function parseConflicts(text: string): ConflictChunk[] {
  const chunks: ConflictChunk[] = [];
  const rows = text.split('\n');
  let common: string[] = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.startsWith('<<<<<<<')) {
      if (common.length) chunks.push({ kind: 'common', lines: common });
      common = [];
      const ours: string[] = [];
      const theirs: string[] = [];
      const oursLabel = r.slice(8);
      i++;
      while (i < rows.length && !rows[i].startsWith('=======') && !rows[i].startsWith('|||||||')) ours.push(rows[i++]);
      let base: string[] | undefined;
      if (i < rows.length && rows[i].startsWith('|||||||')) {
        base = [];
        i++;
        while (i < rows.length && !rows[i].startsWith('=======')) base.push(rows[i++]);
      }
      i++;
      while (i < rows.length && !rows[i].startsWith('>>>>>>>')) theirs.push(rows[i++]);
      const theirsLabel = (rows[i] ?? '').slice(8);
      i++;
      chunks.push(base ? { kind: 'conflict', ours, base, theirs, oursLabel, theirsLabel } : { kind: 'conflict', ours, theirs, oursLabel, theirsLabel });
    } else {
      common.push(r);
      i++;
    }
  }
  if (common.length) chunks.push({ kind: 'common', lines: common });
  return chunks;
}

export interface WordSeg {
  text: string;
  changed: boolean;
}

const TOKEN_RE = /\w+|\s+|[^\w\s]/g;
const MAX_CELLS = 250_000;

/**
 * Intra-line (word-level) diff of a removed line against its paired added line.
 * Returns null when the lines are too different for word highlights to help — then the
 * whole-line colour already says everything and per-word marks would only be noise.
 */
export function wordDiff(a: string, b: string): { left: WordSeg[]; right: WordSeg[] } | null {
  const ta = a.match(TOKEN_RE) ?? [];
  const tb = b.match(TOKEN_RE) ?? [];
  if (!ta.length || !tb.length || ta.length * tb.length > MAX_CELLS) return null;
  // LCS table over tokens.
  const n = ta.length;
  const m = tb.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  let commonChars = 0;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (ta[i] === tb[j]) {
      keepA[i] = keepB[j] = true;
      if (/\S/.test(ta[i])) commonChars += ta[i].length;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const visible = (s: string) => s.replace(/\s+/g, '').length;
  if (commonChars < 0.4 * Math.max(visible(a), visible(b))) return null;
  const merge = (tokens: string[], keep: boolean[]): WordSeg[] => {
    const out: WordSeg[] = [];
    tokens.forEach((t, i) => {
      const changed = !keep[i];
      const last = out[out.length - 1];
      if (last && last.changed === changed) last.text += t;
      else out.push({ text: t, changed });
    });
    return out;
  };
  return { left: merge(ta, keepA), right: merge(tb, keepB) };
}

/** Maps each removed/added line index in a hunk to its partner in the same change block. */
export function pairLines(hunk: Hunk): Map<number, number> {
  const pairs = new Map<number, number>();
  for (const r of splitRows(hunk)) {
    const [l, rr] = r.index;
    if (r.left && r.right && r.left.type === '-' && r.right.type === '+') {
      pairs.set(l, rr);
      pairs.set(rr, l);
    }
  }
  return pairs;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif)$/i;
export const isImagePath = (p: string) => IMAGE_EXT.test(p);

export function mimeFor(p: string): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(p)?.[1] ?? '').toLowerCase();
  return ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`;
}
