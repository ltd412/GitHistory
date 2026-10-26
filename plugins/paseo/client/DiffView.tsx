// File diff in the centre (desktop DiffView): PyCharm-style side-by-side of the whole file with folded
// unchanged stretches and ▲/▼ between changes, or hunks; word-level highlights; stage / unstage /
// discard of files, hunks and selected lines. Phones default to hunks (two columns do not fit).
import { Icon, Loading } from "./ui/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { buildPatch, isImagePath, pairLines, parseDiff, splitRows, wordDiff, type DiffLine, type FileDiff, type Hunk, type WordSeg } from "../shared/core/diff";
import { splitPath } from "../shared/core/format";
import { WORKTREE, type CenterView, type DiffSource, type FileChange } from "../shared/core/types";
import { FileList, StatusIcon, Segmented, type ListMode, ModeToggle } from "./FileList";
import { useRepo } from "./RepoContext";
import type { Tokens } from "./theme";
import { errorMessage } from "./transport";
import { Button, useUi } from "./ui/Dialogs";

type DiffCenter = Extract<CenterView, { kind: "diff" }>;
type Mode = "side" | "hunk";
const CTX = 3;
let lastMode: Mode | null = null;
let lastIgnoreWs = false;

const isSha = (r: string) => /^[0-9a-f]{40}$/.test(r);
export const revLabel = (rev: string) => (rev === WORKTREE ? "working tree" : isSha(rev) ? rev.slice(0, 7) : rev);

function paneLabels(source: DiffSource): [string, string] {
  switch (source.kind) {
    case "unstaged":
      return ["Index (staged)", "Working tree"];
    case "staged":
      return ["HEAD", "Index (staged)"];
    case "commit":
      return [`${source.hash.slice(0, 7)}^ (parent)`, source.hash.slice(0, 7)];
    case "stash":
      return ["Base", "Stash"];
    case "range":
      return [revLabel(source.from), revLabel(source.to)];
  }
}

type Row = ReturnType<typeof splitRows>[number];

/** The other files of the same diff source, for the file list inside the floating frame. */
function useSourceFiles(source: DiffSource): FileChange[] | null {
  const { repo, git, data } = useRepo();
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const key = JSON.stringify(source);
  useEffect(() => {
    if (source.kind === "unstaged" || source.kind === "staged") return;
    let live = true;
    const p =
      source.kind === "commit"
        ? git.commitDetails(repo, source.hash).then((d) => d.files)
        : source.kind === "stash"
          ? git.stashFiles(repo, source.hash)
          : git.rangeFiles(repo, source.from, source.to);
    p.then((f) => live && setFiles(f), () => live && setFiles([]));
    return () => {
      live = false;
    };
  }, [git, repo, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (source.kind === "unstaged") return data.status.unstaged;
  if (source.kind === "staged") return data.status.staged;
  return files;
}
type Item =
  | { k: "row"; hi: number; r: Row; change: number | null; key: string }
  | { k: "fold"; count: number; id: string; key: string }
  | { k: "hunk"; hi: number; key: string }
  | { k: "line"; hi: number; li: number; key: string };

export function DiffView({ view }: { view: DiffCenter }) {
  const { repo, git, data, actions: a, setCenter, t, narrow } = useRepo();
  const ui = useUi();
  const { source, file } = view;
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState("");
  const [mode, setModeState] = useState<Mode>(lastMode ?? (narrow ? "hunk" : "side"));
  const [ignoreWs, setIgnoreWsState] = useState(lastIgnoreWs);
  const [sel, setSel] = useState<{ hunk: number; lines: Set<number> } | null>(null);
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(-1);
  const list = useRef<FlatList<Item>>(null);
  const siblings = useSourceFiles(source);
  const [frameW, setFrameW] = useState(1200);
  const [filesOpen, setFilesOpen] = useState<boolean | null>(null);
  const [listMode, setListMode] = useState<ListMode>("path");
  const showFiles = (filesOpen ?? frameW >= 1000) && !narrow && (siblings?.length ?? 0) > 1;
  const setMode = (m: Mode) => ((lastMode = m), setModeState(m));
  const setIgnoreWs = (v: boolean) => ((lastIgnoreWs = v), setIgnoreWsState(v));

  const image = isImagePath(file.path);
  // WHY: a whitespace-insensitive diff no longer matches the file byte for byte, so patches built from it
  // would not apply; partial staging is only offered on the exact diff.
  const editable = (source.kind === "unstaged" || source.kind === "staged") && !ignoreWs;
  const untracked = !!file.untracked;

  const load = useCallback(async () => {
    if (image) return;
    try {
      const full = mode === "side";
      let text: string;
      if (source.kind === "unstaged") text = await git.diffWorking(repo, file.path, { untracked, ignoreWs, full });
      else if (source.kind === "staged") text = await git.diffWorking(repo, file.path, { staged: true, ignoreWs, full });
      else if (source.kind === "commit") text = await git.diffCommit(repo, source.hash, file.path, file.oldPath, ignoreWs, full);
      else if (source.kind === "stash") text = await git.diffStash(repo, source.hash, file.path, untracked, ignoreWs, full);
      else text = await git.diffRange(repo, source.from, source.to, file.path, file.oldPath, ignoreWs, full);
      setDiff(parseDiff(text));
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [git, repo, source, file.path, file.oldPath, untracked, ignoreWs, image, mode]);

  // Working-tree diffs follow every status change (staging a hunk rewrites the diff).
  const isWorking = source.kind === "unstaged" || source.kind === "staged" || (source.kind === "range" && source.to === WORKTREE);
  useEffect(() => {
    void load();
    setSel(null);
  }, [load, isWorking ? data.status : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const pairs = useMemo(() => diff?.hunks.map(pairLines) ?? [], [diff]);
  const close = () => setCenter({ kind: "graph" });

  const applyHunk = async (h: Hunk, action: "stage" | "unstage" | "discard", lines: Set<number> | null) => {
    if (!diff) return;
    if (untracked && action === "stage") return void a.run("Stage", () => git.stage(repo, [file.path]));
    if (action === "discard") {
      const ok = await ui.confirm("Discard changes?", lines ? `Discard ${lines.size} selected line(s)?` : "Discard this hunk? This cannot be undone.", { danger: true, confirm: "Discard" });
      if (!ok) return;
    }
    const reverse = action !== "stage";
    const patch = buildPatch(diff, h, lines, reverse);
    await a.run(action === "stage" ? "Stage" : action === "unstage" ? "Unstage" : "Discard", () => git.applyPatch(repo, patch, { cached: action !== "discard", reverse }));
    setSel(null);
  };
  const tapLine = (hi: number, li: number, l: DiffLine) => {
    if (!editable || (l.type !== "+" && l.type !== "-")) return;
    setSel((cur) => {
      const lines = new Set(cur && cur.hunk === hi ? cur.lines : []);
      if (lines.has(li)) lines.delete(li);
      else lines.add(li);
      return lines.size ? { hunk: hi, lines } : null;
    });
  };
  const wordsFor = (hi: number, li: number): WordSeg[] | null => {
    const h = diff!.hunks[hi];
    const partner = pairs[hi]?.get(li);
    if (partner == null) return null;
    const l = h.lines[li];
    const p = h.lines[partner];
    const wd = l.type === "-" ? wordDiff(l.text, p.text) : wordDiff(p.text, l.text);
    return wd ? (l.type === "-" ? wd.left : wd.right) : null;
  };
  const fileAction = async (action: "stage" | "unstage" | "discard") => {
    if (action === "stage") await a.run("Stage", () => git.stage(repo, [file.path]));
    else if (action === "unstage") await a.run("Unstage", () => git.unstage(repo, [file.path]));
    else if (await ui.confirm("Discard changes?", `${file.path}\n\nThis cannot be undone.`, { danger: true, confirm: "Discard" })) await a.run("Discard", () => git.discard(repo, [file]));
    else return;
    close();
  };

  // Flat rows for a virtualized list: side-by-side folds long unchanged runs; hunk mode lists lines.
  const { items, changeAt } = useMemo(() => {
    const out: Item[] = [];
    const changeAt: number[] = [];
    if (!diff || diff.binary) return { items: out, changeAt };
    if (mode === "hunk") {
      diff.hunks.forEach((h, hi) => {
        out.push({ k: "hunk", hi, key: `h${hi}` });
        h.lines.forEach((_, li) => out.push({ k: "line", hi, li, key: `l${hi}:${li}` }));
      });
      return { items: out, changeAt };
    }
    const blocks: { hi: number; kind: "same" | "change"; rows: Row[] }[] = [];
    diff.hunks.forEach((h, hi) => {
      for (const r of splitRows(h)) {
        const kind = r.left?.type === " " && r.right?.type === " " ? "same" : "change";
        const last = blocks[blocks.length - 1];
        if (last && last.hi === hi && last.kind === kind) last.rows.push(r);
        else blocks.push({ hi, kind, rows: [r] });
      }
    });
    let change = -1;
    blocks.forEach((b, bi) => {
      if (b.kind === "change") {
        change++;
        changeAt.push(out.length);
        b.rows.forEach((r, k) => out.push({ k: "row", hi: b.hi, r, change, key: `c${bi}:${k}` }));
        return;
      }
      const id = `${bi}`;
      const head = bi === 0 ? 0 : CTX;
      const tail = bi === blocks.length - 1 ? 0 : CTX;
      const foldable = b.rows.length > head + tail + 2 && !unfolded.has(id);
      const push = (r: Row, k: number) => out.push({ k: "row", hi: b.hi, r, change: null, key: `s${bi}:${k}` });
      if (!foldable) b.rows.forEach(push);
      else {
        b.rows.slice(0, head).forEach(push);
        out.push({ k: "fold", count: b.rows.length - head - tail, id, key: `f${bi}` });
        b.rows.slice(b.rows.length - tail).forEach((r, k) => push(r, k + head + 1));
      }
    });
    return { items: out, changeAt };
  }, [diff, mode, unfolded]);

  const go = (d: 1 | -1) => {
    if (!changeAt.length) return;
    const n = (current + d + changeAt.length) % changeAt.length;
    setCurrent(n);
    list.current?.scrollToIndex({ index: changeAt[n], viewPosition: 0.3, animated: true });
  };

  const { dir, name } = splitPath(file.path);
  const labels = paneLabels(source);
  const lineActions =
    sel && editable ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Text style={{ color: t.dim, fontSize: 11 }}>
          {sel.lines.size} line{sel.lines.size > 1 ? "s" : ""} selected
        </Text>
        {source.kind === "unstaged" && (
          <>
            <Button t={t} label="Discard lines" kind="danger" onPress={() => void applyHunk(diff!.hunks[sel.hunk], "discard", sel.lines)} />
            <Button t={t} label="Stage lines" kind="green" onPress={() => void applyHunk(diff!.hunks[sel.hunk], "stage", sel.lines)} />
          </>
        )}
        {source.kind === "staged" && <Button t={t} label="Unstage lines" kind="danger" onPress={() => void applyHunk(diff!.hunks[sel.hunk], "unstage", sel.lines)} />}
        <Button t={t} label="Clear" onPress={() => setSel(null)} />
      </View>
    ) : null;

  const renderItem = ({ item }: { item: Item }) => {
    if (item.k === "fold")
      return (
        <Pressable onPress={() => setUnfolded((u) => new Set(u).add(item.id))} style={{ padding: 3, backgroundColor: t.panel2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.border }}>
          <Text style={{ color: t.faint, fontSize: 11, textAlign: "center" }}>··· {item.count} unchanged lines ···</Text>
        </Pressable>
      );
    if (item.k === "hunk") {
      const h = diff!.hunks[item.hi];
      const lines = sel?.hunk === item.hi ? sel.lines : null;
      const n = lines ? ` ${lines.size} line${lines.size > 1 ? "s" : ""}` : " Hunk";
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: t.panel2, flexWrap: "wrap" }}>
          <Text style={{ color: t.dim, fontFamily: t.mono, fontSize: 11, flex: 1 }} numberOfLines={1}>
            {h.header}
          </Text>
          {source.kind === "unstaged" && editable && (
            <>
              <Button t={t} label={`Discard${n}`} kind="danger" onPress={() => void applyHunk(h, "discard", lines)} />
              <Button t={t} label={`Stage${n}`} kind="green" onPress={() => void applyHunk(h, "stage", lines)} />
            </>
          )}
          {source.kind === "staged" && editable && <Button t={t} label={`Unstage${n}`} kind="danger" onPress={() => void applyHunk(h, "unstage", lines)} />}
        </View>
      );
    }
    if (item.k === "line") {
      const l = diff!.hunks[item.hi].lines[item.li];
      return (
        <Cell
          t={t}
          l={l}
          no={[l.oldNo, l.newNo]}
          words={l.type === "+" || l.type === "-" ? wordsFor(item.hi, item.li) : null}
          selected={sel?.hunk === item.hi && sel.lines.has(item.li)}
          onPress={() => tapLine(item.hi, item.li, l)}
          sign
        />
      );
    }
    const { r, hi } = item;
    const cur = item.change != null && item.change === current;
    return (
      <View style={{ flexDirection: "row", borderLeftWidth: cur ? 3 : 0, borderLeftColor: t.accent }}>
        {(["left", "right"] as const).map((side, k) => {
          const l = r[side];
          const idx = r.index[k];
          return (
            <View key={side} style={{ flex: 1, minWidth: 0, overflow: "hidden", borderLeftWidth: k ? 1 : 0, borderLeftColor: t.border }}>
              {l ? (
                <Cell
                  t={t}
                  l={l}
                  no={[side === "left" ? l.oldNo : l.newNo]}
                  words={l.type !== " " ? wordsFor(hi, idx) : null}
                  selected={sel?.hunk === hi && sel.lines.has(idx)}
                  onPress={() => l.type !== " " && tapLine(hi, idx, l)}
                />
              ) : (
                <View style={{ flex: 1, minHeight: 18, backgroundColor: t.light ? "rgba(31,35,40,.035)" : "rgba(255,255,255,.03)" }} />
              )}
            </View>
          );
        })}
      </View>
    );
  };

  const iconBtn = (icon: string, label: string, onPress: () => void, disabled = false) => (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label} hitSlop={6} style={{ padding: 4, opacity: disabled ? 0.35 : 1 }}>
      <Icon name={icon} size={15} color={t.dim} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: t.bg }} onLayout={(e) => setFrameW(Math.round(e.nativeEvent.layout.width))}>
      {showFiles && (
        <View style={{ width: 280, borderRightWidth: 1, borderRightColor: t.border, backgroundColor: t.panel }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, height: 38, borderBottomWidth: 1, borderBottomColor: t.border }}>
            <Text style={{ color: t.dim, fontSize: 11, fontWeight: "700", flex: 1 }}>{siblings!.length} FILES</Text>
            <ModeToggle t={t} mode={listMode} onChange={setListMode} />
          </View>
          <ScrollView>
            <FileList t={t} files={siblings!} mode={listMode} showStats selected={file.path} onPress={(f) => setCenter({ kind: "diff", source, file: f })} />
          </ScrollView>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: t.panel, flexWrap: "wrap" }}>
        {!narrow && (siblings?.length ?? 0) > 1 && iconBtn(showFiles ? "PanelLeftClose" : "PanelLeftOpen", showFiles ? "Hide file list" : "Show file list", () => setFilesOpen(!showFiles))}
        <StatusIcon t={t} status={file.status} />
        <Text style={{ color: t.text, fontSize: 13, flex: 1, minWidth: 120 }} numberOfLines={1} ellipsizeMode="head">
          {file.oldPath ? <Text style={{ color: t.dim }}>{file.oldPath} → </Text> : null}
          <Text style={{ color: t.dim }}>{dir}</Text>
          {name}
          {source.kind === "range" ? <Text style={{ color: t.dim }}>{`  ${revLabel(source.from)} → ${revLabel(source.to)}`}</Text> : null}
        </Text>
        {source.kind === "unstaged" && (
          <>
            <Button t={t} label="Discard File" kind="danger" onPress={() => void fileAction("discard")} />
            <Button t={t} label="Stage File" kind="green" onPress={() => void fileAction("stage")} />
          </>
        )}
        {source.kind === "staged" && <Button t={t} label="Unstage File" kind="danger" onPress={() => void fileAction("unstage")} />}
        {!image && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: t.dim, fontSize: 11 }}>Ignore whitespace</Text>
            <Switch value={ignoreWs} onValueChange={setIgnoreWs} />
            <Segmented t={t} value={mode} onChange={setMode} options={[{ value: "side", label: "Side-by-side" }, { value: "hunk", label: "Hunk" }]} />
          </View>
        )}
        {iconBtn("History", "File history", () => setCenter({ kind: "history", file: file.path }), untracked)}
        {iconBtn("ScanText", "Blame", () => setCenter({ kind: "blame", file: file.path, rev: source.kind === "commit" ? source.hash : source.kind === "range" && source.to !== WORKTREE ? source.to : undefined }), untracked || file.status === "D" || image)}

      </View>
      {mode === "side" && diff && !diff.binary && diff.hunks.length > 0 && (
        <View style={{ backgroundColor: t.panel2, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <View style={{ flexDirection: "row" }}>
            {labels.map((l, i) => (
              <Text key={i} style={{ flex: 1, color: t.text, fontWeight: "600", fontSize: 11, paddingHorizontal: 12, paddingVertical: 6, borderLeftWidth: i ? 1 : 0, borderLeftColor: t.border }} numberOfLines={1}>
                {l}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderTopWidth: 1, borderTopColor: t.border }}>
            {lineActions}
            <Text style={{ color: t.dim, fontSize: 11, marginLeft: 8 }}>
              {changeAt.length} change{changeAt.length === 1 ? "" : "s"}
            </Text>
            {iconBtn("ChevronUp", "Previous change", () => go(-1))}
            {iconBtn("ChevronDown", "Next change", () => go(1))}
          </View>
        </View>
      )}
      {mode === "hunk" && lineActions ? <View style={{ padding: 6, backgroundColor: t.panel2 }}>{lineActions}</View> : null}
      {image ? (
        <Text style={{ color: t.dim, padding: 24 }}>Image file — open it on the desktop app to compare visually.</Text>
      ) : error ? (
        <Text style={{ color: t.red, padding: 16 }}>{error}</Text>
      ) : !diff ? (
        <Loading />
      ) : diff.binary ? (
        <Text style={{ color: t.dim, padding: 24 }}>Binary file — no text diff available.</Text>
      ) : !diff.hunks.length ? (
        <Text style={{ color: t.dim, padding: 24 }}>{ignoreWs ? "Only whitespace changed." : file.status === "R" ? "File renamed without content changes." : "No changes to show."}</Text>
      ) : (
        <>
          {ignoreWs && (source.kind === "unstaged" || source.kind === "staged") ? (
            <Text style={{ color: t.dim, fontSize: 11, padding: 6, backgroundColor: t.panel2 }}>Whitespace is ignored — turn it off to stage or discard individual hunks and lines.</Text>
          ) : null}
          <FlatList
            ref={list}
            data={items}
            keyExtractor={(i) => i.key}
            renderItem={renderItem}
            initialNumToRender={60}
            onScrollToIndexFailed={({ index }) => setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.3 }), 100)}
            extraData={[sel, current]}
          />
        </>
      )}
      </View>
    </View>
  );
}

function Cell({ t, l, no, words, selected, onPress, sign }: { t: Tokens; l: DiffLine; no: (number | null)[]; words: WordSeg[] | null; selected: boolean; onPress: () => void; sign?: boolean }) {
  const add = l.type === "+";
  const del = l.type === "-";
  const bg = selected ? "rgba(63,182,212,.22)" : add ? (t.light ? "#e6f6ea" : "rgba(63,187,111,.14)") : del ? (t.light ? "#fdecec" : "rgba(224,85,97,.14)") : "transparent";
  const mark = add ? (t.light ? "#aee5bd" : "rgba(63,187,111,.42)") : t.light ? "#f7c2c4" : "rgba(224,85,97,.42)";
  const mono = { fontFamily: t.mono, fontSize: 12, lineHeight: 18 };
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "flex-start", minHeight: 18, overflow: "hidden", backgroundColor: bg, borderLeftWidth: selected ? 3 : 0, borderLeftColor: t.accent }}>
      {no.map((n, i) => (
        <Text key={i} style={[mono, { width: 44, flexShrink: 0, textAlign: "right", paddingRight: 8, color: t.faint }]}>
          {n ?? ""}
        </Text>
      ))}
      {sign && <Text style={[mono, { width: 16, flexShrink: 0, textAlign: "center", color: add ? t.green : del ? t.red : t.faint }]}>{add || del ? l.type : ""}</Text>}
      <Text style={[mono, { flex: 1, flexShrink: 1, minWidth: 0, paddingRight: 10, color: l.type === "\\" ? t.faint : t.text, fontStyle: l.type === "\\" ? "italic" : "normal" }]} selectable>
        {l.type === "\\" ? l.text.trim() : words ? words.map((w, i) => (w.changed ? <Text key={i} style={{ backgroundColor: mark }}>{w.text}</Text> : w.text)) : l.text}
      </Text>
    </Pressable>
  );
}
