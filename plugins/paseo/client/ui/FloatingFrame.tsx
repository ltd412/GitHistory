// A movable, resizable window for big views (diff, merge tool, blame…). On web — Paseo's desktop and
// browser clients — it is `position: fixed`, so it floats over the whole app, Paseo's own sidebar
// included; on phones it fills the Git screen. Drag the title bar to move, any edge or corner to
// resize, double-click the title bar to maximise, Esc to close. Size and place are kept for the session.
import { Icon } from "./sdk";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { Tokens } from "../theme";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface WebMouse {
  clientX: number;
  clientY: number;
  button: number;
  key?: string;
  preventDefault(): void;
  stopPropagation(): void;
}
interface WebNode {
  addEventListener(type: string, h: (e: WebMouse) => void): void;
  removeEventListener(type: string, h: (e: WebMouse) => void): void;
  ownerDocument: WebNode & { defaultView: { innerWidth: number; innerHeight: number } | null };
}

const MIN_W = 420;
const MIN_H = 260;
const MARGIN = 24;
/** Kept across openings in this session, like a desktop window. */
let lastRect: Rect | null = null;
let lastMax = false;

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

const WEB = Platform.OS === "web";
const fixed = WEB ? ({ position: "fixed" } as object) : { position: "absolute" as const };

function viewport(node: WebNode | null) {
  const v = node?.ownerDocument.defaultView;
  return { w: v?.innerWidth ?? 1200, h: v?.innerHeight ?? 800 };
}

export function FloatingFrame({ t, title, onClose, children }: { t: Tokens; title: ReactNode; onClose: () => void; children: ReactNode }) {
  const root = useRef<View>(null);
  const [vp, setVp] = useState({ w: 1200, h: 800 });
  const [max, setMax] = useState(lastMax);
  const [rect, setRect] = useState<Rect | null>(lastRect);
  const close = useRef(onClose);
  close.current = onClose;

  // First open: almost the whole window.
  useEffect(() => {
    const v = viewport(root.current as unknown as WebNode | null);
    setVp(v);
    setRect((r) => r ?? { x: MARGIN, y: MARGIN, w: v.w - MARGIN * 2, h: v.h - MARGIN * 2 });
  }, []);
  useEffect(() => {
    if (rect) lastRect = rect;
    lastMax = max;
  }, [rect, max]);

  // Web: move/resize with the mouse (the responder system does not deliver mouse drags reliably), Esc closes.
  const drag = useRef<{ edge: Edge; x0: number; y0: number; r0: Rect } | null>(null);
  useEffect(() => {
    if (!WEB) return;
    const node = root.current as unknown as WebNode | null;
    if (!node?.addEventListener) return;
    const doc = node.ownerDocument;
    const onMove = (e: WebMouse) => {
      const d = drag.current;
      if (!d) return;
      e.preventDefault();
      const v = viewport(node);
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      let { x, y, w, h } = d.r0;
      if (d.edge === "move") {
        x = Math.max(-w + 120, Math.min(v.w - 120, x + dx));
        y = Math.max(0, Math.min(v.h - 40, y + dy));
      } else {
        if (d.edge.includes("e")) w = Math.max(MIN_W, Math.min(v.w - x, w + dx));
        if (d.edge.includes("s")) h = Math.max(MIN_H, Math.min(v.h - y, h + dy));
        if (d.edge.includes("w")) {
          const nw = Math.max(MIN_W, w - dx);
          x = Math.max(0, x + (w - nw));
          w = nw;
        }
        if (d.edge.includes("n")) {
          const nh = Math.max(MIN_H, h - dy);
          y = Math.max(0, y + (h - nh));
          h = nh;
        }
      }
      setRect({ x, y, w, h });
    };
    const onUp = () => (drag.current = null);
    const onKey = (e: WebMouse) => e.key === "Escape" && close.current();
    const onResize = () => setVp(viewport(node));
    doc.addEventListener("mousemove", onMove);
    doc.addEventListener("mouseup", onUp);
    doc.addEventListener("keydown", onKey);
    (doc.defaultView as unknown as WebNode | null)?.addEventListener("resize", onResize);
    return () => {
      (doc.defaultView as unknown as WebNode | null)?.removeEventListener("resize", onResize);
      doc.removeEventListener("mousemove", onMove);
      doc.removeEventListener("mouseup", onUp);
      doc.removeEventListener("keydown", onKey);
    };
  }, []);

  const start = (edge: Edge) =>
    WEB && !max
      ? ({
          onMouseDown: (e: WebMouse) => {
            if (e.button !== 0 || !rect) return;
            e.preventDefault();
            drag.current = { edge, x0: e.clientX, y0: e.clientY, r0: rect };
          },
        } as object)
      : {};

  const r = max || !rect || !WEB ? { x: 0, y: 0, w: vp.w, h: vp.h } : rect;
  const frameStyle = WEB
    ? { left: r.x, top: r.y, width: r.w, height: r.h }
    : { left: 0, top: 0, right: 0, bottom: 0 };
  const grip = 6;
  const handle = (edge: Exclude<Edge, "move">, style: object, cursor: string) => (
    <View key={edge} {...start(edge)} style={[{ position: "absolute", zIndex: 3 }, style, { cursor } as object]} />
  );

  return (
    <View
      ref={root}
      style={[
        fixed,
        frameStyle,
        {
          zIndex: 1000,
          backgroundColor: t.bg,
          borderWidth: max || !WEB ? 0 : 1,
          borderColor: t.border,
          borderRadius: max || !WEB ? 0 : 10,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.35,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 10 },
          elevation: 24,
        },
      ]}
    >
      <View
        {...start("move")}
        {...(WEB ? ({ onDoubleClick: () => setMax((m) => !m) } as object) : {})}
        style={[
          { flexDirection: "row", alignItems: "center", gap: 10, height: 34, paddingHorizontal: 12, backgroundColor: t.panel2, borderBottomWidth: 1, borderBottomColor: t.border },
          { cursor: max ? "default" : "move", userSelect: "none" } as object,
        ]}
      >
        <Text style={{ color: t.text, fontSize: 12, fontWeight: "600", flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
        {WEB && (
          <Pressable onPress={() => setMax((m) => !m)} hitSlop={6} accessibilityLabel={max ? "Restore window size" : "Maximise"}>
            <Icon name={max ? "Minimize2" : "Maximize2"} size={14} color={t.dim} />
          </Pressable>
        )}
        <Pressable onPress={onClose} hitSlop={6} accessibilityLabel="Close">
          <Icon name="X" size={16} color={t.dim} />
        </Pressable>
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
      {WEB && !max && [
        handle("n", { top: 0, left: grip, right: grip, height: grip }, "ns-resize"),
        handle("s", { bottom: 0, left: grip, right: grip, height: grip }, "ns-resize"),
        handle("w", { left: 0, top: grip, bottom: grip, width: grip }, "ew-resize"),
        handle("e", { right: 0, top: grip, bottom: grip, width: grip }, "ew-resize"),
        handle("nw", { left: 0, top: 0, width: grip * 2, height: grip * 2 }, "nwse-resize"),
        handle("ne", { right: 0, top: 0, width: grip * 2, height: grip * 2 }, "nesw-resize"),
        handle("sw", { left: 0, bottom: 0, width: grip * 2, height: grip * 2 }, "nesw-resize"),
        handle("se", { right: 0, bottom: 0, width: grip * 2, height: grip * 2 }, "nwse-resize"),
      ]}
    </View>
  );
}
