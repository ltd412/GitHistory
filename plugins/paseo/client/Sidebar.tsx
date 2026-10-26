// Left panel, like the desktop Sidebar: filter, Local (branches as folders), Remote, Tags, Stashes,
// Submodules. Tap jumps to the commit; long-press (right-click on web) opens the same menus as desktop.
import { Icon, TextInput } from "./ui/sdk";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { localBranchMenu, remoteBranchMenu, stashMenu, tagMenu } from "../shared/core/menus";
import type { LocalBranch, RemoteBranch } from "../shared/core/types";
import { useRepo } from "./RepoContext";
import { active } from "./theme";
import { useUi } from "./ui/Dialogs";

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  leaf?: LocalBranch | RemoteBranch;
}

/** Branch names with slashes (feature/x) are shown as folders, like GitKraken does. */
function buildTree<T extends LocalBranch | RemoteBranch>(items: T[], name: (t: T) => string): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const it of items) {
    const parts = name(it).split("/");
    let node = root;
    parts.forEach((p, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (!node.children.has(p)) node.children.set(p, { name: p, path, children: new Map() });
      node = node.children.get(p)!;
      if (i === parts.length - 1) node.leaf = it;
    });
  }
  return root;
}

const contextMenu = (fn: () => void) => ({ onContextMenu: (e: { preventDefault?: () => void }) => (e.preventDefault?.(), fn()) }) as object;

export function Sidebar({ onPicked }: { onPicked?: () => void }) {
  const ctx = useRepo();
  const { data, actions: a, selection, select, t, git, repo } = ctx;
  const ui = useUi();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const f = filter.toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);
  const toggle = (k: string, def = true) => setCollapsed((c) => ({ ...c, [k]: c[k] === undefined ? def : !c[k] }));
  const isOpen = (k: string, def = true) => (collapsed[k] === undefined ? def : !collapsed[k]);
  const jumpTo = (hash: string) => {
    ctx.jumpTo(hash);
    onPicked?.();
  };

  const item = (key: string, depth: number, opts: { icon: ReactNode; name: string; strong?: boolean; selected?: boolean; right?: ReactNode; onPress: () => void; onMenu?: () => void }) => (
    <Pressable
      key={key}
      onPress={opts.onPress}
      onLongPress={opts.onMenu}
      {...(opts.onMenu ? contextMenu(opts.onMenu) : {})}
      style={(st) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 12 + depth * 14,
        paddingRight: 10,
        height: 26,
        backgroundColor: opts.selected ? t.select : active(st) ? t.hover : "transparent",
      })}
    >
      {opts.icon}
      <Text style={{ color: opts.strong ? t.strong : t.text, fontWeight: opts.strong ? "700" : "400", fontSize: 13, flex: 1 }} numberOfLines={1}>
        {opts.name}
      </Text>
      {opts.right}
    </Pressable>
  );
  const ic = (name: string, color = t.dim) => <Icon name={name} size={12} color={color} />;
  const chevron = (open: boolean) => <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={t.dim} />;

  const renderTree = (node: TreeNode, depth: number, kind: "local" | "remote", prefix: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const entries = [...node.children.values()].sort(
      (x, y) => Number(!!x.leaf && !x.children.size) - Number(!!y.leaf && !y.children.size) || x.name.localeCompare(y.name),
    );
    for (const child of entries) {
      const key = `${prefix}/${child.path}`;
      if (child.children.size) {
        out.push(item(key, depth, { icon: <>{chevron(isOpen(key))}{ic("Folder")}</>, name: child.name, onPress: () => toggle(key) }));
        if (isOpen(key)) out.push(...renderTree(child, depth + 1, kind, prefix));
      }
      if (!child.leaf) continue;
      if (kind === "local") {
        const b = child.leaf as LocalBranch;
        out.push(
          item(key + ":leaf", depth + 1, {
            icon: b.current ? ic("Check", t.green) : ic("GitBranch"),
            name: child.name,
            strong: b.current,
            selected: selection?.kind === "commit" && selection.hash === b.target,
            right: (
              <View style={{ flexDirection: "row", gap: 4 }}>
                {b.behind > 0 && <Text style={{ color: t.dim, fontSize: 10, fontWeight: "700" }}>{b.behind}↓</Text>}
                {b.ahead > 0 && <Text style={{ color: t.dim, fontSize: 10, fontWeight: "700" }}>{b.ahead}↑</Text>}
              </View>
            ),
            onPress: () => jumpTo(b.target),
            onMenu: () => ui.menu(localBranchMenu(ctx, b), b.name),
          }),
        );
      } else {
        const rb = child.leaf as RemoteBranch;
        out.push(
          item(key + ":leaf", depth + 1, {
            icon: ic("GitBranch"),
            name: child.name,
            onPress: () => jumpTo(rb.target),
            onMenu: () => ui.menu(remoteBranchMenu(ctx, rb), rb.name),
          }),
        );
      }
    }
    return out;
  };

  const section = (id: string, title: string, icon: string, count: number, children: () => ReactNode, opts: { onAdd?: () => void; defaultOpen?: boolean } = {}) => {
    const open = isOpen(id, opts.defaultOpen ?? true);
    return (
      <View key={id} style={{ borderBottomWidth: 1, borderBottomColor: t.border }}>
        <Pressable onPress={() => toggle(id, opts.defaultOpen ?? true)} style={(st) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 32, backgroundColor: active(st) ? t.hover : "transparent" })}>
          {chevron(open)}
          {ic(icon)}
          <Text style={{ color: t.dim, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, flex: 1 }}>{title.toUpperCase()}</Text>
          <Text style={{ color: t.faint, fontSize: 11 }}>{count}</Text>
          {opts.onAdd && (
            <Pressable onPress={opts.onAdd} hitSlop={8} accessibilityLabel={`Add ${title}`}>
              <Icon name="Plus" size={13} color={t.dim} />
            </Pressable>
          )}
        </Pressable>
        {open && children()}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.panel }}>
      <View style={{ padding: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.input, borderWidth: 1, borderColor: t.border, borderRadius: 4, paddingHorizontal: 8 }}>
          <Icon name="Search" size={12} color={t.faint} />
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter (branches, tags, stashes)"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, color: t.text, fontSize: 12, paddingVertical: 5 }}
          />
        </View>
      </View>
      <ScrollView>
        {section("local", "Local", "Laptop", data.refs.local.length, () => renderTree(buildTree(data.refs.local.filter((b) => match(b.name)), (b) => b.name), 0, "local", "local"), {
          onAdd: () => a.createBranch(),
        })}
        {section(
          "remote",
          "Remote",
          "Globe",
          data.remotes.length,
          () =>
            data.remotes.map((remote) => {
              const key = `remote:${remote.name}`;
              const branches = data.refs.remote.filter((r) => r.remote === remote.name && match(r.name));
              return (
                <View key={key}>
                  {item(key, 0, {
                    icon: <>{chevron(isOpen(key, false))}{ic("Globe")}</>,
                    name: remote.name,
                    right: <Text style={{ color: t.faint, fontSize: 11 }}>{branches.length}</Text>,
                    onPress: () => toggle(key, false),
                    onMenu: () =>
                      ui.menu(
                        [
                          { label: `Fetch ${remote.name}`, onClick: () => void a.run(`Fetch ${remote.name}`, () => git.fetch(repo, { remote: remote.name })) },
                          { label: "Edit remote…", onClick: () => a.editRemote(remote) },
                          { label: "Copy remote URL", onClick: () => a.copy(remote.fetchUrl, "URL") },
                          { separator: true },
                          { label: `Remove ${remote.name}`, onClick: () => a.removeRemote(remote), danger: true },
                        ],
                        remote.name,
                      ),
                  })}
                  {isOpen(key, false) && renderTree(buildTree(branches, (r) => r.branch), 1, "remote", key)}
                </View>
              );
            }),
          { onAdd: a.addRemote },
        )}
        {section(
          "tags",
          "Tags",
          "Tag",
          data.refs.tags.length,
          () =>
            data.refs.tags
              .filter((tg) => match(tg.name))
              .slice(0, 500)
              .map((tg) => item(`tag:${tg.name}`, 1, { icon: ic("Tag"), name: tg.name, onPress: () => jumpTo(tg.target), onMenu: () => ui.menu(tagMenu(ctx, tg), tg.name) })),
          { defaultOpen: false },
        )}
        {section("stashes", "Stashes", "Archive", data.stashes.length, () =>
          data.stashes
            .filter((s) => match(s.message))
            .map((s) =>
              item(`stash:${s.hash}`, 1, {
                icon: ic("Archive"),
                name: s.message,
                selected: selection?.kind === "stash" && selection.stash.hash === s.hash,
                onPress: () => {
                  select({ kind: "stash", stash: s });
                  onPicked?.();
                },
                onMenu: () => ui.menu(stashMenu(ctx, s), s.message),
              }),
            ),
        )}
        {section(
          "submodules",
          "Submodules",
          "Boxes",
          data.submodules.length,
          () =>
            data.submodules.map((s) =>
              item(`sub:${s.path}`, 1, {
                icon: ic("Boxes"),
                name: s.path,
                right: s.state === "-" ? <Text style={{ color: t.dim, fontSize: 10 }}>not initialized</Text> : s.state === "+" ? <Text style={{ color: t.dim, fontSize: 10 }}>modified</Text> : undefined,
                onPress: () => {},
              }),
            ),
          { defaultOpen: false },
        )}
      </ScrollView>
    </View>
  );
}
