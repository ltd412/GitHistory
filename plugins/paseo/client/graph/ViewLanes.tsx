// The lanes of one graph row drawn with plain Views, for Paseo versions whose icons cannot be inline SVG
// (0.12). Geometry comes from core/graph-draw.ts createRowShapesCache — the desktop's own edge paths,
// flattened into straight strokes — so it matches the SVG rendering up to curve smoothness.
import { memo } from "react";
import { Text, View } from "react-native";
import type { NodeShape, Segment } from "../../shared/core/graph-draw";
import type { JbNodeShape, JbSegment } from "../../shared/core/jb-graph";

function Stroke({ s }: { s: Segment }) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  // Overlap neighbouring chords by a hair so curves have no gaps between them.
  const len = Math.hypot(dx, dy) + (dx && dy ? 0.6 : 0);
  return (
    <View
      style={{
        position: "absolute",
        left: (s.x1 + s.x2) / 2 - len / 2,
        top: (s.y1 + s.y2) / 2 - s.width / 2,
        width: len,
        borderRadius: s.width / 2,
        ...(s.dashed ? { height: 0, borderTopWidth: s.width, borderStyle: "dashed" as const, borderColor: s.color } : { height: s.width, backgroundColor: s.color }),
        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
}

function Node({ n, bg, dim }: { n: NodeShape; bg: string; dim: boolean }) {
  const box = { position: "absolute" as const, left: n.x - n.r, top: n.y - n.r, width: n.r * 2, height: n.r * 2, opacity: dim ? 0.35 : 1 };
  if (n.kind === "wip") return <View style={[box, { borderRadius: n.r, borderWidth: 2, borderStyle: "dashed", borderColor: n.color, backgroundColor: bg }]} />;
  if (n.kind === "stash") return <View style={[box, { borderRadius: 3, borderWidth: 2, borderStyle: "dashed", borderColor: n.color, backgroundColor: bg }]} />;
  if (n.kind === "merge" || n.kind === "dot") return <View style={[box, { borderRadius: n.r, backgroundColor: n.color, borderWidth: 1, borderColor: bg }]} />;
  return (
    <View style={[box, { borderRadius: n.r, backgroundColor: n.color, alignItems: "center", justifyContent: "center" }]}>
      <View style={{ width: n.r * 2 - 4, height: n.r * 2 - 4, borderRadius: n.r - 2, backgroundColor: n.fill, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontSize: 8, fontWeight: "700" }}>{n.initials}</Text>
      </View>
    </View>
  );
}

export const ViewLanes = memo(function ViewLanes({ shapes, width, height, bg, dim }: { shapes: { segments: Segment[]; node: NodeShape }; width: number; height: number; bg: string; dim?: boolean }) {
  return (
    <View style={{ width, height }} pointerEvents="none">
      {shapes.segments.map((s, k) => (
        <Stroke key={k} s={s} />
      ))}
      <Node n={shapes.node} bg={bg} dim={!!dim} />
    </View>
  );
});

/** The JetBrains-style row's lanes with plain Views (Paseo 0.12): thin strokes and a dot or ringed node. */
export const ViewJbLanes = memo(function ViewJbLanes({ shapes, width, bg }: { shapes: { segments: JbSegment[]; node: JbNodeShape }; width: number; bg: string }) {
  const n = shapes.node;
  return (
    <View style={{ width, height: 26 }} pointerEvents="none">
      {shapes.segments.map((s, k) => (
        <Stroke key={k} s={s as Segment} />
      ))}
      <View
        style={{
          position: "absolute",
          left: n.x - n.r,
          top: n.y - n.r,
          width: n.r * 2,
          height: n.r * 2,
          borderRadius: n.r,
          backgroundColor: n.ring || n.dashed ? bg : n.color,
          borderWidth: n.ring ? 1.5 : n.dashed ? 1.4 : 0,
          borderStyle: n.dashed ? "dashed" : "solid",
          borderColor: n.color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {n.ring && <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: n.color }} />}
      </View>
    </View>
  );
});
