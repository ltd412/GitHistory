// Right panel comparing two revisions (desktop ComparePanel): either side can be changed to any branch,
// tag, commit or the working tree; lists every differing file with +/- totals.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { fileCompareItems } from "../shared/core/menus";
import { WORKTREE, type FileChange } from "../shared/core/types";
import { PanelHead } from "./CommitPanel";
import { revLabel } from "./DiffView";
import { FileList, ModeToggle, type ListMode } from "./FileList";
import { useRepo } from "./RepoContext";
import { errorMessage } from "./transport";
import { Button, useUi } from "./ui/Dialogs";

const isSha = (rev: string) => /^[0-9a-f]{40}$/.test(rev);

export function ComparePanel({ from, to }: { from: string; to: string }) {
  const ctx = useRepo();
  const { repo, git, data, center, setCenter, select, actions: a, t } = ctx;
  const ui = useUi();
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ListMode>("path");
  const [subjects, setSubjects] = useState<Record<string, { sha: string; subject: string }>>({});
  const worktree = to === WORKTREE;

  useEffect(() => {
    setFiles(null);
    git.rangeFiles(repo, from, to).then(
      (f) => (setFiles(f), setError("")),
      (e) => setError(errorMessage(e)),
    );
    // The working-tree side changes as files are edited: follow status updates.
  }, [git, repo, from, to, worktree ? data.status : null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void Promise.all(
      [from, to]
        .filter((r) => r !== WORKTREE)
        .map(async (r) => {
          const sha = await git.revParse(repo, `${r}^{commit}`).catch(() => null);
          const c = sha ? data.commits.find((x) => x.hash === sha) : undefined;
          return [r, { sha: sha ?? "", subject: c?.subject ?? "" }] as const;
        }),
    ).then((entries) => setSubjects(Object.fromEntries(entries)));
  }, [git, repo, from, to, data.commits]);

  const totals = (files ?? []).reduce((s, f) => ({ add: s.add + (f.additions ?? 0), del: s.del + (f.deletions ?? 0) }), { add: 0, del: 0 });
  const change = (which: "from" | "to") =>
    a.pickRef(`Compare: change the ${which === "from" ? "From" : "To"} side`, (r) => select(which === "from" ? { kind: "compare", from: r, to } : { kind: "compare", from, to: r }), { worktree: which === "to" });
  const side = (label: string, rev: string, which: "from" | "to") => {
    const info = subjects[rev];
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ color: t.dim, fontSize: 11, width: 34 }}>{label}:</Text>
        <Button t={t} label="Change…" onPress={() => change(which)} />
        <Pressable onPress={() => info?.sha && a.copy(info.sha, "SHA")}>
          <Text style={{ fontFamily: t.mono, fontSize: 11, color: t.accent }}>{rev === WORKTREE ? "working tree" : isSha(rev) ? rev.slice(0, 7) : `${rev} · ${info?.sha.slice(0, 7) ?? ""}`}</Text>
        </Pressable>
        <Text style={{ color: t.text, fontSize: 12, flex: 1 }} numberOfLines={1}>
          {rev === WORKTREE ? "uncommitted changes included" : info?.subject}
        </Text>
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <PanelHead t={t} title="Compare"
        detail={`${revLabel(from)} ↔ ${revLabel(to)}`} right={<Button t={t} label="⇄ Swap" disabled={worktree} onPress={() => select({ kind: "compare", from: to, to: from })} />} />
      <ScrollView>
        <View style={{ padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: t.border }}>
          {side("From", from, "from")}
          {side("To", to, "to")}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 8, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text style={{ color: t.dim, fontSize: 11, flex: 1 }}>
            {files ? `${files.length} files changed  ` : error ? "Could not compare" : "Loading…"}
            {files ? (
              <>
                <Text style={{ color: t.green }}>+{totals.add}</Text> <Text style={{ color: t.red }}>-{totals.del}</Text>
              </>
            ) : null}
          </Text>
          <ModeToggle t={t} mode={mode} onChange={setMode} />
        </View>
        {error ? <Text style={{ color: t.red, padding: 12 }}>{error}</Text> : null}
        {files?.length === 0 && <Text style={{ color: t.faint, padding: 12 }}>No differences.</Text>}
        {files && (
          <FileList
            t={t}
            files={files}
            mode={mode}
            showStats
            selected={center.kind === "diff" && center.source.kind === "range" ? center.file.path : null}
            onPress={(f) => setCenter({ kind: "diff", source: { kind: "range", from, to }, file: f })}
            onMenu={(f) =>
              ui.menu(
                [
                  { label: "View diff", onClick: () => setCenter({ kind: "diff", source: { kind: "range", from, to }, file: f }) },
                  ...(f.status === "D" ? [] : fileCompareItems(ctx, f.path)),
                  { label: "File history", onClick: () => setCenter({ kind: "history", file: f.path }) },
                  { label: "Copy file path", onClick: () => a.copy(f.path, "Path") },
                ],
                f.path,
              )
            }
          />
        )}
      </ScrollView>
    </View>
  );
}
