// Right pane / phone sheet of the JetBrains-style log (desktop jb/JbDetails.tsx): the commit's changed files
// as a tree with a count on top, and below it the full message with hash, author and date.
import { Icon, Loading } from "../ui/sdk";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { absoluteTime } from "../../shared/core/format";
import { buildFileTree, folderPaths, jbTime, type FileNode } from "../../shared/core/jb";
import { fileCompareItems, rowMenu } from "../../shared/core/menus";
import type { CommitDetails, FileChange } from "../../shared/core/types";
import { useRepo } from "../RepoContext";
import { active } from "../theme";
import { errorMessage } from "../transport";
import { useUi } from "../ui/Dialogs";

const STATUS_COLOR: Record<string, "added" | "modified" | "danger"> = { A: "added", C: "added", M: "modified", R: "modified", D: "danger", U: "danger" };

export function JbDetails({ hash }: { hash: string }) {
  const ctx = useRepo();
  const { repo, git, data, center, setCenter, actions: a, t } = ctx;
  const ui = useUi();
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const jb = t.jb;

  useEffect(() => {
    setDetails(null);
    setError("");
    git.commitDetails(repo, hash).then(setDetails, (e) => setError(errorMessage(e)));
  }, [git, repo, hash]);

  const tree = useMemo(() => buildFileTree(details?.files ?? []), [details]);
  if (error) return <Text style={{ color: t.red, padding: 16 }}>{error}</Text>;
  if (!details) return <Loading />;

  const listed = data.commits.find((c) => c.hash === hash);
  const [subject, ...rest] = details.message.split("\n");
  const body = rest.join("\n").trim();
  const sameCommitter = details.committer === details.author && details.committerEmail === details.email;
  const selectedFile = center.kind === "diff" && center.source.kind === "commit" ? center.file.path : null;
  const toggle = (path: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  const showDiff = (f: FileChange) => setCenter({ kind: "diff", source: { kind: "commit", hash }, file: f });
  const fileMenu = (f: FileChange) =>
    ui.menu(
      [
        { label: "Show Diff", onClick: () => showDiff(f) },
        ...(f.status === "D" ? [] : fileCompareItems(ctx, f.path)),
        { label: "File history", onClick: () => setCenter({ kind: "history", file: f.path }) },
        { label: "Annotate (blame) at this commit", onClick: () => setCenter({ kind: "blame", file: f.path, rev: hash }), disabled: f.status === "D" },
        { separator: true },
        { label: "Restore file from this commit", onClick: () => void a.run("Restore file", () => git.restoreFile(repo, f.status === "D" ? `${hash}^` : hash, f.path)) },
        { label: "View file at this commit", onClick: () => setCenter({ kind: "file", file: f.path, rev: f.status === "D" ? `${hash}^` : hash }) },
        { label: "Copy file path", onClick: () => a.copy(f.path, "Path") },
      ],
      f.path,
    );

  const node = (n: FileNode<FileChange>, depth: number): React.ReactNode => {
    const pad = 6 + depth * 16;
    if (n.dir) {
      const open = !closed.has(n.path);
      return (
        <View key={`d:${n.path}`}>
          <Pressable onPress={() => toggle(n.path)} style={(st) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingLeft: pad, paddingRight: 8, backgroundColor: active(st) ? jb.treeHover : "transparent" })}>
            <Icon name={open ? "ChevronDown" : "ChevronRight"} size={10} color={jb.fgSecondary} />
            <Icon name="Folder" size={14} color={jb.fgSecondary} />
            <Text style={{ color: t.text, fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
              {n.name}
            </Text>
            <Text style={{ color: jb.fgSubtle, fontSize: 11 }}>
              {n.count} {n.count === 1 ? "file" : "files"}
            </Text>
          </Pressable>
          {open && n.children.map((c) => node(c, depth + 1))}
        </View>
      );
    }
    const f = n.file!;
    const color = jb[STATUS_COLOR[f.status[0]] ?? "modified"];
    return (
      <Pressable
        key={`f:${n.path}`}
        onPress={() => showDiff(f)}
        onLongPress={() => fileMenu(f)}
        {...({ onContextMenu: (e: { preventDefault?: () => void }) => (e.preventDefault?.(), fileMenu(f)) } as object)}
        style={(st) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingLeft: pad + 16, paddingRight: 8, backgroundColor: selectedFile === f.path ? jb.treeSelected : active(st) ? jb.treeHover : "transparent" })}
      >
        <Icon name="File" size={14} color={jb.fgSecondary} />
        <Text style={{ color, fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
          {n.name}
        </Text>
        {f.additions != null && (
          <Text style={{ fontSize: 11, color: jb.fgSubtle }}>
            <Text style={{ color: jb.added }}>+{f.additions}</Text> <Text style={{ color: jb.danger }}>−{f.deletions}</Text>
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ height: 34, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <Text style={{ color: jb.fgStrong, fontWeight: "600", fontSize: 13 }}>Commit</Text>
        <Text style={{ color: jb.fgSubtle, fontSize: 12, flex: 1 }} numberOfLines={1}>
          {details.files.length} {details.files.length === 1 ? "file" : "files"}
          {details.parents.length > 1 ? " · vs. first parent" : ""}
        </Text>
        <Pressable onPress={() => setClosed(new Set(folderPaths(tree)))} hitSlop={6} accessibilityLabel="Collapse all">
          <Icon name="ChevronUp" size={13} color={jb.fgSecondary} />
        </Pressable>
        <Pressable onPress={() => setClosed(new Set())} hitSlop={6} accessibilityLabel="Expand all">
          <Icon name="ChevronDown" size={13} color={jb.fgSecondary} />
        </Pressable>
        {listed && (
          <Pressable onPress={() => ui.menu(rowMenu(ctx, listed, ctx.labels.get(listed.hash) ?? []), listed.subject)} hitSlop={6} accessibilityLabel="Commit actions">
            <Text style={{ color: jb.fgSecondary, fontSize: 16, lineHeight: 16 }}>⋯</Text>
          </Pressable>
        )}
      </View>
      <ScrollView style={{ flex: 1, minHeight: 60 }}>
        {tree.map((n) => node(n, 0))}
        {!tree.length && <Text style={{ color: t.faint, padding: 16, textAlign: "center" }}>No files changed</Text>}
      </ScrollView>
      <ScrollView style={{ flexGrow: 0, maxHeight: "45%", borderTopWidth: 1, borderTopColor: t.border }} contentContainerStyle={{ padding: 12 }}>
        <Text style={{ color: jb.fgStrong, fontWeight: "600", fontSize: 13, lineHeight: 20 }} selectable>
          {subject}
        </Text>
        {body ? (
          <Text style={{ color: t.text, fontSize: 13, lineHeight: 20, marginTop: 6 }} selectable>
            {body}
          </Text>
        ) : null}
        <Text style={{ color: jb.fgSubtle, fontSize: 13, lineHeight: 20, marginTop: 10 }} selectable>
          <Text style={{ fontFamily: t.mono, color: jb.link }} onPress={() => a.copy(details.hash, "Hash")}>
            {details.hash.slice(0, 8)}
          </Text>{" "}
          {details.author} &lt;{details.email}&gt; on <Text accessibilityLabel={absoluteTime(details.time)}>{jbTime(details.time)}</Text>
          {!sameCommitter ? `\ncommitted by ${details.committer} on ${jbTime(details.committerTime)}` : ""}
          {details.parents.length > 0 ? `\nparent${details.parents.length > 1 ? "s" : ""}: ` : ""}
          {details.parents.map((p) => (
            <Text key={p} style={{ fontFamily: t.mono, color: jb.link }} onPress={() => ctx.jumpTo(p)}>
              {p.slice(0, 8)}{" "}
            </Text>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
}
