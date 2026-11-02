// The "Git" screen opened from Paseo's sidebar: several projects open side by side as tabs, like the
// desktop app (dinh-chinh-01). A tab is a Paseo workspace or any folder picked on the daemon's machine
// (dinh-chinh-02). Open tabs are saved on the daemon (dinh-chinh-03); only the visible tab is mounted, so only
// it polls.
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "./ui/sdk";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { tabsRpc, updateRpc, workspacesRpc, type RepoRef } from "../shared/rpc";
import type { UiStyle } from "../shared/core/types";
import { StylePicker } from "./StylePicker";
import { ProjectPicker, type PickedProject } from "./ProjectPicker";
import { RepoTab } from "./RepoTab";
import { active as hovered, tokens } from "./theme";

interface Tab extends PickedProject {
  key: string;
}

const keyOf = (ref: RepoRef) => (ref.kind === "workspace" ? `ws:${ref.id}` : `dir:${ref.path}`);

export function GitScreen({ theme, layout, host }: PluginScreenProps) {
  const listWorkspaces = useRpc(workspacesRpc);
  const workspaces = useQuery({ queryKey: ["githistory", "workspaces"], queryFn: () => listWorkspaces({}), refetchInterval: 15_000 });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const c = theme.colors;
  // The interface style (Kraken / JetBrains) is saved on the daemon with the tabs; null until chosen.
  const [style, setStyle] = useState<UiStyle | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);

  // A newer GitHistory release: show how to update (the plugin cannot update itself). Dismissed per version.
  const updateCall = useRpc(updateRpc);
  const upd = useQuery({ queryKey: ["githistory", "update"], queryFn: () => updateCall({}), staleTime: 60 * 60_000, refetchInterval: 6 * 60 * 60_000, retry: false });
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Restore the tabs saved on the daemon; with none saved, open the first Git workspace (or the picker).
  const tabsCall = useRpc(tabsRpc);
  const saved = useQuery({ queryKey: ["githistory", "tabs"], queryFn: () => tabsCall({ action: "get" }), staleTime: Infinity });
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !saved.isFetched || !workspaces.data) return;
    seeded.current = true;
    const restored = (saved.data?.tabs ?? []).map((tab) => ({ ...tab, key: keyOf(tab.ref) }));
    if (restored.length) {
      setTabs(restored);
      setActive(restored.some((tab) => tab.key === saved.data?.active) ? saved.data!.active : restored[0].key);
      return;
    }
    const first = workspaces.data.entries[0];
    if (first) open({ ref: { kind: "workspace", id: first.id }, title: first.projectName });
    else setPicking(true);
  }, [saved.isFetched, saved.data, workspaces.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (styleReady || !saved.isFetched) return;
    setStyle(saved.data?.style ?? null);
    setStyleReady(true);
  }, [saved.isFetched, saved.data, styleReady]);
  // Every change is written back once things settle. WHY styleReady: until the saved style has been read,
  // `style` is null and writing would erase the choice.
  useEffect(() => {
    if (!seeded.current || !styleReady) return;
    const timer = setTimeout(
      () => void tabsCall({ action: "set", state: { tabs: tabs.map(({ ref, title }) => ({ ref, title })), active, ...(style ? { style } : {}) } }).catch(() => {}),
      300,
    );
    return () => clearTimeout(timer);
  }, [tabs, active, style, styleReady, tabsCall]);

  // A workspace archived in Paseo leaves its tab; folder tabs stay.
  useEffect(() => {
    if (!workspaces.data) return;
    const known = new Set(workspaces.data.entries.map((w) => `ws:${w.id}`));
    setTabs((ts) => ts.filter((tab) => tab.ref.kind !== "workspace" || known.has(tab.key)));
  }, [workspaces.data]);
  useEffect(() => {
    if (active && !tabs.some((tab) => tab.key === active)) setActive(tabs[0]?.key ?? null);
  }, [tabs, active]);

  function open(p: PickedProject) {
    const key = keyOf(p.ref);
    setTabs((ts) => (ts.some((x) => x.key === key) ? ts : [...ts, { ...p, key }]));
    setActive(key);
    setPicking(false);
  }
  const close = (key: string) => {
    const i = tabs.findIndex((x) => x.key === key);
    const rest = tabs.filter((x) => x.key !== key);
    setTabs(rest);
    if (active === key) setActive(rest[Math.min(i, rest.length - 1)]?.key ?? null);
  };
  const closePicker = useCallback(() => setPicking(false), []);
  const openKeys = useMemo(() => new Set(tabs.map((x) => x.key)), [tabs]);
  const current = tabs.find((x) => x.key === active);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface1 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          {tabs.map((tab) => {
            const on = tab.key === active;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActive(tab.key)}
                accessibilityRole="tab"
                style={(st) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 14,
                  paddingVertical: layout.compact ? 10 : 8,
                  backgroundColor: on ? c.surface0 : hovered(st) ? c.surface2 : "transparent",
                  borderBottomWidth: 2,
                  borderBottomColor: on ? c.accent : "transparent",
                })}
              >
                <Icon name={tab.ref.kind === "workspace" ? "GitBranch" : "Folder"} size={13} color={on ? c.foreground : c.foregroundMuted} />
                <Text style={{ color: on ? c.foreground : c.foregroundMuted, fontSize: 13, fontWeight: on ? "600" : "400", maxWidth: 220 }} numberOfLines={1}>
                  {tab.title}
                </Text>
                <Pressable onPress={() => close(tab.key)} hitSlop={8} accessibilityLabel={`Close ${tab.title}`}>
                  <Icon name="X" size={12} color={c.foregroundMuted} />
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          onPress={() => setStyleOpen(true)}
          accessibilityLabel="Interface style: GitKraken or JetBrains"
          style={(st) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginHorizontal: 6,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: hovered(st) ? c.surface2 : "transparent",
          })}
        >
          <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>Style</Text>
          <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }}>{style === "jetbrains" ? "JetBrains" : "GitKraken"}</Text>
          <Icon name="ChevronDown" size={12} color={c.foregroundMuted} />
        </Pressable>
        <Pressable onPress={() => setPicking((p) => !p)} style={(st) => ({ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: hovered(st) ? c.surface2 : "transparent" })} accessibilityLabel="Open a project">
          <Icon name="Plus" size={18} color={c.foreground} />
        </Pressable>
      </View>
      {upd.data?.latest && dismissed !== upd.data.latest && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.surface2, borderBottomWidth: 1, borderBottomColor: c.border }}>
          <Icon name="RefreshCw" size={14} color={c.accent} />
          <Text style={{ color: c.foreground, fontSize: 12, flex: 1 }} selectable>
            {`GitHistory ${upd.data.latest} is available (you have ${upd.data.current}). On the Paseo daemon's machine run: ${upd.data.command}`}
          </Text>
          <Pressable onPress={() => setDismissed(upd.data!.latest)} hitSlop={8} accessibilityLabel="Dismiss update notice">
            <Icon name="X" size={12} color={c.foregroundMuted} />
          </Pressable>
        </View>
      )}
      {picking && <ProjectPicker theme={theme} hostLabel={host.label} openKeys={openKeys} onPick={open} onClose={closePicker} />}
      {current ? (
        <RepoTab key={current.key} repoRef={current.ref} title={current.title} theme={theme} compact={layout.compact} style={style ?? "kraken"} />
      ) : (
        !picking && <Text style={{ color: c.foregroundMuted, padding: 24, textAlign: "center" }}>Press ＋ to open a project.</Text>
      )}
      {styleReady && (style == null || styleOpen) && (
        <StylePicker
          t={tokens(theme, style ?? "kraken")}
          current={style}
          onPick={(picked) => {
            setStyle(picked);
            setStyleOpen(false);
          }}
          // The first choice cannot be dismissed: there is no style to fall back to yet.
          onClose={style == null ? undefined : () => setStyleOpen(false)}
        />
      )}
    </View>
  );
}
