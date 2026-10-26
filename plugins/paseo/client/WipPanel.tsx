// Working tree panel (desktop WipPanel): conflicted / unstaged / staged files with per-file stage buttons,
// the in-progress banner, and the commit box (summary, description, amend, push after commit).
import { Icon, TextInput } from "./ui/sdk";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import type { GitClient } from "../shared/core/git-client";
import { fileCompareItems, type MenuItem } from "../shared/core/menus";
import type { FileChange } from "../shared/core/types";
import { FileList, ModeToggle, type ListMode } from "./FileList";
import { PanelHead } from "./CommitPanel";
import { useRepo } from "./RepoContext";
import { Button, useUi } from "./ui/Dialogs";

const SUMMARY_LIMIT = 72;
// Drafts outlive the panel, which unmounts whenever another commit is selected.
const drafts = new Map<string, { summary: string; description: string }>();

const STATE_LABEL: Record<string, string> = {
  merging: "Merge in progress",
  rebasing: "Rebase in progress",
  "cherry-picking": "Cherry-pick in progress",
  reverting: "Revert in progress",
};

export function WipPanel() {
  const ctx = useRepo();
  const { repo, git, data, actions: a, center, setCenter, t } = ctx;
  const ui = useUi();
  const { status, state } = data;
  const [mode, setMode] = useState<ListMode>("path");
  const [summary, setSummary] = useState(() => drafts.get(repo)?.summary ?? "");
  const [description, setDescription] = useState(() => drafts.get(repo)?.description ?? "");
  const [amend, setAmend] = useState(false);
  const [pushAfter, setPushAfter] = useState(false);
  const savedDraft = useRef<{ summary: string; description: string } | null>(null);
  const prefilledMerge = useRef("");
  useEffect(() => {
    drafts.set(repo, { summary, description });
  }, [repo, summary, description]);

  // Merges, cherry-picks and reverts leave a prepared message in MERGE_MSG — offer it once.
  useEffect(() => {
    if (state.mergeMsg && state.mergeMsg !== prefilledMerge.current && !summary) {
      prefilledMerge.current = state.mergeMsg;
      const [s, ...rest] = state.mergeMsg.split("\n");
      setSummary(s);
      setDescription(rest.join("\n").trim());
    }
  }, [state.mergeMsg, summary]);

  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (on) {
      savedDraft.current = { summary, description };
      const msg = await git.lastCommitMessage(repo);
      const [s, ...rest] = msg.split("\n");
      setSummary(s);
      setDescription(rest.join("\n").trim());
    } else if (savedDraft.current) {
      setSummary(savedDraft.current.summary);
      setDescription(savedDraft.current.description);
    }
  };

  const total = status.staged.length + status.unstaged.length + status.conflicted.length;
  const canCommit = summary.trim().length > 0 && (status.staged.length > 0 || amend) && status.conflicted.length === 0;
  const doCommit = async () => {
    if (!canCommit) return;
    const message = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim();
    const isContinue = state.state === "rebasing" || state.state === "cherry-picking" || state.state === "reverting";
    const ok = await a.run(amend ? "Amend" : "Commit", async () => {
      await git.commit(repo, message, { amend });
      if (isContinue) await git.continueOp(repo);
    });
    if (ok) {
      const wasAmend = amend;
      setSummary("");
      setDescription("");
      setAmend(false);
      savedDraft.current = null;
      if (center.kind === "diff") setCenter({ kind: "graph" });
      // Amending rewrites a commit that may already be on the remote: never force-push implicitly.
      if (pushAfter && !wasAmend && !isContinue && data.remotes.length) a.push();
    }
  };

  const selectedPath = center.kind === "diff" && (center.source.kind === "unstaged" || center.source.kind === "staged") ? `${center.source.kind}:${center.file.path}` : null;
  const fileMenu = (f: FileChange, staged: boolean) => {
    const items: MenuItem[] = [
      staged
        ? { label: "Unstage file", onClick: () => void a.run("Unstage", () => git.unstage(repo, [f.path])) }
        : { label: "Stage file", onClick: () => void a.run("Stage", () => git.stage(repo, [f.path])) },
    ];
    if (!staged)
      items.push({
        label: "Discard changes",
        danger: true,
        onClick: async () => {
          if (await ui.confirm("Discard changes?", `${f.path}\n\nThis cannot be undone.`, { danger: true, confirm: "Discard" })) void a.run("Discard", () => git.discard(repo, [f]));
        },
      });
    items.push(
      { separator: true },
      ...(f.untracked ? [] : fileCompareItems(ctx, f.path)),
      { label: "File history", onClick: () => setCenter({ kind: "history", file: f.path }), disabled: !!f.untracked },
      { label: "File blame", onClick: () => setCenter({ kind: "blame", file: f.path }), disabled: !!f.untracked },
      { separator: true },
    );
    if (f.untracked) {
      const ext = /\.[^./]+$/.exec(f.path)?.[0];
      items.push({ label: `Ignore ${f.path}`, onClick: () => void a.run("Ignore", () => appendIgnore(git, repo, f.path)) });
      if (ext) items.push({ label: `Ignore all *${ext} files`, onClick: () => void a.run("Ignore", () => appendIgnore(git, repo, `*${ext}`)) });
      items.push({ separator: true });
    }
    items.push({ label: "Copy file path", onClick: () => a.copy(f.path, "Path") });
    ui.menu(items, f.path);
  };
  const conflictMenu = (f: FileChange) =>
    ui.menu(
      [
        { label: "Resolve in merge tool", onClick: () => setCenter({ kind: "conflict", file: f.path }) },
        { separator: true },
        { label: "Take ours (current branch)", onClick: () => void a.run("Resolve", () => git.resolveConflict(repo, f.path, "ours")) },
        { label: "Take theirs (incoming)", onClick: () => void a.run("Resolve", () => git.resolveConflict(repo, f.path, "theirs")) },
        { label: "Mark as resolved", onClick: () => void a.run("Resolve", () => git.resolveConflict(repo, f.path, "mark")) },
      ],
      f.path,
    );

  const branch = data.refs.headDetached ? "detached HEAD" : (data.refs.head ?? "HEAD");
  const sectionHead = (label: string, color: string, button?: { label: string; kind: "green" | "danger"; disabled: boolean; onPress: () => void }) => (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, gap: 8, backgroundColor: t.panel2 }}>
      <Text style={{ color, fontSize: 11, fontWeight: "700", flex: 1 }}>{label}</Text>
      {button && <Button t={t} label={button.label} kind={button.kind} disabled={button.disabled} onPress={button.onPress} />}
    </View>
  );
  const smallBtn = (label: string, color: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, backgroundColor: color }}>
      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
  const commitLabel = status.conflicted.length
    ? "Resolve conflicts to commit"
    : amend
      ? "Amend previous commit"
      : status.staged.length
        ? state.state === "merging"
          ? "Commit and merge"
          : `Commit${pushAfter && data.remotes.length ? " & Push" : ""} changes to ${status.staged.length} file${status.staged.length === 1 ? "" : "s"}`
        : "Stage files/changes to commit";
  const input = { color: t.text, backgroundColor: t.input, borderWidth: 1, borderColor: t.border, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13 };

  return (
    <View style={{ flex: 1 }}>
      <PanelHead
        t={t}
        title={`${total} file change${total === 1 ? "" : "s"} on`}
        detail={branch}
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ModeToggle t={t} mode={mode} onChange={setMode} />
            <Pressable
              disabled={!total}
              accessibilityLabel="Discard all changes"
              onPress={async () => {
                if (await ui.confirm("Discard all changes?", "All staged, unstaged and untracked changes will be lost. This cannot be undone.", { danger: true, confirm: "Discard all" }))
                  void a.run("Discard all", () => git.discardAll(repo));
              }}
            >
              <Icon name="Trash2" size={14} color={total ? t.dim : t.border} />
            </Pressable>
          </View>
        }
      />
      {state.state !== "clean" && (
        <View style={{ padding: 12, gap: 8, backgroundColor: t.warnBg, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text style={{ color: t.warnStrong, fontWeight: "700" }}>{STATE_LABEL[state.state]}</Text>
          <Text style={{ color: t.warnText, fontSize: 12 }}>
            {status.conflicted.length ? `${status.conflicted.length} conflicted file(s). Resolve them, then continue.` : "All conflicts resolved. Commit or continue to finish."}
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Button t={t} label="Abort" kind="danger" onPress={a.abort} />
            {state.state === "rebasing" && <Button t={t} label="Skip commit" onPress={a.skip} />}
            {state.state !== "merging" && <Button t={t} label="Continue" kind="green" disabled={status.conflicted.length > 0} onPress={a.continueOp} />}
          </View>
        </View>
      )}
      <ScrollView style={{ flex: 1 }}>
        {status.conflicted.length > 0 && (
          <>
            {sectionHead(`Conflicted Files (${status.conflicted.length})`, t.red)}
            <FileList t={t} files={status.conflicted} mode={mode} selected={center.kind === "conflict" ? center.file : null} onPress={(f) => setCenter({ kind: "conflict", file: f.path })} onMenu={conflictMenu} />
          </>
        )}
        {sectionHead(`Unstaged Files (${status.unstaged.length})`, t.dim, {
          label: "Stage all changes",
          kind: "green",
          disabled: !status.unstaged.length,
          onPress: () => void a.run("Stage all", () => git.stageAll(repo)),
        })}
        {status.unstaged.length ? (
          <FileList
            t={t}
            files={status.unstaged}
            mode={mode}
            selected={selectedPath?.startsWith("unstaged:") ? selectedPath.slice(9) : null}
            onPress={(f) => setCenter({ kind: "diff", source: { kind: "unstaged" }, file: f })}
            onMenu={(f) => fileMenu(f, false)}
            action={(f) => smallBtn("Stage", t.green, () => void a.run("Stage", () => git.stage(repo, [f.path])))}
          />
        ) : (
          <Text style={{ color: t.faint, padding: 12, fontSize: 12 }}>No unstaged changes</Text>
        )}
        {sectionHead(`Staged Files (${status.staged.length})`, t.dim, {
          label: "Unstage all changes",
          kind: "danger",
          disabled: !status.staged.length,
          onPress: () => void a.run("Unstage all", () => git.unstageAll(repo)),
        })}
        {status.staged.length ? (
          <FileList
            t={t}
            files={status.staged}
            mode={mode}
            selected={selectedPath?.startsWith("staged:") ? selectedPath.slice(7) : null}
            onPress={(f) => setCenter({ kind: "diff", source: { kind: "staged" }, file: f })}
            onMenu={(f) => fileMenu(f, true)}
            action={(f) => smallBtn("Unstage", t.red, () => void a.run("Unstage", () => git.unstage(repo, [f.path])))}
          />
        ) : (
          <Text style={{ color: t.faint, padding: 12, fontSize: 12 }}>No staged files</Text>
        )}
      </ScrollView>
      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.panel }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ color: t.text, fontWeight: "700", flex: 1 }}>Commit</Text>
          <Text style={{ color: t.dim, fontSize: 11 }}>Push after</Text>
          <Switch value={pushAfter} disabled={!data.remotes.length} onValueChange={setPushAfter} />
          <Text style={{ color: t.dim, fontSize: 11 }}>Amend</Text>
          <Switch value={amend} disabled={!data.refs.headSha} onValueChange={(v) => void toggleAmend(v)} />
        </View>
        <View>
          <TextInput value={summary} onChangeText={setSummary} placeholder="Summary" style={[input, { paddingRight: 40 }]} />
          <Text style={{ position: "absolute", right: 8, top: 8, fontSize: 11, color: summary.length > SUMMARY_LIMIT ? t.red : t.faint }}>{SUMMARY_LIMIT - summary.length}</Text>
        </View>
        <TextInput value={description} onChangeText={setDescription} placeholder="Description" multiline style={[input, { minHeight: 64, textAlignVertical: "top" }]} />
        <Button t={t} label={commitLabel} kind="green" disabled={!canCommit} onPress={() => void doCommit()} />
      </View>
    </View>
  );
}

async function appendIgnore(git: GitClient, repo: string, pattern: string) {
  let current = "";
  try {
    current = await git.readWorkingFile(repo, ".gitignore");
  } catch {
    /* no .gitignore yet */
  }
  const sep = current && !current.endsWith("\n") ? "\n" : "";
  await git.writeWorkingFile(repo, ".gitignore", `${current}${sep}${pattern}\n`);
}
