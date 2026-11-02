// A bottom sheet for the phone layout, drawn inside the Git screen's own tree.
// WHY not Paseo's Modal: it renders outside this tree and stays on screen when the plugin screen unmounts while
// it is open, so the sheet reappeared over Paseo's Settings after leaving the Git screen.
import { Icon } from "./sdk";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Tokens } from "../theme";

export function Sheet({ t, title, open, onClose, children }: { t: Tokens; title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 50, justifyContent: "flex-end" }}>
      <Pressable onPress={onClose} accessibilityLabel="Close" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" }} />
      <View style={{ flex: 1, marginTop: 24, backgroundColor: t.panel, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderWidth: 1, borderColor: t.border, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text style={{ flex: 1, color: t.text, fontSize: 14, fontWeight: "600" }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={`Close ${title}`}>
            <Icon name="X" size={16} color={t.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </View>
  );
}
