// Desktop colour tokens (src/styles.css) resolved for Paseo's current theme. Paseo gives surfaces and
// text; the git-specific accents (green/red/orange, selection, lane palette) follow the desktop app.
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { setLanePalette } from "../shared/core/format";
import type { UiStyle } from "../shared/core/types";

export interface Tokens {
  light: boolean;
  bg: string;
  panel: string;
  panel2: string;
  hover: string;
  select: string;
  input: string;
  border: string;
  borderSoft: string;
  text: string;
  dim: string;
  faint: string;
  strong: string;
  accent: string;
  accentText: string;
  green: string;
  red: string;
  orange: string;
  mono: string;
  warnBg: string;
  warnText: string;
  warnStrong: string;
  /** How much of the lane colour a non-checked-out ref pill keeps (desktop --pill-mix). */
  pillMix: number;
  /** Interface style these tokens belong to. */
  style: UiStyle;
  /** Extra colours of the JetBrains style (src/jb.css), present in both styles so components can read them. */
  jb: JbTokens;
}

/** JetBrains "Islands" colours, softened (src/jb.css): no pure black or white, lower contrast. */
export interface JbTokens {
  frame: string;
  island: string;
  elev: string;
  border: string;
  borderStrong: string;
  field: string;
  fg: string;
  fgStrong: string;
  fgSecondary: string;
  fgSubtle: string;
  fgFaint: string;
  accent: string;
  link: string;
  treeSelected: string;
  treeSelectedInactive: string;
  treeHover: string;
  added: string;
  modified: string;
  annotation: string;
  danger: string;
  warning: string;
  /** Tint of commits reachable from HEAD (View Options › Highlight › Current Branch). */
  currentBranch: string;
}

const JB_DARK: JbTokens = {
  frame: "#26282c",
  island: "#191a1c",
  elev: "#212326",
  border: "#26282c",
  borderStrong: "#40434a",
  field: "#191a1c",
  fg: "#c3c6cc",
  fgStrong: "#ced0d5",
  fgSecondary: "#999ca3",
  fgSubtle: "#80838a",
  fgFaint: "#62656b",
  accent: "#4d7bd4",
  link: "#6f9be8",
  treeSelected: "#2b3c5e",
  treeSelectedInactive: "#33353b",
  treeHover: "#252628",
  added: "#6fae76",
  modified: "#7ba6e0",
  annotation: "#aaa564",
  danger: "#dc7d83",
  warning: "#cb9b50",
  currentBranch: "#1d2026",
};
const JB_LIGHT: JbTokens = {
  frame: "#eceef1",
  island: "#fbfbfc",
  elev: "#f3f4f6",
  border: "#e6e8ec",
  borderStrong: "#d6d9df",
  field: "#fbfbfc",
  fg: "#3a3d43",
  fgStrong: "#2b2d32",
  fgSecondary: "#686c75",
  fgSubtle: "#80848c",
  fgFaint: "#a3a7af",
  accent: "#4a7ce0",
  link: "#3f6bc6",
  treeSelected: "#dde6fa",
  treeSelectedInactive: "#eceef2",
  treeHover: "#f1f2f4",
  added: "#3f8a4e",
  modified: "#3f6fc4",
  annotation: "#8a7f2a",
  danger: "#c9525c",
  warning: "#a86f12",
  currentBranch: "#f3f6fd",
};

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function tokens(theme: PluginScreenProps["theme"], style: UiStyle = "kraken"): Tokens {
  const c = theme.colors;
  const light = luminance(c.surface0) > 0.5;
  setLanePalette(light ? "light" : "dark");
  const jb = light ? JB_LIGHT : JB_DARK;
  const base = {
    light,
    mono: "Menlo",
    warnBg: light ? "#fff6e5" : "#3b2b1a",
    warnText: light ? "#6b4400" : "#ffd8a8",
    warnStrong: light ? "#4a2f00" : "#ffe3bf",
    pillMix: light ? 1 : 0.55,
    style,
    jb,
  };
  if (style === "jetbrains") {
    // The Git window's own palette (the desktop's JetBrains style also ignores the host's surfaces).
    return {
      ...base,
      bg: jb.island,
      panel: jb.island,
      panel2: jb.elev,
      hover: jb.treeHover,
      select: jb.treeSelected,
      input: jb.field,
      border: jb.border,
      borderSoft: jb.border,
      text: jb.fg,
      dim: jb.fgSecondary,
      faint: jb.fgSubtle,
      strong: jb.fgStrong,
      accent: jb.accent,
      accentText: "#f2f4f8",
      green: jb.added,
      red: jb.danger,
      orange: jb.warning,
    };
  }
  // Kraken: Paseo's surfaces, with the git accents and text eased (as in src/styles.css): no pure black or
  // white text, softer green / red / orange.
  return {
    ...base,
    bg: c.surface0,
    panel: c.surface1,
    panel2: c.surface2,
    hover: light ? "#eceef2" : "#2f3440",
    select: light ? "#e0e8f5" : "#313b4e",
    input: light ? "#fbfbfc" : "#15171c",
    border: c.border,
    borderSoft: c.border,
    text: mix(c.foreground, c.surface0, light ? 0.88 : 0.9),
    dim: c.foregroundMuted,
    faint: light ? "#8c939e" : "#5f6675",
    strong: light ? "#25282d" : "#d5d8de",
    accent: c.accent,
    accentText: c.accentForeground,
    green: light ? "#3d8750" : "#4fa676",
    red: light ? "#c05059" : "#cf6770",
    orange: light ? "#a8702a" : "#d4a05c",
  };
}

/** `p` of colour `a` over `b` (CSS color-mix in srgb), as #rrggbb. */
export function mix(a: string, b: string, p: number): string {
  const rgb = (h: string) => {
    const n = parseInt(h.replace("#", "").slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v * p + y[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
}

/**
 * Whether a Pressable is under the pointer or pressed. react-native-web reports `hovered` in the style
 * callback (not in its types); on touch devices it is simply absent.
 */
export const active = (s: { pressed: boolean }) => s.pressed || !!(s as { hovered?: boolean }).hovered;
