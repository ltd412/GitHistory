// Desktop colour tokens (src/styles.css) resolved for Paseo's current theme. Paseo gives surfaces and
// text; the git-specific accents (green/red/orange, selection, lane palette) follow the desktop app.
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { setLanePalette } from "../shared/core/format";

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
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

export function tokens(theme: PluginScreenProps["theme"]): Tokens {
  const c = theme.colors;
  const light = luminance(c.surface0) > 0.5;
  setLanePalette(light ? "light" : "dark");
  return {
    light,
    bg: c.surface0,
    panel: c.surface1,
    panel2: c.surface2,
    hover: light ? "#eceef2" : "#2f3440",
    select: light ? "#dde8f7" : "#354055",
    input: light ? "#ffffff" : "#15171c",
    border: c.border,
    borderSoft: c.border,
    text: c.foreground,
    dim: c.foregroundMuted,
    faint: light ? "#8c939e" : "#5f6675",
    strong: light ? "#0d1117" : "#ffffff",
    accent: c.accent,
    accentText: c.accentForeground,
    green: light ? "#1f883d" : "#3fbb6f",
    red: light ? "#cf222e" : "#e05561",
    orange: light ? "#b35900" : "#e8a243",
    mono: "Menlo",
    warnBg: light ? "#fff6e5" : "#3b2b1a",
    warnText: light ? "#6b4400" : "#ffd8a8",
    warnStrong: light ? "#4a2f00" : "#ffe3bf",
    pillMix: light ? 1 : 0.55,
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
