// "Open project" for the Git screen, laid out like Paseo's own Add project / Search for directory dialog:
// a floating search box over a dimmed app. Empty query lists Paseo's Git workspaces; typing searches
// folders on the daemon's machine (a name, or a path starting with / or ~). ↑↓ move, ↵ opens a
// repository (or steps into a plain folder), Tab completes, Esc closes (dinh-chinh-02).
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "./ui/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from "react-native";
import { searchDirsRpc, workspacesRpc, type RepoRef } from "../shared/rpc";
import { active } from "./theme";

export interface PickedProject {
  ref: RepoRef;
  title: string;
}

interface Row {
  key: string;
  icon: string;
  primary: string;
  secondary: string;
  open: boolean;
  repo: boolean;
  pick: () => void;
}

const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
const fixed = Platform.OS === "web" ? ({ position: "fixed" } as object) : { position: "absolute" as const };

export function ProjectPicker({
  theme,
  hostLabel,
  openKeys,
  onPick,
  onClose,
}: {
  theme: PluginScreenProps["theme"];
  hostLabel: string;
  openKeys: Set<string>;
  onPick: (p: PickedProject) => void;
  onClose: () => void;
}) {
  const c = theme.colors;
  const listWorkspaces = useRpc(workspacesRpc);
  const search = useRpc(searchDirsRpc);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sel, setSel] = useState(0);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 150);
    return () => clearTimeout(timer);
  }, [query]);
  const workspaces = useQuery({ queryKey: ["githistory", "workspaces"], queryFn: () => listWorkspaces({}) });
  const found = useQuery({
    queryKey: ["githistory", "searchDirs", debounced],
    queryFn: () => search({ query: debounced }),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
  });

  const rows: Row[] = useMemo(() => {
    if (!debounced)
      return (workspaces.data?.entries ?? []).map((w) => ({
        key: `ws:${w.id}`,
        icon: "GitBranch",
        primary: w.projectName,
        secondary: w.name !== w.projectName ? `Paseo workspace · ${w.name}` : "Paseo workspace",
        open: openKeys.has(`ws:${w.id}`),
        repo: true,
        pick: () => onPick({ ref: { kind: "workspace", id: w.id }, title: w.projectName }),
      }));
    return (found.data?.entries ?? []).map((e) => ({
      key: `dir:${e.path}`,
      icon: e.isRepo ? "GitBranch" : "Folder",
      primary: e.display,
      secondary: e.path,
      open: openKeys.has(`dir:${e.path}`),
      repo: e.isRepo,
      // A plain folder is not a repository: step into it, like completing the path.
      pick: () => (e.isRepo ? onPick({ ref: { kind: "path", path: e.path }, title: baseName(e.path) }) : setQuery(`${e.display}/`)),
    }));
  }, [debounced, workspaces.data, found.data, openKeys, onPick]);
  useEffect(() => setSel(0), [debounced]);

  // Esc closes even when focus is not in the input.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const doc = (globalThis as unknown as { document?: { addEventListener(t: string, h: (e: { key: string }) => void): void; removeEventListener(t: string, h: (e: { key: string }) => void): void } }).document;
    const onKey = (e: { key: string }) => e.key === "Escape" && onClose();
    doc?.addEventListener("keydown", onKey);
    return () => doc?.removeEventListener("keydown", onKey);
  }, [onClose]);

  const move = (d: number) =>
    setSel((s) => {
      const n = rows.length ? (s + d + rows.length) % rows.length : 0;
      scroll.current?.scrollTo({ y: Math.max(0, n * 56 - 120), animated: false });
      return n;
    });
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = e.nativeEvent.key;
    const prevent = () => (e as unknown as { preventDefault?: () => void }).preventDefault?.();
    if (key === "ArrowDown") (prevent(), move(1));
    else if (key === "ArrowUp") (prevent(), move(-1));
    else if (key === "Tab" && rows[sel] && debounced) (prevent(), setQuery(`${rows[sel].primary}/`));
    else if (key === "Escape") onClose();
  };

  const hint = (k: string, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ color: c.foreground, fontSize: 11, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: c.surface2 }}>{k}</Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );

  return (
    <View style={[fixed, { left: 0, top: 0, right: 0, bottom: 0, zIndex: 1100, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center" }]}>
      <Pressable onPress={onClose} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} accessibilityLabel="Close" />
      <View
        style={{
          marginTop: Platform.OS === "web" ? 48 : 12,
          width: "92%",
          maxWidth: 640,
          maxHeight: "86%",
          backgroundColor: c.surface0,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 20,
        }}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.border, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>Open project</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 13 }} numberOfLines={1}>
              {hostLabel}
            </Text>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onKeyPress={onKeyPress}
            onSubmitEditing={() => rows[sel]?.pick()}
            placeholder="Search directories or enter a path..."
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            blurOnSubmit={false}
            style={[{ color: c.foreground, fontSize: 15, paddingVertical: 4 }, { outlineStyle: "none" } as object]}
          />
        </View>
        <ScrollView ref={scroll} style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
          {!debounced && <Text style={{ color: c.foregroundMuted, fontSize: 11, fontWeight: "700", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>PASEO WORKSPACES</Text>}
          {rows.map((r, i) => (
            <Pressable
              key={r.key}
              onPress={r.pick}
              onHoverIn={() => setSel(i)}
              style={(st) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
                paddingHorizontal: 16,
                height: 56,
                backgroundColor: i === sel || active(st) ? c.surface2 : "transparent",
              })}
            >
              <Icon name={r.icon} size={18} color={r.repo ? c.accent : c.foregroundMuted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: c.foreground, fontSize: 14 }} numberOfLines={1}>
                  {r.primary}
                </Text>
                <Text style={{ color: c.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
                  {r.secondary}
                </Text>
              </View>
              {r.open ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>open</Text> : !r.repo ? <Icon name="ChevronRight" size={14} color={c.foregroundMuted} /> : null}
            </Pressable>
          ))}
          {debounced && found.isFetching && !rows.length && <Text style={{ color: c.foregroundMuted, padding: 16 }}>Searching…</Text>}
          {debounced && !found.isFetching && !rows.length && (
            <Text style={{ color: c.foregroundMuted, padding: 16 }}>{found.isError ? String(found.error) : "No matching folders."}</Text>
          )}
          {!debounced && !rows.length && (
            <Text style={{ color: c.foregroundMuted, paddingHorizontal: 16, paddingBottom: 14 }}>No Git workspaces in Paseo — type a folder name or a path (~/code/…).</Text>
          )}
          {found.data?.truncated && debounced ? <Text style={{ color: c.foregroundMuted, fontSize: 11, padding: 10, paddingHorizontal: 16 }}>Showing the best matches — type more to narrow.</Text> : null}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 18, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.border }}>
          {hint("↑↓", "Navigate")}
          {hint("↵", "Select")}
          {hint("Tab", "Complete")}
          {hint("Esc", "Close")}
        </View>
      </View>
    </View>
  );
}
