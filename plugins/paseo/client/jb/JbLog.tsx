// JetBrains-style Git log (PyCharm / IntelliJ look) for the plugin: a filter bar over a header-less table
// whose first column is the commit graph followed by the subject and the reference labels (right aligned),
// then Author and Date when there is room — a phone shows only the subject. Same data, selection and menus
// as the Kraken graph (Graph.tsx); only the presentation differs. Mirrors the desktop's jb/JbLog.tsx.
import { FlatList, Icon, TextInput, svgIcons } from "../ui/sdk";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type FlatList as NativeFlatList, type LayoutChangeEvent } from "react-native";
import { buildNodes, WIP_HASH, type GraphNode } from "../../shared/core/graph";
import {
  DATE_FILTERS,
  NO_FILTER,
  applyLogFilter,
  authorsOf,
  isFiltering,
  jbRefLabels,
  jbTime,
  type JbRefLabel,
} from "../../shared/core/jb";
import { JB_ROW, computeJbGraph, hideLongEdges, jbRowShapes, jbRowSvg, jbRowWidth, reachableIds, type JbGraphRow } from "../../shared/core/jb-graph";
import { rowMenu, stashMenu, labelMenu, type RefLabel } from "../../shared/core/menus";
import { ViewJbLanes } from "../graph/ViewLanes";
import { useRepo } from "../RepoContext";
import { active, mix, type Tokens } from "../theme";
import { useUi } from "../ui/Dialogs";
import { useJbFilter } from "./JbFilter";

const NO_SELECT = { userSelect: "none" } as object;
const contextMenu = (fn: () => void) => ({ onContextMenu: (e: { preventDefault?: () => void }) => (e.preventDefault?.(), fn()) }) as object;
const AUTHOR_W = 130;
const DATE_W = 120;

export function JbLog() {
  const ctx = useRepo();
  const { data, selection, select, labels, actions: a, t, narrow } = ctx;
  const ui = useUi();
  const { filter, setFilter } = useJbFilter();
  const [viewW, setViewW] = useState(800);
  const filtered = isFiltering(filter);

  const commits = useMemo(() => applyLogFilter(data.commits, filter, data.refs), [data.commits, filter, data.refs]);
  const st = data.status;
  const wipCount = st.staged.length + st.unstaged.length + st.conflicted.length;
  const nodes = useMemo(
    () =>
      buildNodes(commits, {
        headSha: data.refs.headSha,
        mergeHead: data.state.mergeHead,
        // Uncommitted changes and stashes belong to the whole repository, not to a filtered view of it.
        wip: !filtered && (wipCount > 0 || data.state.state !== "clean"),
        stashes: filtered ? [] : data.stashes,
      }),
    [commits, filtered, data.refs.headSha, data.state.mergeHead, wipCount, data.state.state, data.stashes],
  );
  const graphRows = useMemo(() => hideLongEdges(computeJbGraph(nodes.map((n) => ({ id: n.hash, parents: n.parents }))).rows), [nodes]);
  const onlyCurrent = filter.branch === "HEAD" || (!!filter.branch && filter.branch === data.refs.head);
  const onBranch = useMemo(
    () => (onlyCurrent ? null : reachableIds(nodes.map((n) => ({ id: n.hash, parents: n.parents })), data.refs.headSha)),
    [nodes, onlyCurrent, data.refs.headSha],
  );

  const selectedHash =
    selection?.kind === "wip" ? WIP_HASH : selection?.kind === "commit" ? selection.hash : selection?.kind === "stash" ? selection.stash.hash : null;
  const compared = selection?.kind === "compare" ? new Set([selection.from, selection.to]) : null;
  const selectNode = (n: GraphNode) => {
    if (n.kind === "wip") select({ kind: "wip" });
    else if (n.kind === "stash") {
      const s = data.stashes.find((x) => x.hash === n.hash);
      if (s) select({ kind: "stash", stash: s });
    } else select({ kind: "commit", hash: n.hash });
  };
  const openMenu = (n: GraphNode) => {
    selectNode(n);
    if (n.kind === "stash") {
      const s = data.stashes.find((x) => x.hash === n.hash);
      if (s) ui.menu(stashMenu(ctx, s), s.message);
    } else if (n.kind === "wip")
      ui.menu(
        [
          { label: "Stash all changes", onClick: a.stash },
          { label: "Create branch here", onClick: () => a.createBranch() },
        ],
        "Working tree",
      );
    else ui.menu(rowMenu(ctx, n, labels.get(n.hash) ?? []), n.subject);
  };
  // Stable callbacks for memoised rows; they call the latest handlers.
  const handlers = useRef({ selectNode, openMenu });
  handlers.current = { selectNode, openMenu };

  // Sidebar clicks: bring the commit into view.
  const list = useRef<NativeFlatList<GraphNode>>(null);
  useEffect(() => {
    if (!ctx.jump) return;
    const i = nodes.findIndex((n) => n.hash === ctx.jump!.hash);
    if (i !== -1) list.current?.scrollToIndex({ index: i, viewPosition: 0.33, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.jump]);

  // ------------------------------------------------------------ filter bar

  const authors = useMemo(() => authorsOf(data.commits), [data.commits]);
  const pickBranch = () =>
    ui.palette(
      [
        { label: "All branches", hint: "", run: () => setFilter({ ...filter, branch: null }) },
        { label: "HEAD (Current Branch)", hint: "", run: () => setFilter({ ...filter, branch: "HEAD" }) },
        ...data.refs.local.map((b) => ({ label: b.name, hint: b.current ? "current" : "local", run: () => setFilter({ ...filter, branch: b.name }) })),
        ...data.refs.remote.filter((r) => r.branch !== "HEAD").map((r) => ({ label: r.name, hint: "remote", run: () => setFilter({ ...filter, branch: r.name }) })),
        ...data.refs.tags.map((tg) => ({ label: tg.name, hint: "tag", run: () => setFilter({ ...filter, branch: tg.name }) })),
      ],
      "Filter by branch or tag — type to search",
    );
  const pickUser = () =>
    ui.palette(
      [
        { label: "Anyone", hint: "", run: () => setFilter({ ...filter, author: null }) },
        ...authors.map((u) => ({ label: u.name, hint: `${u.count}`, run: () => setFilter({ ...filter, author: u.email || u.name }) })),
      ],
      "Filter by author — type to search",
    );
  const pickDate = () =>
    ui.menu(
      DATE_FILTERS.map((d) => ({ label: `${filter.days === d.days ? "✓  " : "     "}${d.label}`, onClick: () => setFilter({ ...filter, days: d.days }) })),
      "Date",
    );
  const authorLabel = filter.author ? (authors.find((u) => (u.email || u.name) === filter.author)?.name ?? filter.author) : null;
  const dateLabel = filter.days == null ? null : (DATE_FILTERS.find((d) => d.days === filter.days)?.label ?? `${filter.days} days`);

  const showAuthor = !narrow && viewW >= 520;
  const showDate = !narrow && viewW >= 660;
  const theme = t.light ? "light" : "dark";
  const tint = mix(t.jb.accent, t.bg, 0.08);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} onLayout={(e: LayoutChangeEvent) => setViewW(Math.round(e.nativeEvent.layout.width))}>
      <View style={{ height: 34, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: t.border }}>
        <View style={{ flexShrink: 1, flexGrow: 0, width: narrow ? 110 : 220, height: 24, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 7, borderRadius: 4, borderWidth: 1, borderColor: t.jb.borderStrong, backgroundColor: t.input }}>
          <Icon name="Search" size={12} color={t.jb.fgSecondary} />
          <TextInput
            value={filter.text}
            onChangeText={(text: string) => setFilter({ ...filter, text })}
            placeholder="Text or hash"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ flex: 1, minWidth: 0, color: t.text, fontSize: 12, paddingVertical: 0 }}
          />
        </View>
        <FilterButton t={t} label="Branch" value={filter.branch} onOpen={pickBranch} onClear={() => setFilter({ ...filter, branch: null })} />
        {!narrow && <FilterButton t={t} label="User" value={authorLabel} onOpen={pickUser} onClear={() => setFilter({ ...filter, author: null })} />}
        {!narrow && <FilterButton t={t} label="Date" value={dateLabel} onOpen={pickDate} onClear={() => setFilter({ ...filter, days: null })} />}
        <View style={{ flex: 1 }} />
        {filtered && (
          <>
            {!narrow && (
              <Text style={{ color: t.faint, fontSize: 11 }}>
                {commits.length} of {data.commits.length}
              </Text>
            )}
            <Pressable onPress={() => setFilter(NO_FILTER)} hitSlop={6}>
              <Text style={{ color: t.jb.link, fontSize: 12, paddingHorizontal: 4 }}>Reset</Text>
            </Pressable>
          </>
        )}
      </View>
      <FlatList
        ref={list}
        data={nodes}
        keyExtractor={(n) => n.hash}
        getItemLayout={(_, i) => ({ length: JB_ROW, offset: JB_ROW * i, index: i })}
        initialNumToRender={40}
        windowSize={11}
        onEndReachedThreshold={2}
        onEndReached={() => data.hasMore && !filtered && a.loadMore()}
        extraData={[selectedHash, compared, t, labels, onBranch, showAuthor, showDate]}
        renderItem={({ item: n, index: i }) => (
          <JbRow
            t={t}
            theme={theme}
            tint={tint}
            node={n}
            row={graphRows[i]!}
            head={n.hash === data.refs.headSha && !n.kind}
            detached={data.refs.headDetached}
            labels={labels.get(n.hash) ?? []}
            selected={selectedHash === n.hash || !!compared?.has(n.hash)}
            onBranch={!!onBranch?.has(n.hash)}
            showAuthor={showAuthor}
            showDate={showDate}
            wip={n.kind === "wip" ? { staged: st.staged.length, unstaged: st.unstaged.length, conflicted: st.conflicted.length } : null}
            onPress={(x) => handlers.current.selectNode(x)}
            onMenu={(x) => handlers.current.openMenu(x)}
          />
        )}
        ListEmptyComponent={<Text style={{ color: t.faint, padding: 16, textAlign: "center" }}>{filtered ? "No commits match the filters" : "No commits yet"}</Text>}
        ListFooterComponent={data.hasMore && !filtered ? <Text style={{ color: t.dim, textAlign: "center", padding: 8 }}>Loading more commits…</Text> : null}
      />
    </View>
  );
}

function FilterButton({ t, label, value, onOpen, onClear }: { t: Tokens; label: string; value: string | null; onOpen: () => void; onClear: () => void }) {
  return (
    <View style={{ height: 24, flexDirection: "row", alignItems: "center", borderRadius: 4, backgroundColor: value ? t.jb.treeSelected : "transparent" }}>
      <Pressable onPress={onOpen} style={(st) => ({ height: 24, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, borderRadius: 4, backgroundColor: active(st) && !value ? t.hover : "transparent", maxWidth: 190 })}>
        <Text style={{ color: t.text, fontSize: 12 }} numberOfLines={1}>
          {label}
        </Text>
        {value && (
          <Text style={{ color: t.strong, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
            {value}
          </Text>
        )}
        <Icon name="ChevronDown" size={10} color={t.jb.fgSecondary} />
      </Pressable>
      {value && (
        <Pressable onPress={onClear} hitSlop={6} style={{ paddingRight: 6 }} accessibilityLabel={`Clear ${label.toLowerCase()} filter`}>
          <Icon name="X" size={10} color={t.jb.fgSecondary} />
        </Pressable>
      )}
    </View>
  );
}

interface RowProps {
  t: Tokens;
  theme: "dark" | "light";
  tint: string;
  node: GraphNode;
  row: JbGraphRow;
  head: boolean;
  detached: boolean;
  labels: RefLabel[];
  selected: boolean;
  onBranch: boolean;
  showAuthor: boolean;
  showDate: boolean;
  wip: { staged: number; unstaged: number; conflicted: number } | null;
  onPress: (n: GraphNode) => void;
  onMenu: (n: GraphNode) => void;
}

const JbRow = memo(function JbRow({ t, theme, tint, node, row, head, detached, labels, selected, onBranch, showAuthor, showDate, wip, onPress, onMenu }: RowProps) {
  const jb = t.jb;
  const bg = selected ? jb.treeSelected : onBranch ? tint : t.bg;
  const refs = node.kind ? [] : jbRefLabels(labels, { compact: true, tagNames: false }, head && detached);
  const merge = !node.kind && node.parents.length > 1;
  const o = { head, dashedNode: !!node.kind, theme, bg };
  const gw = jbRowWidth(row);
  // Inline SVG where the Paseo version draws it (0.13+), plain Views otherwise.
  const lanes = svgIcons ? <Icon icon={{ svg: jbRowSvg(row, o) }} size={gw} /> : <ViewJbLanes shapes={jbRowShapes(row, o)} width={gw} bg={bg} />;
  const webContext = contextMenu(() => onMenu(node));
  return (
    <Pressable
      onPress={() => onPress(node)}
      onLongPress={() => onMenu(node)}
      delayLongPress={350}
      {...webContext}
      style={(st) => ({ ...NO_SELECT, flexDirection: "row", height: JB_ROW, alignItems: "center", gap: 8, paddingHorizontal: 8, backgroundColor: selected ? jb.treeSelected : active(st) ? jb.treeHover : onBranch ? tint : "transparent" })}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: gw, height: JB_ROW, overflow: "visible" }} pointerEvents="none">
          {lanes}
        </View>
        {wip ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 }}>
            <Text style={{ color: t.dim, fontStyle: "italic", fontSize: 13 }} numberOfLines={1}>
              Uncommitted changes
            </Text>
            {wip.conflicted > 0 && <Text style={{ color: t.red, fontSize: 11 }}>⚠ {wip.conflicted}</Text>}
            {wip.unstaged > 0 && <Text style={{ color: t.orange, fontSize: 11 }}>✎ {wip.unstaged}</Text>}
            {wip.staged > 0 && <Text style={{ color: t.green, fontSize: 11 }}>✓ {wip.staged}</Text>}
          </View>
        ) : node.kind === "stash" ? (
          <Text style={{ color: t.faint, fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
            {node.subject}
          </Text>
        ) : (
          <Text style={{ color: merge ? jb.fgSubtle : t.text, fontWeight: head ? "600" : "400", fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
            {node.subject}
          </Text>
        )}
        {refs.length > 0 && <Refs t={t} refs={refs} />}
      </View>
      {showAuthor && (
        <Text style={{ width: AUTHOR_W, color: jb.fgSubtle, fontSize: 13 }} numberOfLines={1}>
          {node.kind ? "" : node.author}
        </Text>
      )}
      {showDate && (
        <Text style={{ width: DATE_W, color: jb.fgSubtle, fontSize: 13 }} numberOfLines={1}>
          {node.kind === "wip" ? "" : jbTime(node.time)}
        </Text>
      )}
    </Pressable>
  );
});

/** Reference labels: plain text with a coloured tag glyph, right aligned like the IDE (no filled chips). */
function Refs({ t, refs }: { t: Tokens; refs: JbRefLabel[] }) {
  const colorOf = (k: JbRefLabel["kind"]) => (k === "head" ? t.jb.warning : k === "local" ? t.jb.added : k === "remote" ? t.jb.annotation : t.jb.fgSubtle);
  return (
    <View style={{ flexShrink: 1, maxWidth: "50%", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginLeft: "auto", overflow: "hidden" }}>
      {refs.map((r, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1, minWidth: 11 }}>
          <Icon name="Tag" size={11} color={colorOf(r.kind)} />
          {r.text ? (
            <Text style={{ color: t.dim, fontSize: 13, flexShrink: 1 }} numberOfLines={1}>
              {r.text}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export { labelMenu };
