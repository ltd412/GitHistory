// One project tab of the Git screen — the desktop RepoView in React Native: toolbar, sidebar, graph,
// details panel, diff, and the in-progress bar. Wide layouts show the three columns; on a phone the graph
// fills the screen and the sidebar / details open as sheets. Actions are the desktop's own
// (core/actions.ts) running over Paseo RPC.
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Loading, Modal, copyText } from "./ui/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { createActions, type CommandOutput } from "../shared/core/actions";
import { relativeTime } from "../shared/core/format";
import { buildRefLabels, type Actions, type RepoData } from "../shared/core/menus";
import { WORKTREE, type CenterView, type Selection } from "../shared/core/types";
import { historyRpc, jobRpc, readRpc, revisionRpc, snapshotRpc, writeRpc, type RepoRef } from "../shared/rpc";
import { CommitPanel, StashPanel } from "./CommitPanel";
import { ComparePanel } from "./ComparePanel";
import { DiffView } from "./DiffView";
import { CenterViews } from "./FileViews";
import { Graph } from "./Graph";
import { RepoCtx, useRepo, type RepoCtxValue } from "./RepoContext";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { WipPanel } from "./WipPanel";
import { tokens } from "./theme";
import { errorMessage, newOpId, rpcGitClient } from "./transport";
import { Button, DialogProvider, UiProvider, useUi } from "./ui/Dialogs";
import { FloatingFrame } from "./ui/FloatingFrame";

const PAGE = 2000;
/** flows.md F2: the visible tab polls the cheap revision counter; hidden tabs are unmounted. */
const POLL_MS = 1500;
const NARROW_W = 760;

const STATE_LABEL: Record<string, string> = {
  merging: "Merge in progress",
  rebasing: "Rebase in progress",
  "cherry-picking": "Cherry-pick in progress",
  reverting: "Revert in progress",
};

export function RepoTab(props: { repoRef: RepoRef; title: string; theme: PluginScreenProps["theme"]; compact: boolean }) {
  const t = useMemo(() => tokens(props.theme), [props.theme]);
  return (
    <DialogProvider t={t}>
      <RepoTabBody {...props} t={t} />
    </DialogProvider>
  );
}

function RepoTabBody({ repoRef, title, compact, t }: { repoRef: RepoRef; title: string; compact: boolean; t: ReturnType<typeof tokens> }) {
  const ui = useUi();
  const qc = useQueryClient();
  const read = useRpc(readRpc);
  const write = useRpc(writeRpc);
  const job = useRpc(jobRpc);
  const historyCall = useRpc(historyRpc);
  const fetchSnapshot = useRpc(snapshotRpc);
  const fetchRevision = useRpc(revisionRpc);
  const repoKey = JSON.stringify(repoRef);
  const repo = repoRef.kind === "path" ? repoRef.path : repoRef.id;
  const [progress, setProgress] = useState("");
  const git = useMemo(() => rpcGitClient({ read, write, job }, repoRef, setProgress), [read, write, job, repoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [limit, setLimit] = useState(PAGE);
  const snapshot = useQuery({
    queryKey: ["githistory", "snapshot", repoKey, limit],
    queryFn: () => fetchSnapshot({ repo: repoRef, logLimit: limit, logSkip: 0 }),
    placeholderData: (prev) => prev,
  });
  const revision = useQuery({
    queryKey: ["githistory", "revision", repoKey],
    queryFn: () => fetchRevision({ repo: repoRef }),
    refetchInterval: POLL_MS,
  });
  const history = useQuery({
    queryKey: ["githistory", "history", repoKey],
    queryFn: () => historyCall({ repo: repoRef, action: "peek" }),
  });
  // A new revision means the repository changed (here, in a terminal, or by an agent): reload.
  const seenRevision = useRef<number | null>(null);
  useEffect(() => {
    const r = revision.data?.revision;
    if (r == null) return;
    if (seenRevision.current != null && r !== seenRevision.current) {
      void qc.invalidateQueries({ queryKey: ["githistory", "snapshot", repoKey] });
      void qc.invalidateQueries({ queryKey: ["githistory", "history", repoKey] });
    }
    seenRevision.current = r;
  }, [revision.data?.revision, qc, repoKey]);

  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["githistory", "snapshot", repoKey] }),
      qc.invalidateQueries({ queryKey: ["githistory", "history", repoKey] }),
    ]);
  }, [qc, repoKey]);

  const [selection, setSelection] = useState<Selection>(null);
  const [center, setCenter] = useState<CenterView>({ kind: "graph" });
  const [busy, setBusy] = useState<string | null>(null);
  const [rebaseBase, setRebaseBase] = useState<string | null | undefined>(undefined);
  const [cmdOutput, setCmdOutput] = useState<CommandOutput | null>(null);
  const [jump, setJump] = useState<{ hash: string; seq: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // null until measured: deciding phone/desktop layout from a guess opened phone sheets on load.
  const [width, setWidth] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const narrow = width != null && width < NARROW_W;
  const rightW = (width ?? 1300) < 1300 ? 320 : 380;

  const snap = snapshot.data;
  const data: RepoData | null = useMemo(
    () => (snap?.kind === "repo" ? { ...snap, state: { ...snap.state, gitDir: "" } } : null),
    [snap],
  );
  const wipCount = data ? data.status.staged.length + data.status.unstaged.length + data.status.conflicted.length : 0;
  useEffect(() => {
    if (selection == null && wipCount > 0 && width != null && !narrow) setSelection({ kind: "wip" });
  }, [wipCount, selection, narrow, width]);

  const run = useCallback<Actions["run"]>(
    async (label, fn, opts) => {
      setBusy(label);
      setProgress("");
      try {
        await fn();
        if (opts?.success) ui.toast("success", opts.success);
        return true;
      } catch (e) {
        const msg = errorMessage(e);
        // A conflict is not a failure: the operation is paused for the user to resolve it.
        if (/CONFLICT|could not apply|after resolving the conflicts/i.test(msg)) {
          const files = [...msg.matchAll(/Merge conflict in (.+)/g)].map((m) => m[1]);
          ui.toast("info", `${label}: conflicts to resolve`, `${files.length ? files.join(", ") + "\n" : ""}Use "Resolve conflicts" in the orange bar, or "Abort" to go back.`);
        } else ui.toast("error", `${label} failed`, msg);
        return false;
      } finally {
        setBusy(null);
        setProgress("");
        await refresh();
      }
    },
    [ui, refresh],
  );

  const actions = useMemo<Actions | null>(() => {
    if (!data) return null;
    return createActions({
      repo,
      data,
      git,
      ui,
      app: {
        undo: async () => (await historyCall({ repo: repoRef, action: "undo", opId: newOpId() })).label,
        redo: async () => (await historyCall({ repo: repoRef, action: "redo", opId: newOpId() })).label,
        copy: (text) => copyText(text),
        // plan.md Q3: no shell commands from a remote client.
        runCustom: async () => {
          throw new Error("Custom commands are not available in Paseo");
        },
      },
      errorMessage,
      pullMode: "ff",
      wipCount,
      selection,
      centerKind: center.kind,
      refresh,
      run,
      loadMore: () => setLimit((l) => l + PAGE),
      setSelection,
      setCenter,
      setRebaseBase,
      setRefPick: (p) => {
        const items =
          p.kind === "revisions"
            ? data.commits.filter((c) => c.hash !== p.exclude).map((c) => ({ label: `${c.hash.slice(0, 7)}  ${c.subject}`, hint: `${c.author} · ${relativeTime(c.time)}`, run: () => p.onPick(c.hash) }))
            : [
                ...(p.worktree ? [{ label: "Working tree (uncommitted changes)", hint: "worktree", run: () => p.onPick(WORKTREE) }] : []),
                ...data.refs.local.map((b) => ({ label: b.name, hint: b.current ? "checked out" : "local", run: () => p.onPick(b.name) })),
                ...data.refs.remote.map((r) => ({ label: r.name, hint: "remote", run: () => p.onPick(r.name) })),
                ...(p.kind === "branches" ? [] : data.refs.tags.map((tg) => ({ label: tg.name, hint: "tag", run: () => p.onPick(`tags/${tg.name}`) }))),
              ].filter((it) => it.label !== p.exclude && `tags/${it.label}` !== p.exclude);
        // Opened after the current menu has closed.
        setTimeout(() => ui.palette(items, p.title), 0);
      },
      setBusy,
      setCmdOutput,
    });
  }, [data, repo, git, ui, historyCall, repoKey, wipCount, selection, center.kind, refresh, run]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels = useMemo(() => (data ? buildRefLabels(data.refs) : new Map()), [data]);

  if (snapshot.isError && !snap) return <Text style={{ color: t.red, padding: 24 }}>{errorMessage(snapshot.error)}</Text>;
  if (!snap) return <Loading />;
  if (snap.kind === "not-a-repo")
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Text style={{ color: t.dim, padding: 24, textAlign: "center" }}>This folder is not a Git repository.</Text>
      </View>
    );
  if (!data || !actions) return <Loading />;

  const ctx: RepoCtxValue = {
    repo,
    git,
    data,
    actions,
    selection,
    select: (s) => {
      setSelection(s);
      if (center.kind === "diff") setCenter({ kind: "graph" });
    },
    center,
    setCenter: (v) => {
      setCenter(v);
      if (v.kind === "graph") setExpanded(false);
    },
    expanded,
    toggleExpanded: () => setExpanded((e) => !e),
    settings: { customCommands: [] },
    busy,
    progress,
    labels,
    history: history.data ?? { undo: null, redo: null },
    t,
    compact: compact || narrow,
    narrow,
    openSidebar: () => setSidebarOpen(true),
    jumpTo: (hash) => {
      setSelection({ kind: "commit", hash });
      setJump((j) => ({ hash, seq: (j?.seq ?? 0) + 1 }));
    },
    jump,
  };

  const detail =
    selection?.kind === "wip" || (selection == null && data.state.state !== "clean") ? (
      <WipPanel />
    ) : selection?.kind === "commit" ? (
      <CommitPanel key={selection.hash} hash={selection.hash} />
    ) : selection?.kind === "stash" ? (
      <StashPanel key={selection.stash.hash} stash={selection.stash} />
    ) : selection?.kind === "compare" ? (
      <ComparePanel key={selection.from + selection.to} from={selection.from} to={selection.to} />
    ) : (
      <Text style={{ color: t.dim, padding: 20, fontStyle: "italic" }}>Select a commit to view its details.</Text>
    );
  // Diffs, the merge tool, blame, history and file views open in a large floating frame over the sidebar
  // and graph (dinh-chinh-03) — the details panel stays visible to pick another file; ⤢ covers it too.
  // The graph stays mounted underneath, so its scroll and lane position survive.
  const centerView =
    center.kind === "graph" ? null : center.kind === "diff" ? (
      <DiffView key={`${center.file.path}:${JSON.stringify(center.source)}`} view={center} />
    ) : (
      <CenterViews view={center} />
    );

  // Paseo's Modal renders its content outside this tree, so contexts must be carried in explicitly.
  const carry = (node: React.ReactNode) => (
    <UiProvider value={ui}>
      <RepoCtx.Provider value={ctx}>{node}</RepoCtx.Provider>
    </UiProvider>
  );

  return (
    <RepoCtx.Provider value={ctx}>
      <View style={{ flex: 1, backgroundColor: t.bg }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        <Toolbar title={title} />
        <View style={{ flex: 1, flexDirection: "row" }}>
          {!narrow && (
            <View style={{ width: (width ?? 1300) < 1300 ? 210 : 250, borderRightWidth: 1, borderRightColor: t.border }}>
              <Sidebar />
            </View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            {data.state.state !== "clean" && <StateBar />}
            <Graph />
          </View>
          {!narrow && <View style={{ width: rightW, borderLeftWidth: 1, borderLeftColor: t.border, backgroundColor: t.panel }}>{detail}</View>}
        </View>
        <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 12, paddingVertical: 4, borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.panel }}>
          <Text style={{ color: t.faint, fontSize: 11, flex: 1 }} numberOfLines={1}>
            {repoRef.kind === "path" ? repoRef.path : title}
          </Text>
          <Text style={{ color: t.faint, fontSize: 11 }}>{data.commits.length} commits</Text>
          {!narrow && (
            <Text style={{ color: t.faint, fontSize: 11 }}>
              {data.refs.local.length} branches · {data.refs.tags.length} tags
            </Text>
          )}
        </View>
      </View>
      {centerView && (
        <FloatingFrame t={t} title={frameTitle(center, repoRef.kind === "path" ? title : title)} onClose={() => ctx.setCenter({ kind: "graph" })}>
          {/* The merge tool carries its own Abort / Apply; other views keep the in-progress bar. */}
          {data.state.state !== "clean" && center.kind !== "conflict" && <StateBar />}
          {centerView}
        </FloatingFrame>
      )}
      <Modal title="Branches" open={narrow && sidebarOpen} onOpenChange={setSidebarOpen}>
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0, height: 560 }}>
          {narrow ? carry(<Sidebar onPicked={() => setSidebarOpen(false)} />) : null}
        </Modal.Content>
      </Modal>
      {/* Phone only. Driven by `open`, never by mounting: Paseo's Modal stays up if it is unmounted while
          open, which left this sheet over the wide layout after a brief narrow measurement during load. */}
      <Modal
        title={selection?.kind === "wip" ? "Working tree" : selection?.kind === "stash" ? "Stash" : selection?.kind === "compare" ? "Compare" : "Commit"}
        open={narrow && !!selection && center.kind === "graph"}
        onOpenChange={(o) => !o && setSelection(null)}
      >
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0, height: 620 }}>
          {narrow ? carry(detail) : null}
        </Modal.Content>
      </Modal>
      {cmdOutput && (
        <Modal title={`${cmdOutput.name} — exit code ${cmdOutput.code}`} open onOpenChange={(o) => !o && setCmdOutput(null)}>
          <Modal.Content>
            <Text style={{ color: t.text, fontFamily: t.mono, fontSize: 11 }}>{cmdOutput.stdout || cmdOutput.stderr || "(no output)"}</Text>
          </Modal.Content>
        </Modal>
      )}
      {rebaseBase !== undefined && <CenterViews.Rebase base={rebaseBase} onClose={() => setRebaseBase(undefined)} />}
    </RepoCtx.Provider>
  );
}

function StateBar() {
  const ctx = useRepo();
  const { data, actions: a, setCenter, select, t } = ctx;
  const n = data.status.conflicted.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: t.warnBg, borderBottomWidth: 1, borderBottomColor: "#5a4126", flexWrap: "wrap" }}>
      <Text style={{ color: t.warnText, flex: 1, fontSize: 12 }}>
        <Text style={{ color: t.warnStrong, fontWeight: "700" }}>{STATE_LABEL[data.state.state]}</Text>
        {n ? ` — ${n} conflicted file${n > 1 ? "s" : ""}` : " — no conflicts left, commit or continue to finish"}
      </Text>
      {n > 0 && <Button t={t} label="Resolve conflicts" onPress={() => setCenter({ kind: "conflict", file: data.status.conflicted[0].path })} />}
      {data.state.state === "rebasing" && <Button t={t} label="Skip commit" onPress={a.skip} />}
      {n === 0 && (data.state.state === "merging" ? <Button t={t} label="Commit merge…" kind="green" onPress={() => select({ kind: "wip" })} /> : <Button t={t} label="Continue" kind="green" onPress={a.continueOp} />)}
      <Button
        t={t}
        label={`Abort ${data.state.state === "merging" ? "merge" : data.state.state === "rebasing" ? "rebase" : data.state.state === "cherry-picking" ? "cherry-pick" : "revert"}`}
        kind="danger"
        onPress={a.abort}
      />
    </View>
  );
}


function frameTitle(view: CenterView, repoTitle: string): string {
  const what =
    view.kind === "diff"
      ? `Diff — ${view.file.path}`
      : view.kind === "conflict"
        ? `Merge conflict — ${view.file}`
        : view.kind === "history"
          ? `History — ${view.file}`
          : view.kind === "blame"
            ? `Blame — ${view.file}`
            : view.kind === "file"
              ? `${view.file} @ ${view.rev.slice(0, 7)}`
              : "";
  return `${repoTitle} · ${what}`;
}
