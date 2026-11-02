// Branches pane of the JetBrains-style log (desktop jb/JbBranches.tsx): a searchable tree of HEAD, local
// branches (folders by "/"), remotes and tags. Press shows the ref's commit in the log, long-press (right
// click on web) opens the menu with "Show only this branch" plus the usual branch / tag actions.
import { Icon, TextInput } from "../ui/sdk";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { buildBranchTree, refTarget, type BranchNode } from "../../shared/core/jb";
import { localBranchMenu, remoteBranchMenu, tagMenu } from "../../shared/core/menus";
import { useRepo } from "../RepoContext";
import { active } from "../theme";
import { useUi } from "../ui/Dialogs";
import { useJbFilter } from "./JbFilter";

const contextMenu = (fn: () => void) => ({ onContextMenu: (e: { preventDefault?: () => void }) => (e.preventDefault?.(), fn()) }) as object;

export function JbBranches({ onPicked }: { onPicked?: () => void }) {
  const ctx = useRepo();
  const { data, actions: a, t } = ctx;
  const ui = useUi();
  const { filter, setFilter } = useJbFilter();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildBranchTree(data.refs, query), [data.refs, query]);
  const q = query.trim();
  const jb = t.jb;

  const toggle = (id: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const show = (n: BranchNode) => {
    const target = n.ref ? refTarget(data.refs, n.ref) : null;
    if (!target) return;
    ctx.jumpTo(target);
    onPicked?.();
  };
  const showOnly = (n: BranchNode) => {
    setFilter({ ...filter, branch: n.ref ?? null });
    onPicked?.();
  };
  const menu = (n: BranchNode) => {
    const only = { label: "Show Only This Branch in the Log", onClick: () => showOnly(n) };
    if (n.local) ui.menu([only, { separator: true }, ...localBranchMenu(ctx, n.local)], n.label);
    else if (n.remote) ui.menu([only, { separator: true }, ...remoteBranchMenu(ctx, n.remote)], n.label);
    else if (n.tag) ui.menu([only, { separator: true }, ...tagMenu(ctx, n.tag)], n.label);
    else if (n.id === "head") ui.menu([only], "HEAD");
  };

  const row = (n: BranchNode, depth: number): React.ReactNode => {
    const expandable = n.children.length > 0;
    const expanded = !closed.has(n.id) || !!q;
    const shown = !!filter.branch && n.ref === filter.branch;
    const isGroup: boolean = n.kind === "group";
    const cur = !!n.current && !isGroup;
    const icon = n.kind === "tag" ? "Tag" : n.kind === "remote" ? "Cloud" : n.kind === "folder" ? "Folder" : n.kind === "group" && n.id !== "head" ? null : "GitBranch";
    return (
      <View key={n.id}>
        <Pressable
          onPress={() => (expandable ? toggle(n.id) : show(n))}
          onLongPress={n.ref ? () => menu(n) : undefined}
          {...(n.ref ? contextMenu(() => menu(n)) : {})}
          style={(st) => ({ flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingLeft: 6 + depth * 16, paddingRight: 8, backgroundColor: active(st) ? jb.treeHover : "transparent" })}
        >
          <View style={{ width: 12, alignItems: "center" }}>{expandable && <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={10} color={jb.fgSecondary} />}</View>
          {icon && <Icon name={icon} size={14} color={cur ? jb.accent : jb.fgSecondary} />}
          <Text style={{ flex: 1, minWidth: 0, color: shown ? jb.accent : cur ? jb.fgStrong : t.text, fontWeight: isGroup || cur ? "600" : "400", fontSize: 13 }} numberOfLines={1}>
            {n.label}
          </Text>
          {n.local && (n.local.behind > 0 || n.local.ahead > 0) && (
            <Text style={{ color: jb.fgSubtle, fontSize: 11 }}>
              {n.local.behind > 0 ? `${n.local.behind}↓ ` : ""}
              {n.local.ahead > 0 ? `${n.local.ahead}↑` : ""}
            </Text>
          )}
        </Pressable>
        {expandable && expanded && n.children.map((c) => row(c, depth + 1))}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ height: 34, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <View style={{ flex: 1, height: 24, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 7, borderRadius: 4, borderWidth: 1, borderColor: jb.borderStrong, backgroundColor: t.input }}>
          <Icon name="Search" size={12} color={jb.fgSecondary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Branch or tag" autoCapitalize="none" autoCorrect={false} style={{ flex: 1, minWidth: 0, color: t.text, fontSize: 12, paddingVertical: 0 }} />
        </View>
        <Pressable onPress={() => a.createBranch()} hitSlop={6} accessibilityLabel="New branch" style={{ padding: 4 }}>
          <Icon name="Plus" size={14} color={jb.fgSecondary} />
        </Pressable>
        <Pressable onPress={a.fetch} hitSlop={6} accessibilityLabel="Fetch" style={{ padding: 4 }}>
          <Icon name="RefreshCw" size={13} color={jb.fgSecondary} />
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        {tree.map((n) => row(n, 0))}
        {!tree.length && <Text style={{ color: t.faint, padding: 16, textAlign: "center" }}>No matching branches</Text>}
      </ScrollView>
    </View>
  );
}
