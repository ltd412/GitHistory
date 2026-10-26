// Top bar, like the desktop Toolbar: repository · branch picker | Undo Redo | Pull Push Branch Stash Pop |
// Fetch. Pull/Push long-press (right-click on web) opens their option menus. On a phone the labels go
// and a sidebar button comes first.
import { Icon } from "./ui/sdk";
import { Pressable, Text, View } from "react-native";
import type { MenuItem } from "../shared/core/menus";
import { localBranchMenu } from "../shared/core/menus";
import { useRepo } from "./RepoContext";
import { active } from "./theme";
import { useUi } from "./ui/Dialogs";

const contextMenu = (fn: () => void) => ({ onContextMenu: (e: { preventDefault?: () => void }) => (e.preventDefault?.(), fn()) }) as object;

export function Toolbar({ title }: { title: string }) {
  const ctx = useRepo();
  const { data, actions: a, busy, progress, history: hist, t, narrow } = ctx;
  const ui = useUi();
  const current = data.refs.local.find((b) => b.current);
  const branchLabel = data.refs.headDetached ? `${data.refs.headSha?.slice(0, 7)} (detached)` : (data.refs.head ?? "—");
  // The undo history lives in memory; after a reload Undo can still take back a merge at the branch tip.
  const tipCommit = current ? data.commits.find((c) => c.hash === current.target) : undefined;
  const mergeTip = tipCommit && tipCommit.parents.length > 1 && data.state.state === "clean" ? tipCommit : undefined;

  const branchPicker = () => {
    const items: MenuItem[] = [{ header: "Local branches" }];
    for (const b of data.refs.local) items.push({ label: (b.current ? "✓ " : "   ") + b.name, onClick: () => !b.current && a.checkout(b.name) });
    items.push({ separator: true }, { label: "Create branch…", onClick: () => a.createBranch() });
    if (current) items.push({ separator: true }, ...localBranchMenu(ctx, current));
    ui.menu(items, "Branch");
  };
  const pullMenu = () =>
    ui.menu(
      [
        { label: "Fetch all", onClick: a.fetch },
        { label: "Pull (fast-forward if possible)", onClick: () => a.pull("ff") },
        { label: "Pull (fast-forward only)", onClick: () => a.pull("ff-only") },
        { label: "Pull (rebase)", onClick: () => a.pull("rebase") },
      ],
      "Pull",
    );
  const pushMenu = () =>
    ui.menu(
      [
        { label: "Push", onClick: () => a.push() },
        { label: "Force push (--force-with-lease)", onClick: () => a.push({ force: true }), danger: true },
      ],
      "Push",
    );

  const btn = (icon: string, label: string, onPress: () => void, opts: { disabled?: boolean; onMenu?: () => void; busy?: boolean } = {}) => (
    <Pressable
      key={label}
      onPress={onPress}
      onLongPress={opts.onMenu}
      {...(opts.onMenu ? contextMenu(opts.onMenu) : {})}
      disabled={opts.disabled}
      accessibilityLabel={label}
      style={(st) => ({
        width: narrow ? 40 : 54,
        height: narrow ? 40 : 46,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        borderRadius: 4,
        backgroundColor: active(st) ? t.hover : "transparent",
        opacity: opts.disabled ? 0.35 : 1,
      })}
    >
      <Icon name={icon} size={narrow ? 18 : 20} color={opts.busy ? t.accent : t.dim} />
      {!narrow && (
        <Text style={{ color: t.dim, fontSize: 10 }} numberOfLines={1}>
          {label}
        </Text>
      )}
      {opts.onMenu && !narrow && <View style={{ position: "absolute", right: 3, top: 14 }}><Icon name="ChevronDown" size={9} color={t.faint} /></View>}
    </Pressable>
  );
  const sep = <View style={{ width: 1, height: 28, backgroundColor: t.border, marginHorizontal: narrow ? 2 : 8 }} />;
  const remotes = data.remotes.length > 0;

  return (
    <View style={{ backgroundColor: t.panel, borderBottomWidth: 1, borderBottomColor: t.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: narrow ? 4 : 10, minHeight: narrow ? 44 : 56, flexWrap: "nowrap" }}>
        {narrow && btn("PanelLeft", "Branches", ctx.openSidebar)}
        {!narrow && (
          <View style={{ paddingHorizontal: 8 }}>
            <Text style={{ color: t.faint, fontSize: 10 }}>repository</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon name="Folder" size={13} color={t.text} />
              <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }} numberOfLines={1}>
                {title}
              </Text>
            </View>
          </View>
        )}
        {!narrow && <Icon name="ChevronRight" size={12} color={t.faint} />}
        <Pressable onPress={branchPicker} style={(st) => ({ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, backgroundColor: active(st) ? t.hover : "transparent", flexShrink: 1 })}>
          {!narrow && <Text style={{ color: t.faint, fontSize: 10 }}>branch</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Icon name="GitBranch" size={13} color={t.text} />
            <Text style={{ color: t.text, fontSize: 14, fontWeight: "600", flexShrink: 1 }} numberOfLines={1}>
              {branchLabel}
            </Text>
            <Icon name="ChevronDown" size={10} color={t.text} />
          </View>
        </Pressable>
        <View style={{ flex: 1 }} />
        {btn("Undo2", "Undo", () => (hist.undo ? a.undo() : mergeTip && a.undoMerge(mergeTip)), { disabled: (!hist.undo && !mergeTip) || !!busy })}
        {btn("Redo2", "Redo", a.redo, { disabled: !hist.redo || !!busy })}
        {sep}
        {btn("ArrowDownToLine", `Pull${current?.behind ? ` ${current.behind}` : ""}`, () => a.pull(), { disabled: !remotes || !!busy, onMenu: pullMenu, busy: busy === "Pull" })}
        {btn("ArrowUpFromLine", `Push${current?.ahead ? ` ${current.ahead}` : ""}`, () => a.push(), { disabled: !remotes || !!busy, onMenu: pushMenu, busy: busy === "Push" })}
        {btn("GitBranchPlus", "Branch", () => a.createBranch(), { disabled: !!busy })}
        {btn("Archive", "Stash", a.stash, { disabled: !!busy })}
        {btn("ArchiveRestore", "Pop", a.pop, { disabled: !!busy || !data.stashes.length })}
        {!narrow && <View style={{ flex: 1 }} />}
        {btn("RefreshCw", "Fetch", a.fetch, { disabled: !remotes || !!busy, busy: busy === "Fetch" })}
      </View>
      {busy ? (
        <View style={{ height: 2, backgroundColor: t.accent }}>
          <Text style={{ position: "absolute", right: 12, bottom: 3, fontSize: 10, color: t.dim }} numberOfLines={1}>
            {busy}… {progress}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
