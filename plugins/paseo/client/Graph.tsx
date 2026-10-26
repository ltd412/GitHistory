// The commit graph, laid out like the desktop GraphView: Branch/Tag · Graph · Commit message · Author ·
// Date · SHA, rows banded in their lane colour. Each row's lanes are one inline SVG built by the same
// drawing code as the desktop (core/graph-draw.ts), so curves and nodes are identical.
import { FlatList, Icon, svgIcons } from "./ui/sdk";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Platform, Pressable, Text, View, type FlatList as NativeFlatList, type LayoutChangeEvent } from "react-native";
import { bandAlpha, formatTime, laneColor } from "../shared/core/format";
import { buildNodes, firstParentChain, layoutGraph, WIP_HASH, type GraphNode, type GraphRow } from "../shared/core/graph";
import { AUTHOR_W, COMPACT, DATE_W, NORMAL, SHA_W, createRowShapesCache, createRowSvgCache, fitColumns, type Columns, type Metrics } from "../shared/core/graph-draw";
import { refDisplayName, rowMenu, stashMenu, type RefLabel } from "../shared/core/menus";
import { active, mix, type Tokens } from "./theme";
import { useRepo } from "./RepoContext";
import { useUi } from "./ui/Dialogs";
import { ViewLanes } from "./graph/ViewLanes";

/** The bits of the DOM the web wheel handler touches (react-native-web renders a View as an element). */
interface WebWheel {
  clientX: number;
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
  preventDefault(): void;
}
interface WebMouse {
  clientX: number;
  clientY: number;
  button: number;
  preventDefault(): void;
}
interface WebElement {
  addEventListener(type: string, h: (e: never) => void, o?: { passive: boolean }): void;
  removeEventListener(type: string, h: (e: never) => void): void;
  getBoundingClientRect(): { left: number; top: number };
  ownerDocument: WebElement;
}

/** react-native-web style: dragging across rows must pan the lanes, not select their text. */
const NO_SELECT = { userSelect: "none" } as object;

/** On a phone the message column may shrink further than on desktop before lanes are cut. */
const MIN_MSG_NARROW = 120;

export function Graph() {
  const ctx = useRepo();
  const { data, selection, select, labels, actions: a, t, compact, narrow } = ctx;
  const ui = useUi();
  const m: Metrics = compact ? COMPACT : NORMAL;
  const [viewW, setViewW] = useState(800);
  /** Settled lane offset (header arrows, thumb width); the live offset during a gesture is `pos`. */
  const [scrollX, setScrollXState] = useState(0);
  const st = data.status;
  const wipCount = st.staged.length + st.unstaged.length + st.conflicted.length;

  const nodes = useMemo(
    () =>
      buildNodes(data.commits, {
        headSha: data.refs.headSha,
        mergeHead: data.state.mergeHead,
        wip: wipCount > 0 || data.state.state !== "clean",
        stashes: data.stashes,
      }),
    [data.commits, data.refs.headSha, data.state.mergeHead, wipCount, data.state.state, data.stashes],
  );
  // The checked-out branch keeps lane 0 (from the WIP node, or HEAD when the tree is clean).
  const layout = useMemo(() => {
    const start = nodes[0]?.kind === "wip" ? WIP_HASH : data.refs.headSha;
    return layoutGraph(nodes, { mainChain: firstParentChain(nodes, start) });
  }, [nodes, data.refs.headSha]);

  const contentW = layout.maxWidth * m.lane + m.pad * 2;
  const autoGraphW = Math.min(Math.max(contentW, 60), Math.max(narrow ? 110 : 240, viewW * 0.35));
  // Widths the user dragged on the header (desktop: refW / graphW); null = automatic.
  const [refW, setRefW] = useState<number | null>(null);
  const [graphW, setGraphW] = useState<number | null>(null);
  const refsW0 = refW ?? (narrow ? 104 : viewW < 900 ? 150 : 190);
  const minMsg = narrow || viewW < 900 ? MIN_MSG_NARROW + 40 : undefined;
  // Memoised by value so rows (memo) keep the same props object while nothing changed.
  const wantGraphW = graphW ?? autoGraphW;
  // A width the user dragged on the Graph column is honoured before the Branch/Tag column's: that one gives
  // way first (down to 90 px), then fitColumns trims as usual so the message keeps its minimum.
  const refsFit = graphW == null || refW != null ? refsW0 : Math.max(90, Math.min(refsW0, viewW - (minMsg ?? 220) - wantGraphW));
  const cols = useMemo(() => fitColumns(viewW, refsFit, wantGraphW, minMsg), [viewW, refsFit, wantGraphW, minMsg]);
  const gW = cols.graph;
  const maxScrollX = Math.max(0, contentW - gW);
  // Whole lanes at rest, like the desktop: a lane is either fully visible or hidden.
  const maxSnap = Math.ceil(maxScrollX / m.lane) * m.lane;
  const sx = Math.min(scrollX, maxSnap);

  // WHY Animated: during a drag only this value changes. Rows translate their (cached, full-width) lane
  // image by it on the UI side; no React render and no SVG rebuild per pointer move — that was the lag.
  const pos = useRef(new Animated.Value(0)).current;
  const negPos = useMemo(() => Animated.multiply(pos, -1), [pos]);
  const live = useRef({ x: 0, maxSnap, contentW, gW, refsW: cols.refs, lane: m.lane });
  live.current = { ...live.current, maxSnap, contentW, gW, refsW: cols.refs, lane: m.lane };
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveTo = useCallback(
    (v: number, settle: boolean) => {
      const w = live.current;
      const x = Math.max(0, Math.min(w.maxSnap, v));
      w.x = x;
      pos.setValue(x);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (settle) {
        // At rest the offset snaps to a whole lane.
        const snapped = Math.min(w.maxSnap, Math.round(x / w.lane) * w.lane);
        w.x = snapped;
        Animated.timing(pos, { toValue: snapped, duration: 90, useNativeDriver: false }).start();
        setScrollXState(snapped);
      }
    },
    [pos],
  );
  const settleSoon = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => moveTo(live.current.x, true), 140);
  }, [moveTo]);
  // Layout changes (narrower column, fewer lanes) clamp the offset.
  useEffect(() => {
    if (live.current.x > maxSnap) moveTo(maxSnap, true);
  }, [maxSnap, moveTo]);

  // Like the desktop, lanes wider than the column scroll sideways: drag/swipe across the graph column,
  // drag the scrollbar thumb, or (web) trackpad swipe / Shift+wheel over the column.
  // Captured on the graph's frame, not the row: a row is a Pressable that already owns the touch, and a
  // child can never take it over — only an ancestor can, in the capture phase.
  const frameX = useRef(0);
  const frameY = useRef(0);
  /** Header + scrollbar: column resizers live there, lane dragging starts below it. */
  const HEADER_H = 34;
  const lanePan = useMemo(() => {
    let start = 0;
    const inColumn = (pageX: number, pageY: number) => {
      const x = pageX - frameX.current;
      return pageY - frameY.current > HEADER_H && x >= live.current.refsW && x <= live.current.refsW + live.current.gW;
    };
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        live.current.maxSnap > 0 && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5 && inColumn(g.x0, g.y0),
      onPanResponderGrant: () => (start = live.current.x),
      onPanResponderMove: (_, g) => moveTo(start - g.dx, false),
      onPanResponderRelease: () => moveTo(live.current.x, true),
      onPanResponderTerminate: () => moveTo(live.current.x, true),
      onPanResponderTerminationRequest: () => false,
    });
  }, [moveTo]);
  const thumbPan = useMemo(() => {
    let start = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => (start = live.current.x),
      onPanResponderMove: (_, g) => moveTo(start + (g.dx * live.current.contentW) / Math.max(1, live.current.gW), false),
      onPanResponderRelease: () => moveTo(live.current.x, true),
      onPanResponderTerminate: () => moveTo(live.current.x, true),
      onPanResponderTerminationRequest: () => false,
    });
  }, [moveTo]);
  const root = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = root.current as unknown as WebElement | null;
    if (!el?.addEventListener) return;
    const onWheel = (e: WebWheel) => {
      const w = live.current;
      if (!w.maxSnap) return;
      const x = e.clientX - el.getBoundingClientRect().left;
      if (x < w.refsW || x > w.refsW + w.gW) return;
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      e.preventDefault();
      moveTo(w.x + dx, false);
      settleSoon();
    };
    // Mouse drag across the graph column, like the desktop's lane drag (the responder system does not
    // reliably hand a mouse drag to an ancestor of a Pressable on web).
    const doc = el.ownerDocument;
    let drag: { x0: number; start: number; moved: boolean } | null = null;
    const onDown = (e: WebMouse) => {
      const w = live.current;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (e.button !== 0 || !w.maxSnap || e.clientY - r.top <= HEADER_H || x < w.refsW || x > w.refsW + w.gW) return;
      drag = { x0: e.clientX, start: w.x, moved: false };
    };
    const onMove = (e: WebMouse) => {
      if (!drag) return;
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < 6) return;
      drag.moved = true;
      e.preventDefault();
      moveTo(drag.start - dx, false);
    };
    // A drag must not end as a click that selects the row under the pointer.
    const onClick = (e: WebMouse & { stopPropagation(): void }) => {
      if (drag?.moved) (e.stopPropagation(), e.preventDefault());
      drag = null;
    };
    const onUp = () => {
      if (drag?.moved) moveTo(live.current.x, true);
      setTimeout(() => (drag = null), 0);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", onDown);
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
    el.addEventListener("click", onClick, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", onDown);
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
      el.removeEventListener("click", onClick);
    };
  }, [moveTo, settleSoon]);

  const labelled = useCallback((h: string) => !!labels.get(h)?.some((l) => l.current), [labels]);
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
  const onRowPress = useCallback((n: GraphNode) => handlers.current.selectNode(n), []);
  const onRowMenu = useCallback((n: GraphNode) => handlers.current.openMenu(n), []);
  // Inline SVG where the Paseo version draws it (0.13+), plain Views otherwise (ui/sdk.tsx).
  const svgFor = useMemo(() => (svgIcons ? createRowSvgCache(layout, nodes, { m, contentW, bg: t.bg, labelled }) : null), [layout, nodes, m, contentW, t.bg, labelled]);
  const shapesFor = useMemo(() => (svgIcons ? null : createRowShapesCache(layout, nodes, { m, contentW, bg: t.bg, labelled })), [layout, nodes, m, contentW, t.bg, labelled]);
  const wipCounts = useMemo(() => ({ staged: st.staged.length, unstaged: st.unstaged.length, conflicted: st.conflicted.length }), [st]);

  // Sidebar clicks: bring the commit into view (a third from the top, like the desktop).
  const list = useRef<NativeFlatList<GraphNode>>(null);
  useEffect(() => {
    if (!ctx.jump) return;
    const i = nodes.findIndex((n) => n.hash === ctx.jump!.hash);
    if (i !== -1) list.current?.scrollToIndex({ index: i, viewPosition: 0.33, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.jump]);

  const onLayout = (e: LayoutChangeEvent) => {
    setViewW(Math.round(e.nativeEvent.layout.width));
    root.current?.measureInWindow((x, y) => ((frameX.current = x), (frameY.current = y)));
  };
  const head = { color: t.faint, fontSize: 10, fontWeight: "700" as const, letterSpacing: 0.4, paddingHorizontal: 8 };

  return (
    <View ref={root} {...lanePan.panHandlers} style={{ flex: 1, backgroundColor: t.bg }} onLayout={onLayout}>
      <View style={{ flexDirection: "row", height: 26, alignItems: "center", borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: t.panel }}>
        <View style={{ width: cols.refs, height: 26, justifyContent: "center" }}>
          <Text style={head} numberOfLines={1}>
            BRANCH / TAG
          </Text>
          <Resizer t={t} width={cols.refs} onResize={setRefW} />
        </View>
        <View style={{ width: gW, height: 26, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
          {maxScrollX > 0 && (
            <Pressable onPress={() => moveTo(sx - m.lane, true)} disabled={sx === 0} hitSlop={6} accessibilityLabel="Scroll lanes left">
              <Icon name="ChevronLeft" size={12} color={sx === 0 ? t.border : t.dim} />
            </Pressable>
          )}
          <Text style={head}>GRAPH</Text>
          {maxScrollX > 0 && (
            <Pressable onPress={() => moveTo(sx + m.lane, true)} disabled={sx >= maxSnap} hitSlop={6} accessibilityLabel="Scroll lanes right">
              <Icon name="ChevronRight" size={12} color={sx >= maxSnap ? t.border : t.dim} />
            </Pressable>
          )}
          <Resizer t={t} width={gW} onResize={setGraphW} />
        </View>
        <Text style={[head, { flex: 1 }]} numberOfLines={1}>
          COMMIT MESSAGE
        </Text>
        {cols.author && <Text style={[head, { width: AUTHOR_W }]}>AUTHOR</Text>}
        {cols.date && <Text style={[head, { width: DATE_W }]}>DATE / TIME</Text>}
        {cols.sha && <Text style={[head, { width: SHA_W }]}>SHA</Text>}
      </View>
      {maxScrollX > 0 && (
        <View style={{ height: 6, backgroundColor: t.panel }}>
          <Animated.View
            {...thumbPan.panHandlers}
            style={{
              position: "absolute",
              top: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor: t.faint,
              left: cols.refs,
              width: Math.max(24, (gW / contentW) * gW),
              transform: [{ translateX: Animated.multiply(pos, gW / contentW) }],
            }}
          />
        </View>
      )}
      <FlatList
        ref={list}
        data={nodes}
        keyExtractor={(n) => n.hash}
        getItemLayout={(_, i) => ({ length: m.row, offset: m.row * i, index: i })}
        initialNumToRender={40}
        windowSize={11}
        onEndReachedThreshold={2}
        onEndReached={() => data.hasMore && a.loadMore()}
        extraData={[selectedHash, cols, t, compared, svgFor, shapesFor, labels]}
        renderItem={({ item: n, index: i }) => (
          <Row
            t={t}
            m={m}
            node={n}
            row={layout.rows[i]}
            svg={svgFor?.(i)}
            shapes={shapesFor?.(i)}
            contentW={contentW}
            shift={negPos}
            cols={cols}
            labels={labels.get(n.hash) ?? []}
            remoteCount={data.remotes.length}
            selected={selectedHash === n.hash || !!compared?.has(n.hash)}
            wip={n.kind === "wip" ? wipCounts : null}
            onPress={onRowPress}
            onMenu={onRowMenu}
          />
        )}
        ListFooterComponent={data.hasMore ? <Text style={{ color: t.dim, textAlign: "center", padding: 8 }}>Loading more commits…</Text> : null}
        ListEmptyComponent={<Text style={{ color: t.dim, padding: 24 }}>This repository has no commits yet.</Text>}
      />
    </View>
  );
}

interface RowProps {
  t: Tokens;
  m: Metrics;
  node: GraphNode;
  row: GraphRow;
  /** The row's lanes from the per-layout caches: SVG markup (0.13+) or plain shapes (0.12). */
  svg?: string;
  shapes?: ReturnType<ReturnType<typeof createRowShapesCache>>;
  contentW: number;
  shift: Animated.AnimatedInterpolation<number> | Animated.Value | Animated.AnimatedMultiplication<number>;
  cols: Columns;
  labels: RefLabel[];
  remoteCount: number;
  selected: boolean;
  wip: { staged: number; unstaged: number; conflicted: number } | null;
  onPress: (n: GraphNode) => void;
  onMenu: (n: GraphNode) => void;
}

const Row = memo(function Row({ t, m, node, row, svg, shapes, contentW, shift, cols, labels, remoteCount, selected, wip, onPress: press, onMenu: menu }: RowProps) {
  const onPress = () => press(node);
  const onMenu = () => menu(node);
  const color = laneColor(row.color);
  // GitKraken-style band in the lane colour across the ref and graph columns; rows with refs are stronger.
  const band = `${color}${bandAlpha(labels.length > 0)}`;
  const cell = { height: m.row, justifyContent: "center" as const, paddingHorizontal: 8 };
  const dim = { color: t.dim, fontSize: 12 };
  // Right-click on web opens the same menu as a long press.
  const webContext = { onContextMenu: (e: { preventDefault?: () => void }) => (e.preventDefault?.(), onMenu()) } as object;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMenu}
      delayLongPress={350}
      {...webContext}
      style={(st) => ({ ...NO_SELECT, flexDirection: "row", height: m.row, alignItems: "center", backgroundColor: selected ? t.select : active(st) ? t.hover : "transparent" })}
    >
      <View style={[cell, { width: cols.refs, backgroundColor: band, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }]}>
        <RefPills t={t} labels={labels} color={color} remoteCount={remoteCount} compact={m.compact} />
        {labels.some((l) => l.current) && <View style={{ position: "absolute", right: 0, top: m.row / 2 - 1, height: 2, width: 8, backgroundColor: color }} />}
      </View>
      <View style={{ width: cols.graph, height: m.row, overflow: "hidden", backgroundColor: band }}>
        <Animated.View style={{ width: contentW, height: m.row, transform: [{ translateX: shift }] }}>
          {svg != null ? <Icon icon={{ svg }} size={contentW} /> : shapes ? <ViewLanes shapes={shapes} width={contentW} height={m.row} bg={t.bg} /> : null}
        </Animated.View>
      </View>
      <View style={[cell, { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 8, minWidth: 0 }]}>
        {wip ? (
          <>
            <Text style={{ color: t.dim, fontStyle: "italic", fontSize: 13 }}>// WIP</Text>
            {wip.conflicted > 0 && <Text style={{ color: t.red, fontSize: 11 }}>⚠ {wip.conflicted}</Text>}
            {wip.unstaged > 0 && <Text style={{ color: t.orange, fontSize: 11 }}>✎ {wip.unstaged}</Text>}
            {wip.staged > 0 && <Text style={{ color: t.green, fontSize: 11 }}>✓ {wip.staged}</Text>}
          </>
        ) : node.kind === "stash" ? (
          <>
            <Icon name="Archive" size={12} color={t.dim} />
            <Text style={{ color: t.dim, fontSize: 13, flex: 1 }} numberOfLines={1}>
              {node.subject}
            </Text>
          </>
        ) : (
          <Text style={{ color: t.text, fontSize: m.compact ? 12 : 13, flex: 1 }} numberOfLines={1}>
            {node.subject}
          </Text>
        )}
      </View>
      {cols.author && (
        <Text style={[dim, { width: AUTHOR_W, paddingHorizontal: 8 }]} numberOfLines={1}>
          {node.author}
        </Text>
      )}
      {cols.date && (
        <Text style={[dim, { width: DATE_W, paddingHorizontal: 8 }]} numberOfLines={1}>
          {node.kind === "wip" ? "" : formatTime(node.time, "relative")}
        </Text>
      )}
      {cols.sha && (
        <Text style={[dim, { width: SHA_W, paddingHorizontal: 8, fontFamily: t.mono, fontSize: 11 }]} numberOfLines={1}>
          {node.kind ? "" : node.hash.slice(0, 7)}
        </Text>
      )}
    </Pressable>
  );
});

function RefPills({ t, labels, color, remoteCount, compact }: { t: Tokens; labels: RefLabel[]; color: string; remoteCount: number; compact: boolean }) {
  if (!labels.length) return null;
  const [first, ...rest] = labels;
  const bg = first.kind === "tag" ? "#6b7385" : first.current ? color : mix(color, t.bg, t.pillMix);
  const ic = 11;
  return (
    <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: compact ? 17 : 20,
          paddingHorizontal: 6,
          borderRadius: 3,
          backgroundColor: bg,
          flexShrink: 1,
          minWidth: 0,
          borderWidth: first.current ? 1 : 0,
          borderColor: t.light ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.75)",
        }}
      >
        {first.current && <Icon name="Check" size={ic} color="#fff" />}
        {first.kind === "tag" && <Icon name="Tag" size={ic} color="#fff" />}
        <Text style={{ color: "#fff", fontSize: 11, fontWeight: first.current ? "700" : "400", flexShrink: 1 }} numberOfLines={1}>
          {refDisplayName(first, remoteCount)}
        </Text>
        {first.local && <Icon name="Laptop" size={ic} color="#fff" />}
        {first.remotes.length > 0 && <Icon name="Cloud" size={ic} color="#fff" />}
      </View>
      {rest.length > 0 && (
        <Text style={{ fontSize: 10, color: t.dim, paddingHorizontal: 4, borderRadius: 3, backgroundColor: t.panel2 }}>+{rest.length}</Text>
      )}
    </>
  );
}

/**
 * Drag handle on a header column's right edge (desktop `Resizer`): drag to set the width, 40–2000 px like
 * the desktop; double-click / double-tap returns the column to its automatic width.
 */
function Resizer({ t, width, onResize }: { t: Tokens; width: number; onResize: (w: number | null) => void }) {
  const start = useRef(width);
  start.current = width;
  const resize = useRef(onResize);
  resize.current = onResize;
  const lastTap = useRef(0);
  const pan = useMemo(() => {
    let w0 = 0;
    let frame: number | null = null;
    let pending = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        w0 = start.current;
        const now = Date.now();
        if (now - lastTap.current < 300) resize.current(null);
        lastTap.current = now;
      },
      onPanResponderMove: (_, g) => {
        // One layout per frame: every move re-lays out the visible rows.
        pending = Math.max(40, Math.min(2000, w0 + g.dx));
        if (frame == null)
          frame = requestAnimationFrame(() => {
            frame = null;
            resize.current(pending);
          });
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, []);
  // Web: the responder system does not deliver mouse drags here (same as the lane drag), so use DOM events.
  const el = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = el.current as unknown as WebElement | null;
    if (!node?.addEventListener) return;
    const doc = node.ownerDocument;
    let drag: { x0: number; w0: number } | null = null;
    let frame: number | null = null;
    let pending = 0;
    const onDown = (e: WebMouse) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag = { x0: e.clientX, w0: start.current };
    };
    const onMove = (e: WebMouse) => {
      if (!drag) return;
      e.preventDefault();
      pending = Math.max(40, Math.min(2000, drag.w0 + e.clientX - drag.x0));
      if (frame == null)
        frame = requestAnimationFrame(() => {
          frame = null;
          resize.current(pending);
        });
    };
    const onUp = () => (drag = null);
    const onDouble = () => resize.current(null);
    node.addEventListener("mousedown", onDown);
    node.addEventListener("dblclick", onDouble);
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
    return () => {
      node.removeEventListener("mousedown", onDown);
      node.removeEventListener("dblclick", onDouble);
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
    };
  }, []);
  return (
    <View
      ref={el}
      {...(Platform.OS === "web" ? {} : pan.panHandlers)}
      accessibilityLabel="Resize column"
      style={{ position: "absolute", right: -3, top: 4, bottom: 4, width: 7, zIndex: 2, ...({ cursor: "col-resize" } as object) }}
    >
      <View style={{ position: "absolute", right: 3, top: 0, bottom: 0, width: 1, backgroundColor: t.border }} />
    </View>
  );
}
