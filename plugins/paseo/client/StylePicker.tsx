// First-use chooser (and "Interface style…" later): Kraken graph or JetBrains-style Git log. Shown over the
// Git screen; the choice is saved on the daemon with the tabs (see GitScreen).
import { Pressable, Text, View } from "react-native";
import type { UiStyle } from "../shared/core/types";
import type { Tokens } from "./theme";

const KRAKEN_ROWS = [
  { c: "#4a9db3", w: 0.62 },
  { c: "#8d56ab", w: 0.5 },
  { c: "#d4875f", w: 0.7 },
  { c: "#86b862", w: 0.44 },
  { c: "#c0587f", w: 0.58 },
];

function KrakenPreview() {
  return (
    <View style={{ height: 96, borderRadius: 4, overflow: "hidden", backgroundColor: "#1b1d23" }}>
      <View style={{ height: 10, backgroundColor: "#15171c" }} />
      {KRAKEN_ROWS.map((r, i) => (
        <View key={i} style={{ height: 17, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 6, backgroundColor: `${r.c}22` }}>
          <View style={{ width: 34, height: 8, borderRadius: 4, backgroundColor: r.c, opacity: 0.85 }} />
          <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: r.c }} />
          <View style={{ width: `${r.w * 55}%`, height: 5, borderRadius: 3, backgroundColor: "#c5c9d1", opacity: 0.6 }} />
        </View>
      ))}
    </View>
  );
}

function JetBrainsPreview() {
  return (
    <View style={{ height: 96, borderRadius: 4, overflow: "hidden", backgroundColor: "#191a1c", flexDirection: "row" }}>
      <View style={{ width: 38, backgroundColor: "#212326", gap: 6, padding: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ height: 4, width: 18 + ((i * 7) % 12), borderRadius: 2, backgroundColor: "#999ca3", opacity: 0.6 }} />
        ))}
      </View>
      <View style={{ flex: 1 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={{ height: 19, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, backgroundColor: i === 1 ? "#2b3c5e" : "transparent" }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#4d7bd4" }} />
            <View style={{ width: `${40 + ((i * 13) % 30)}%`, height: 5, borderRadius: 3, backgroundColor: "#c3c6cc", opacity: 0.65 }} />
            <View style={{ width: 18, height: 5, borderRadius: 3, backgroundColor: "#80838a", opacity: 0.6, marginLeft: "auto" }} />
          </View>
        ))}
      </View>
    </View>
  );
}

const CHOICES: { id: UiStyle; name: string; blurb: string }[] = [
  { id: "kraken", name: "GitKraken", blurb: "Colourful lanes and row bands, avatars on the graph, branch labels in their own column." },
  { id: "jetbrains", name: "JetBrains", blurb: "The Git log of PyCharm / IntelliJ: filters, a branches tree, a table with graph, author and date." },
];

export function StylePicker({ t, current, onPick, onClose }: { t: Tokens; current: UiStyle | null; onPick: (s: UiStyle) => void; onClose?: () => void }) {
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <View style={{ width: "100%", maxWidth: 640, borderRadius: 10, backgroundColor: t.panel, borderWidth: 1, borderColor: t.border, padding: 18, gap: 12 }}>
        <Text style={{ color: t.strong, fontSize: 18, fontWeight: "700" }}>{current ? "Interface style" : "Choose your interface"}</Text>
        <Text style={{ color: t.dim, fontSize: 13 }}>Same features either way — only the look of the history changes. You can switch at any time from the tab bar.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {CHOICES.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => onPick(c.id)}
              accessibilityRole="button"
              style={{ flexGrow: 1, flexBasis: 240, gap: 8, padding: 10, borderRadius: 8, borderWidth: 2, borderColor: current === c.id ? t.accent : t.border, backgroundColor: t.bg }}
            >
              {c.id === "kraken" ? <KrakenPreview /> : <JetBrainsPreview />}
              <Text style={{ color: t.strong, fontSize: 14, fontWeight: "700" }}>
                {c.name}
                {current === c.id ? "  · current" : ""}
              </Text>
              <Text style={{ color: t.dim, fontSize: 12, lineHeight: 17 }}>{c.blurb}</Text>
            </Pressable>
          ))}
        </View>
        {onClose && (
          <Pressable onPress={onClose} style={{ alignSelf: "flex-end", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6, borderWidth: 1, borderColor: t.border }}>
            <Text style={{ color: t.text, fontSize: 13 }}>Cancel</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
