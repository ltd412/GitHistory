// Centre views besides graph and diff (desktop FileViews / ConflictView / RebaseDialog): file history,
// blame, a file at a revision, the PyCharm-style three-way merge tool, and the interactive rebase dialog.
import { Icon, Loading, Modal, TextInput } from "./ui/sdk";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { isImagePath, parseConflicts, parseDiff, type ConflictChunk } from "../shared/core/diff";
import { relativeTime } from "../shared/core/format";
import { acceptAll, applySide, buildOutput, ignoreSide, initialResolutions, isResolved, resultLines, type Resolution, type SideName } from "../shared/core/merge";
import type { CenterView, Commit } from "../shared/core/types";
import { Avatar } from "./CommitPanel";
import { Segmented } from "./FileList";
import { useRepo } from "./RepoContext";
import type { Tokens } from "./theme";
import { errorMessage } from "./transport";
import { Button } from "./ui/Dialogs";

type Other = Exclude<CenterView, { kind: "graph" } | { kind: "diff" }>;

export function CenterViews({ view }: { view: Other }) {
  if (view.kind === "history") return <HistoryView key={view.file} file={view.file} />;
  if (view.kind === "blame") return <BlameView key={view.file + view.rev} file={view.file} rev={view.rev} />;
  if (view.kind === "file") return <FileContentView key={view.file + view.rev} file={view.file} rev={view.rev} />;
  return <ConflictView key={view.file} file={view.file} />;
}
CenterViews.Rebase = RebaseDialog;

function Head({ t, children, actions }: { t: Tokens; children: ReactNode; actions?: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 6, gap: 6, borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: t.panel }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ color: t.text, fontSize: 13, fontWeight: "600", flex: 1, minWidth: 120 }} numberOfLines={1} ellipsizeMode="head">
          {children}
        </Text>
      </View>
      {actions ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{actions}</View> : null}
    </View>
  );
}

const mono = (t: Tokens) => ({ fontFamily: t.mono, fontSize: 12, lineHeight: 18 });

// ---------------------------------------------------------------- history

function HistoryView({ file }: { file: string }) {
  const { repo, git, setCenter, jumpTo, t, narrow } = useRepo();
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  useEffect(() => {
    git.fileHistory(repo, file).then(
      (c) => (setCommits(c), c[0] && setActive(c[0].hash)),
      (e) => setError(errorMessage(e)),
    );
  }, [git, repo, file]);
  useEffect(() => {
    if (active) git.diffCommit(repo, active, file).then(setDiff, () => setDiff(""));
  }, [git, repo, file, active]);
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const lines = parsed.hunks.flatMap((h, hi) => [{ head: h.header, key: `h${hi}` }, ...h.lines.map((l, k) => ({ l, key: `${hi}:${k}` }))]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Head t={t} actions={<Button t={t} label="Blame" onPress={() => setCenter({ kind: "blame", file })} />}>
        History: {file}
      </Head>
      <View style={{ flex: 1, flexDirection: narrow ? "column" : "row" }}>
        <ScrollView style={narrow ? { maxHeight: 220, borderBottomWidth: 1, borderBottomColor: t.border } : { width: 340, borderRightWidth: 1, borderRightColor: t.border }}>
          {error ? <Text style={{ color: t.red, padding: 12 }}>{error}</Text> : null}
          {commits?.length === 0 && <Text style={{ color: t.dim, padding: 12 }}>No history (the file may be untracked).</Text>}
          {commits?.map((c) => (
            <Pressable
              key={c.hash}
              onPress={() => setActive(c.hash)}
              onLongPress={() => (jumpTo(c.hash), setCenter({ kind: "graph" }))}
              style={{ flexDirection: "row", gap: 8, padding: 8, backgroundColor: active === c.hash ? t.select : "transparent", borderBottomWidth: 1, borderBottomColor: t.border }}
            >
              <Avatar name={c.author} email={c.email} size={22} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontSize: 12 }} numberOfLines={1}>
                  {c.subject}
                </Text>
                <Text style={{ color: t.dim, fontSize: 11 }} numberOfLines={1}>
                  {c.author} · {relativeTime(c.time)} · {c.hash.slice(0, 7)}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
        <FlatList
          style={{ flex: 1 }}
          data={lines}
          keyExtractor={(x) => x.key}
          renderItem={({ item }) =>
            "head" in item ? (
              <Text style={{ color: t.dim, fontFamily: t.mono, fontSize: 11, padding: 4, backgroundColor: t.panel2 }}>{item.head}</Text>
            ) : (
              <View style={{ flexDirection: "row", backgroundColor: item.l.type === "+" ? "rgba(63,187,111,.14)" : item.l.type === "-" ? "rgba(224,85,97,.14)" : "transparent" }}>
                <Text style={[mono(t), { width: 40, textAlign: "right", paddingRight: 6, color: t.faint }]}>{item.l.oldNo ?? ""}</Text>
                <Text style={[mono(t), { width: 40, textAlign: "right", paddingRight: 6, color: t.faint }]}>{item.l.newNo ?? ""}</Text>
                <Text style={[mono(t), { width: 14, color: item.l.type === "+" ? t.green : t.red }]}>{item.l.type === " " ? "" : item.l.type}</Text>
                <Text style={[mono(t), { flex: 1, color: t.text }]}>{item.l.text}</Text>
              </View>
            )
          }
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- blame

function BlameView({ file, rev }: { file: string; rev?: string }) {
  const { repo, git, setCenter, jumpTo, t, narrow } = useRepo();
  const [blame, setBlame] = useState<Awaited<ReturnType<typeof git.blame>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    git.blame(repo, file, rev).then(setBlame, (e) => setError(errorMessage(e)));
  }, [git, repo, file, rev]);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Head t={t} actions={<Button t={t} label="History" onPress={() => setCenter({ kind: "history", file })} />}>
        Blame: {file}
        {rev ? <Text style={{ color: t.dim }}> @ {rev.slice(0, 7)}</Text> : null}
      </Head>
      {error ? <Text style={{ color: t.red, padding: 12 }}>{error}</Text> : null}
      {!blame && !error ? <Loading /> : null}
      {blame && (
        <FlatList
          data={blame.lines}
          keyExtractor={(_, i) => String(i)}
          initialNumToRender={80}
          renderItem={({ item: l, index: i }) => {
            const m = blame.meta[l.hash];
            const first = i === 0 || blame.lines[i - 1].hash !== l.hash;
            const uncommitted = /^0+$/.test(l.hash);
            return (
              <View style={{ flexDirection: "row", borderTopWidth: first ? 1 : 0, borderTopColor: t.border }}>
                <Pressable
                  onLongPress={() => !uncommitted && (jumpTo(l.hash), setCenter({ kind: "graph" }))}
                  style={{ width: narrow ? 110 : 260, flexDirection: "row", gap: 6, paddingHorizontal: 6, backgroundColor: t.panel }}
                >
                  {first && m ? (
                    <>
                      <Text style={[mono(t), { color: t.accent, fontSize: 11 }]}>{uncommitted ? "working" : l.hash.slice(0, 7)}</Text>
                      {!narrow && (
                        <Text style={{ color: t.dim, fontSize: 11, flex: 1, lineHeight: 18 }} numberOfLines={1}>
                          {uncommitted ? "Not committed yet" : m.summary}
                        </Text>
                      )}
                      <Text style={{ color: t.faint, fontSize: 11, lineHeight: 18 }} numberOfLines={1}>
                        {m.author?.split(" ")[0]}
                      </Text>
                    </>
                  ) : null}
                </Pressable>
                <Text style={[mono(t), { width: 44, textAlign: "right", paddingRight: 8, color: t.faint }]}>{i + 1}</Text>
                <Text style={[mono(t), { flex: 1, color: t.text }]}>{l.text}</Text>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------- file at revision

/** UTF-8 bytes of a base64 string, decoded without relying on TextDecoder (not on every RN engine). */
function decodeBase64Utf8(b64: string): string | null {
  const bin = atob(b64);
  // A NUL byte in the first 8 KB is git's own heuristic for "binary".
  if (bin.slice(0, 8000).includes("\0")) return null;
  let out = "";
  for (let i = 0; i < bin.length; ) {
    const c = bin.charCodeAt(i++);
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bin.charCodeAt(i++) & 0x3f));
    else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bin.charCodeAt(i++) & 0x3f) << 6) | (bin.charCodeAt(i++) & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((bin.charCodeAt(i++) & 0x3f) << 12) | ((bin.charCodeAt(i++) & 0x3f) << 6) | (bin.charCodeAt(i++) & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

function FileContentView({ file, rev }: { file: string; rev: string }) {
  const { repo, git, setCenter, actions: a, t } = useRepo();
  const [blob, setBlob] = useState<{ base64: string | null; size: number; tooLarge: boolean } | null | "missing">(null);
  useEffect(() => {
    git.readBlob(repo, rev, file).then((b) => setBlob(b ?? "missing"), () => setBlob("missing"));
  }, [git, repo, rev, file]);
  const image = isImagePath(file);
  const text = useMemo(() => (blob && blob !== "missing" && blob.base64 && !image ? decodeBase64Utf8(blob.base64) : null), [blob, image]);
  const lines = text?.split("\n") ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Head
        t={t}
        actions={
          <>
            <Button t={t} label="Restore this version" onPress={() => void a.run("Restore file", () => git.restoreFile(repo, rev, file), { success: `Restored ${file} from ${rev.slice(0, 7)}` })} />
            <Button t={t} label="History" onPress={() => setCenter({ kind: "history", file })} />
            <Button t={t} label="Blame" disabled={image} onPress={() => setCenter({ kind: "blame", file, rev })} />
          </>
        }
      >
        {file} <Text style={{ color: t.dim }}>@ {rev.slice(0, 7)}</Text>
      </Head>
      {blob === null && <Loading />}
      {blob === "missing" && <Text style={{ color: t.dim, padding: 24 }}>File does not exist at this revision.</Text>}
      {blob && blob !== "missing" && blob.tooLarge && <Text style={{ color: t.dim, padding: 24 }}>File is too large to preview.</Text>}
      {blob && blob !== "missing" && blob.base64 && (image || text == null) && <Text style={{ color: t.dim, padding: 24 }}>{image ? "Image file." : "Binary file."}</Text>}
      {text != null && (
        <FlatList
          data={lines}
          keyExtractor={(_, i) => String(i)}
          initialNumToRender={80}
          renderItem={({ item, index }) => (
            <View style={{ flexDirection: "row" }}>
              <Text style={[mono(t), { width: 48, textAlign: "right", paddingRight: 8, color: t.faint }]}>{index + 1}</Text>
              <Text style={[mono(t), { flex: 1, color: t.text }]} selectable>
                {item}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------- merge tool

const FOLD_AT = 8;

/**
 * PyCharm-style three-way merge: Ours | Result | Theirs aligned chunk by chunk. » / « apply a side, ×
 * ignores it, the result is editable; unresolved conflicts show the common ancestor. On a phone the
 * three columns become tabs (flows.md F6).
 */
function ConflictView({ file }: { file: string }) {
  const { repo, git, data, actions: a, setCenter, t, narrow } = useRepo();
  const [source, setSource] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<Resolution[]>([]);
  const [current, setCurrent] = useState(0);
  const [unfolded, setUnfolded] = useState<Set<number>>(new Set());
  const [pane, setPane] = useState<"ours" | "result" | "theirs">("result");
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef<Record<number, number>>({});

  useEffect(() => {
    void (async () => {
      try {
        // Rebuilt from the index stages so the base is always available, whatever conflictStyle is set.
        const diff3 = await git.conflictDiff3(repo, file);
        if (diff3 != null) setSource(diff3);
        else {
          const v = await git.conflictVersions(repo, file);
          setSource(v.working);
          setFallback(true);
        }
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [git, repo, file]);

  const chunks = useMemo<ConflictChunk[]>(() => (source != null ? parseConflicts(source) : []), [source]);
  const conflictIdx = useMemo(() => chunks.map((c, i) => (c.kind === "conflict" ? i : -1)).filter((i) => i >= 0), [chunks]);
  // Reset resolutions in the same render the chunks change: rendering new chunks against the old list
  // would index past its end.
  const [resFor, setResFor] = useState(chunks);
  if (resFor !== chunks) {
    setResFor(chunks);
    setRes(initialResolutions(chunks));
  }
  const remaining = conflictIdx.length - res.filter(isResolved).length;
  const output = useMemo(() => buildOutput(chunks, res), [chunks, res]);
  const update = (k: number, f: (r: Resolution) => Resolution) => setRes((rs) => rs.map((r, i) => (i === k ? f(r) : r)));
  const go = (k: number) => {
    if (!conflictIdx.length) return;
    const n = (k + conflictIdx.length) % conflictIdx.length;
    setCurrent(n);
    const y = offsets.current[conflictIdx[n]];
    if (y != null) scroll.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
  };

  // Several conflicted files are worked through in one go: after resolving one, the next opens.
  const conflictedFiles = data.status.conflicted.map((f) => f.path);
  const fileIndex = conflictedFiles.indexOf(file);
  const openFile = (path: string) => setCenter({ kind: "conflict", file: path });
  const goNextFile = () => {
    const next = conflictedFiles.filter((p) => p !== file);
    if (next.length) openFile(next[Math.max(0, fileIndex) % next.length]);
    else setCenter({ kind: "graph" });
  };
  // writeWorkingFile and resolveConflict are two ops; if the second fails the file stays conflicted and
  // Apply can simply be pressed again (flows.md F6).
  const save = async () => {
    const ok = await a.run("Resolve conflict", async () => {
      await git.writeWorkingFile(repo, file, output);
      await git.resolveConflict(repo, file, "mark");
    });
    if (ok) goNextFile();
  };
  const takeWhole = (side: "ours" | "theirs") => a.run("Resolve", () => git.resolveConflict(repo, file, side)).then((ok) => ok && goNextFile());

  const rebasing = data.state.state === "rebasing";
  // During a rebase "ours" is the branch being rebased onto, "theirs" the commit being replayed.
  const leftTitle = rebasing ? "Upstream (onto)" : `Yours — ${data.refs.head ?? "HEAD"}`;
  const rightTitle = rebasing ? "Your commit" : "Theirs — incoming";
  const sideBg = (state: string) => (state === "applied" ? "rgba(63,187,111,.18)" : state === "ignored" ? "transparent" : "rgba(224,85,97,.16)");
  const pre = (text: string, extra: object = {}) => (
    <Text style={[mono(t), { color: t.text, padding: 4, flex: 1 }, extra]} selectable>
      {text || " "}
    </Text>
  );
  const show = (p: "ours" | "result" | "theirs") => !narrow || pane === p;

  let k = -1;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Head
        t={t}
        actions={
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {conflictedFiles.length > 1 && fileIndex !== -1 && (
              <>
                <Button t={t} label="◀" onPress={() => openFile(conflictedFiles[(fileIndex - 1 + conflictedFiles.length) % conflictedFiles.length])} />
                <Text style={{ color: t.orange, fontSize: 11 }}>{conflictedFiles.length} files left</Text>
                <Button t={t} label="▶" onPress={() => openFile(conflictedFiles[(fileIndex + 1) % conflictedFiles.length])} />
              </>
            )}
            {conflictIdx.length > 0 && (
              <>
                <Text style={{ color: remaining ? t.orange : t.green, fontSize: 11 }}>{remaining ? `${remaining} of ${conflictIdx.length} conflicts left` : "All conflicts resolved"}</Text>
                <Button t={t} label="▲" onPress={() => go(current - 1)} />
                <Button t={t} label="▼" onPress={() => go(current + 1)} />
                <Button t={t} label="Accept Left" onPress={() => setRes((rs) => acceptAll(rs, "ours"))} />
                <Button t={t} label="Accept Right" onPress={() => setRes((rs) => acceptAll(rs, "theirs"))} />
              </>
            )}
            {fallback && (
              <>
                <Button t={t} label="Take ours" onPress={() => void takeWhole("ours")} />
                <Button t={t} label="Take theirs" onPress={() => void takeWhole("theirs")} />
              </>
            )}
            <Button t={t} label={`Abort ${rebasing ? "rebase" : "merge"}`} kind="danger" onPress={a.abort} />
            <Button t={t} label={conflictedFiles.length > 1 ? "Apply & next file" : "Apply"} kind="green" disabled={remaining > 0 || source == null} onPress={() => void save()} />
          </View>
        }
      >
        Merge: {file}
      </Head>
      {error ? <Text style={{ color: t.red, padding: 12 }}>{error}</Text> : null}
      {fallback && source != null ? (
        <Text style={{ color: t.dim, fontSize: 11, padding: 6, backgroundColor: t.panel2 }}>
          One side added or deleted this file, so there is no common ancestor to merge against. Edit the result, or take one side as a whole.
        </Text>
      ) : null}
      {narrow ? (
        <View style={{ padding: 6, alignItems: "center", borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Segmented t={t} value={pane} onChange={setPane} options={[{ value: "ours", label: rebasing ? "Upstream" : "Yours" }, { value: "result", label: "Result" }, { value: "theirs", label: rebasing ? "Your commit" : "Theirs" }]} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", backgroundColor: t.panel2, borderBottomWidth: 1, borderBottomColor: t.border }}>
          {[leftTitle, "Result", rightTitle].map((s, i) => (
            <Text key={i} style={{ flex: 1, color: t.text, fontWeight: "600", fontSize: 11, padding: 6, marginHorizontal: i === 1 ? 44 : 0 }} numberOfLines={1}>
              {s}
            </Text>
          ))}
        </View>
      )}
      {source == null && !error ? <Loading /> : null}
      <ScrollView ref={scroll}>
        {chunks.map((c, ci) => {
          if (c.kind === "common") {
            const lines = c.lines!;
            const fold = lines.length > FOLD_AT && !unfolded.has(ci);
            const text = lines.join("\n");
            return (
              <View key={ci} onLayout={(e) => (offsets.current[ci] = e.nativeEvent.layout.y)} style={{ flexDirection: "row", opacity: 0.8 }}>
                {fold ? (
                  <Pressable onPress={() => setUnfolded((u) => new Set(u).add(ci))} style={{ flex: 1, padding: 3, backgroundColor: t.panel2 }}>
                    <Text style={{ color: t.faint, fontSize: 11, textAlign: "center" }}>··· {lines.length} unchanged lines ···</Text>
                  </Pressable>
                ) : (
                  <>
                    {show("ours") && pre(text)}
                    {!narrow && <View style={{ width: 44 }} />}
                    {show("result") && pre(text)}
                    {!narrow && <View style={{ width: 44 }} />}
                    {show("theirs") && pre(text)}
                  </>
                )}
              </View>
            );
          }
          const idx = ++k;
          const r = res[idx];
          if (!r) return null;
          const result = resultLines(c, r).join("\n");
          const gutter = (side: SideName) =>
            r[side] === "pending" ? (
              <View style={{ width: 44, alignItems: "center", justifyContent: "center", gap: 4 }}>
                <Pressable onPress={() => update(idx, (x) => applySide(x, side))} hitSlop={4} accessibilityLabel={side === "ours" ? "Apply left into result" : "Apply right into result"}>
                  <Text style={{ color: t.accent, fontSize: 16, fontWeight: "700" }}>{side === "ours" ? "»" : "«"}</Text>
                </Pressable>
                <Pressable onPress={() => update(idx, (x) => ignoreSide(x, side))} hitSlop={4} accessibilityLabel="Ignore this side">
                  <Text style={{ color: t.dim, fontSize: 14 }}>×</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => update(idx, (x) => ({ ...x, [side]: "pending", order: x.order.filter((s) => s !== side), manual: null }))}
                style={{ width: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: r[side] === "applied" ? t.green : t.faint, fontSize: 14 }}>{r[side] === "applied" ? "✓" : "–"}</Text>
              </Pressable>
            );
          const oursText = c.ours!.join("\n");
          const theirsText = c.theirs!.join("\n");
          return (
            <Pressable
              key={ci}
              onLayout={(e) => (offsets.current[ci] = e.nativeEvent.layout.y)}
              onPress={() => setCurrent(conflictIdx.indexOf(ci))}
              style={{
                flexDirection: narrow ? "column" : "row",
                borderTopWidth: 1,
                borderBottomWidth: 1,
                borderColor: t.border,
                borderLeftWidth: conflictIdx[current] === ci ? 3 : 0,
                borderLeftColor: t.accent,
                opacity: isResolved(r) ? 0.9 : 1,
              }}
            >
              {show("ours") && (
                <View style={{ flex: 1, flexDirection: "row", backgroundColor: sideBg(r.ours) }}>
                  {pre(oursText)}
                  {narrow && gutter("ours")}
                </View>
              )}
              {!narrow && gutter("ours")}
              {show("result") && (
                <TextInput
                  value={result}
                  onChangeText={(v) => update(idx, (x) => ({ ...x, manual: v }))}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={c.base ? "(empty)" : "(choose a side)"}
                  style={[mono(t), { flex: 1, color: t.text, backgroundColor: isResolved(r) ? "transparent" : t.light ? "#fff8e6" : "rgba(232,162,67,.10)", padding: 4, minHeight: 18 * Math.max(1, c.ours!.length, c.theirs!.length), textAlignVertical: "top" }]}
                />
              )}
              {!narrow && gutter("theirs")}
              {show("theirs") && (
                <View style={{ flex: 1, flexDirection: "row", backgroundColor: sideBg(r.theirs) }}>
                  {narrow && gutter("theirs")}
                  {pre(theirsText)}
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------- interactive rebase

type Action = "pick" | "reword" | "squash" | "fixup" | "drop";
interface Step {
  hash: string;
  subject: string;
  action: Action;
  message: string;
}

function RebaseDialog({ base, onClose }: { base: string | null; onClose: () => void }) {
  const { repo, git, data, actions: a, t } = useRepo();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    git.rebaseCommits(repo, base).then(
      (cs) => setSteps(cs.map((c) => ({ hash: c.hash, subject: c.subject, action: "pick", message: c.subject }))),
      (e) => setError(errorMessage(e)),
    );
  }, [git, repo, base]);
  const update = (i: number, patch: Partial<Step>) => setSteps((s) => s!.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const n = [...s!];
      const j = i + d;
      if (j < 0 || j >= n.length) return n;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const kept = steps?.filter((s) => s.action !== "drop") ?? [];
  const invalid = kept.length > 0 && (kept[0].action === "squash" || kept[0].action === "fixup");
  const wip = data.status.staged.length + data.status.unstaged.filter((f) => !f.untracked).length;
  const start = async () => {
    if (!steps) return;
    onClose();
    // WHY: steps carry full messages so reword needs no editor; see interactiveRebase in core-node/git.ts.
    await a.run("Interactive rebase", () => git.interactiveRebase(repo, base, steps.map((s) => ({ action: s.action, hash: s.hash, message: s.message }))), { success: "Rebase complete" });
  };
  const ACTIONS: Action[] = ["pick", "reword", "squash", "fixup", "drop"];
  return (
    <Modal title={`Interactive rebase ${data.refs.head ?? "HEAD"} onto ${base ? (base.length === 40 ? base.slice(0, 7) : base) : "root"}`} open onOpenChange={(o) => !o && onClose()}>
      <Modal.Content>
        {error ? <Text style={{ color: t.red }}>{error}</Text> : null}
        {wip > 0 && <Text style={{ color: t.orange }}>Commit or stash your changes before rebasing.</Text>}
        {invalid && <Text style={{ color: t.orange }}>The first commit cannot be squashed or fixed up — there is nothing before it to combine into.</Text>}
        <Text style={{ color: t.dim, fontSize: 12 }}>Commits are applied top to bottom. Squash/fixup combine a commit into the one above it.</Text>
        {!steps && !error ? <Loading /> : null}
        {steps?.length === 0 && <Text style={{ color: t.dim }}>No commits to rebase.</Text>}
        {steps?.map((s, i) => (
          <View key={s.hash} style={{ gap: 4, opacity: s.action === "drop" ? 0.5 : 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Pressable onPress={() => update(i, { action: ACTIONS[(ACTIONS.indexOf(s.action) + 1) % ACTIONS.length] })} style={{ width: 64, paddingVertical: 3, borderRadius: 4, borderWidth: 1, borderColor: t.border, alignItems: "center" }}>
                <Text style={{ color: t.text, fontSize: 11, textTransform: "capitalize" }}>{s.action}</Text>
              </Pressable>
              <Text style={{ fontFamily: t.mono, fontSize: 11, color: t.accent }}>{s.hash.slice(0, 7)}</Text>
              <Text style={{ color: t.text, fontSize: 12, flex: 1, textDecorationLine: s.action === "drop" ? "line-through" : "none" }} numberOfLines={1}>
                {s.subject}
              </Text>
              <Pressable disabled={i === 0} onPress={() => move(i, -1)} hitSlop={4}>
                <Icon name="ArrowUp" size={14} color={i === 0 ? t.border : t.dim} />
              </Pressable>
              <Pressable disabled={i === steps.length - 1} onPress={() => move(i, 1)} hitSlop={4}>
                <Icon name="ArrowDown" size={14} color={i === steps.length - 1 ? t.border : t.dim} />
              </Pressable>
            </View>
            {s.action === "reword" && (
              <TextInput value={s.message} onChangeText={(m) => update(i, { message: m })} multiline style={{ color: t.text, borderWidth: 1, borderColor: t.border, borderRadius: 4, padding: 6, minHeight: 60, fontSize: 12 }} />
            )}
          </View>
        ))}
        <Text style={{ color: t.faint, fontSize: 11 }}>Tap the action to cycle Pick → Reword → Squash → Fixup → Drop.</Text>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Button t={t} label="Cancel" onPress={onClose} />
          <Button t={t} label="Start rebase" kind="green" disabled={!steps?.length || invalid || wip > 0} onPress={() => void start()} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
