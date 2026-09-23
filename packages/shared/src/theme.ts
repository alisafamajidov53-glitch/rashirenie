import type { AccentColor } from "./types.js";

export interface AccentPalette {
  /** Fill colour for solid surfaces — dark enough for white text (>= 4.5:1). */
  readonly base: string;
  /** Lighter tone for text, icons and borders on a dark background. */
  readonly soft: string;
  /** Tone used for text/icons on a *light* background (>= 4.5:1 on #ffffff). */
  readonly onLight: string;
}

/**
 * The single definition of the four accents.
 *
 * Before this existed, `useInterfacePreferences` and the content script each
 * carried their own hard-coded table and all eight values had drifted apart,
 * so the cabinet and the on-page panel rendered different "brand" colours.
 *
 * `base` values are chosen so white text clears WCAG AA (4.5:1). The previous
 * values did not: cyan `#20b8df` with white text measured 2.34:1.
 */
export const ACCENT_PALETTES: Readonly<Record<AccentColor, AccentPalette>> = {
  violet: { base: "#5b43d6", soft: "#a994ff", onLight: "#4c34c4" },
  cyan: { base: "#0f6f8c", soft: "#7ae8ff", onLight: "#0b5a73" },
  emerald: { base: "#16785a", soft: "#79e8bd", onLight: "#10614a" },
  coral: { base: "#c62f47", soft: "#ff9b8d", onLight: "#ad2339" },
};

export function accentPalette(accent: AccentColor): AccentPalette {
  return ACCENT_PALETTES[accent] ?? ACCENT_PALETTES.violet;
}

/**
 * CSS custom properties every surface sets on its root.
 *
 * `--purple` / `--purple-soft` keep their historical names so the existing
 * stylesheets keep working; the focus ring is intentionally *not* derived from
 * the accent, because an accent-coloured ring dropped to 1.25:1 against the
 * light theme background and made keyboard navigation invisible.
 */
export function accentCssVariables(
  accent: AccentColor,
  theme: "light" | "dark",
): Record<string, string> {
  const palette = accentPalette(accent);
  return {
    "--purple": palette.base,
    "--purple-soft": palette.soft,
    "--accent": palette.base,
    "--accent-soft": palette.soft,
    "--accent-contrast": theme === "light" ? palette.onLight : palette.soft,
    "--focus-ring": theme === "light" ? "#1f2440" : "#ffffff",
    "--focus-halo":
      theme === "light" ? "rgba(31, 36, 64, 0.28)" : "rgba(255, 255, 255, 0.32)",
  };
}
