// Right panel for a commit or a stash (desktop CommitPanel / StashPanel): SHA and parents, full message,
// author and committer, changed files (Path/Tree) or the whole tree, and the same menus.
import { Loading } from "./ui/sdk";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { absoluteTime, avatarColor, initials, relativeTime } from "../shared/core/format";
import { fileCompareItems, rowMenu, stashMenu } from "../shared/core/menus";
import type { CommitDetails, FileChange, Stash } from "../shared/core/types";
import { FileList, ModeToggle, Segmented, type ListMode } from "./FileList";
import { useRepo } from "./RepoContext";
import { errorMessage } from "./transport";
import { Button, useUi } from "./ui/Dialogs";
import type { Tokens } from "./theme";

export function Avatar({ name, email, size = 32 }: { name: string; email: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(email || name), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#fff", fontSize: size * 0.36, fontWeight: "700" }}>{initials(name)}</Text>
    </View>
  );
}

/**
 * Panel title bar. Always one line: a long branch or ref name (`detail`) is shown in its own case and cut
 * in the middle, so the start and end of e.g. `fix-merchants-config-…-hotfix` both stay readable.
 */
export function PanelHead({ t, title, detail, right }: { t: Tokens; title: string; detail?: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 38, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: 6 }}>
        <Text style={{ color: t.dim, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, flexShrink: 0 }} numberOfLines={1}>
          {title.toUpperCase()}
        </Text>
        {detail ? (
          <Text style={{ color: t.text, fontSize: 12, fontWeight: "700", flexShrink: 1, minWidth: 0 }} numberOfLines={1} ellipsizeMode="middle">
            {detail}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const code = (t: Tokens) => ({ fontFamily: t.mono, fontSize: 11, color: t.accent, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, backgroundColor: t.panel2 });

export function CommitPanel({ hash }: { hash: string }) {
  const ctx = useRepo();
  const { repo, git, data, center, setCenter, actions: a, t } = ctx;
  const ui = useUi();
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ListMode>("path");
  const [view, setView] = useState<"changes" | "all">("changes");
  const [tree, setTree] = useState<FileChange[] | null>(null);

  useEffect(() => {
    git.commitDetails(repo, hash).then(setDetails, (e) => setError(errorMessage(e)));
  }, [git, repo, hash]);
  useEffect(() => {
    if (view !== "all" || tree) return;
    git.lsTree(repo, hash).then((paths) => setTree(paths.map((p) => ({ path: p, status: " " }))), () => setTree([]));
  }, [git, repo, hash, view, tree]);

  if (error) return <Text style={{ color: t.red, padding: 16 }}>{error}</Text>;
  if (!details) return <Loading />;

  const [subject, ...bodyLines] = details.message.split("\n");
  const body = bodyLines.join("\n").trim();
  const sameCommitter = details.committer === details.author && details.committerEmail === details.email;
  const listed = data.commits.find((c) => c.hash === hash);
  const showDiff = (f: FileChange) => setCenter({ kind: "diff", source: { kind: "commit", hash }, file: f });
  const fileMenu = (f: FileChange) =>
    ui.menu(
      [
        { label: "View diff", onClick: () => showDiff(f) },
        ...(f.status === "D" ? [] : fileCompareItems(ctx, f.path)),
        { label: "File history", onClick: () => setCenter({ kind: "history", file: f.path }) },
        { label: "File blame at this commit", onClick: () => setCenter({ kind: "blame", file: f.path, rev: hash }), disabled: f.status === "D" },
        { separator: true },
        { label: "Restore file from this commit", onClick: () => void a.run("Restore file", () => git.restoreFile(repo, f.status === "D" ? `${hash}^` : hash, f.path)) },
        { label: "View file at this commit", onClick: () => setCenter({ kind: "file", file: f.path, rev: f.status === "D" ? `${hash}^` : hash }) },
        { label: "Copy file path", onClick: () => a.copy(f.path, "Path") },
      ],
      f.path,
    );

  return (
    <View style={{ flex: 1 }}>
      <PanelHead t={t} title="Commit" right={listed ? <Button t={t} label="Actions ▾" onPress={() => ui.menu(rowMenu(ctx, listed, ctx.labels.get(listed.hash) ?? []), listed.subject)} /> : null} />
      <ScrollView>
        <View style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Text style={{ color: t.dim, fontSize: 11 }}>commit:</Text>
            <Pressable onPress={() => a.copy(details.hash, "SHA")}>
              <Text style={code(t)}>{details.hash.slice(0, 7)}</Text>
            </Pressable>
            {details.parents.length > 0 && <Text style={{ color: t.dim, fontSize: 11 }}>parent{details.parents.length > 1 ? "s" : ""}:</Text>}
            {details.parents.map((p) => (
              <Pressable key={p} onPress={() => ctx.jumpTo(p)}>
                <Text style={code(t)}>{p.slice(0, 7)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={{ color: t.text, fontSize: 13, lineHeight: 19 }} selectable>
            <Text style={{ fontWeight: "700", color: t.strong }}>{subject}</Text>
            {body ? `\n\n${body}` : ""}
          </Text>
          <Who t={t} name={details.author} email={details.email} line={`authored ${relativeTime(details.time)} · ${absoluteTime(details.time)}`} />
          {!sameCommitter && <Who t={t} name={details.committer} email={details.committerEmail} size={24} line={`committed ${relativeTime(details.committerTime)}`} />}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Segmented
            t={t}
            value={view}
            onChange={setView}
            options={[
              { value: "changes", label: `${details.files.length} changed` },
              { value: "all", label: "All files" },
            ]}
          />
          <Text style={{ color: t.dim, fontSize: 11, flex: 1 }}>{view === "changes" && details.parents.length > 1 ? "(vs. first parent)" : ""}</Text>
          {view === "changes" && <ModeToggle t={t} mode={mode} onChange={setMode} />}
        </View>
        {view === "changes" ? (
          <FileList
            t={t}
            files={details.files}
            mode={mode}
            showStats
            selected={center.kind === "diff" && center.source.kind === "commit" ? center.file.path : null}
            onPress={showDiff}
            onMenu={fileMenu}
          />
        ) : tree ? (
          <FileList
            t={t}
            files={tree}
            mode="tree"
            hideStatus
            startCollapsed
            selected={center.kind === "file" && center.rev === hash ? center.file : null}
            onPress={(f) => setCenter({ kind: "file", file: f.path, rev: hash })}
          />
        ) : (
          <Loading />
        )}
      </ScrollView>
    </View>
  );
}

function Who({ t, name, email, line, size = 32 }: { t: Tokens; name: string; email: string; line: string; size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Avatar name={name} email={email} size={size} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 13, fontWeight: "600" }}>{name}</Text>
        <Text style={{ color: t.dim, fontSize: 11 }}>{line}</Text>
      </View>
    </View>
  );
}

export function StashPanel({ stash }: { stash: Stash }) {
  const ctx = useRepo();
  const { repo, git, center, setCenter, actions: a, t } = ctx;
  const ui = useUi();
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [mode, setMode] = useState<ListMode>("path");
  useEffect(() => {
    git.stashFiles(repo, stash.hash).then(setFiles, () => setFiles([]));
  }, [git, repo, stash.hash]);
  return (
    <View style={{ flex: 1 }}>
      <PanelHead t={t} title="Stash" right={<Button t={t} label="Actions ▾" onPress={() => ui.menu(stashMenu(ctx, stash), stash.message)} />} />
      <ScrollView>
        <View style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text style={{ color: t.dim, fontSize: 11 }}>
            <Text style={code(t)}>{stash.ref}</Text> {relativeTime(stash.time)}
          </Text>
          <Text style={{ color: t.strong, fontSize: 13, fontWeight: "700" }}>{stash.message}</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Button t={t} label="Apply" kind="green" onPress={() => a.stashApply(stash, false)} />
            <Button t={t} label="Pop" onPress={() => a.stashApply(stash, true)} />
            <Button t={t} label="Delete" kind="danger" onPress={() => a.stashDrop(stash)} />
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", padding: 8, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text style={{ color: t.dim, fontSize: 11, flex: 1 }}>{files?.length ?? 0} files</Text>
          <ModeToggle t={t} mode={mode} onChange={setMode} />
        </View>
        {files ? (
          <FileList
            t={t}
            files={files}
            mode={mode}
            selected={center.kind === "diff" && center.source.kind === "stash" ? center.file.path : null}
            onPress={(f) => setCenter({ kind: "diff", source: { kind: "stash", hash: stash.hash }, file: f })}
          />
        ) : (
          <Loading />
        )}
      </ScrollView>
    </View>
  );
}
