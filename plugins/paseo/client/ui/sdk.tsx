// The one place the client touches Paseo's UI kit, so the plugin runs on every daemon from 0.12 on.
// An installed plugin is bundled against the daemon's own @getpaseo/plugin, so what exists is decided
// at run time: 0.13 serves the kit from `client/ui` (and keeps `client/react-native` as a deprecated
// alias); 0.12 has it only in `client/react-native`, without Loading and without inline-SVG icons.
// Namespace imports never fail on a missing member — each name falls back explicitly below.
import * as sdk from "@getpaseo/plugin";
import * as rn from "@getpaseo/plugin/client/react-native";
import * as ui from "@getpaseo/plugin/client/ui";
import type { ComponentType } from "react";
import { ActivityIndicator, View } from "react-native";

type Kit = typeof ui;
const pick = <K extends keyof Kit>(name: K): Kit[K] => ((ui as Partial<Kit>)[name] ?? (rn as unknown as Partial<Kit>)[name]) as Kit[K];

export const Icon = pick("Icon");
export const Modal = pick("Modal");
export const TextInput = pick("TextInput");
export const FlatList = pick("FlatList");
export const ScrollView = pick("ScrollView");
export const useToast = pick("useToast");
export const SidebarRow = ui.SidebarRow;

/** 0.12 has no Loading component: a centred spinner instead. */
export const Loading: ComponentType =
  (ui as Partial<Kit>).Loading ??
  function Loading() {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <ActivityIndicator />
      </View>
    );
  };

/** Clipboard through Paseo when it offers it (0.13+); otherwise the browser clipboard on web. */
export const copyText: (text: string) => Promise<void> =
  pick("copyText") ??
  (async (text: string) => {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
    if (!nav?.clipboard) throw new Error("Copying is not available in this Paseo version");
    await nav.clipboard.writeText(text);
  });

/**
 * Whether `<Icon icon={{ svg }} />` renders inline SVG (0.13+). The graph draws each row as one SVG when
 * it can, and falls back to plain Views (graph/ViewLanes.tsx) when it cannot.
 */
export const svgIcons = typeof (sdk as { findSvgIconProblem?: unknown }).findSvgIconProblem === "function";
