import { useEffect } from "react";
import { accentCssVariables, type ExtensionSettings } from "@channelpilot/shared";

export function useInterfacePreferences(settings: ExtensionSettings): void {
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolvedTheme =
        settings.theme === "auto" ? (media.matches ? "light" : "dark") : settings.theme;
      root.dataset.theme = resolvedTheme;
      root.dataset.themeChoice = settings.theme;
      root.dataset.accent = settings.accentColor;
      root.dataset.density = settings.density;
      root.dataset.motion =
        settings.animationMode === "system" ? "system" : settings.animationMode;
      // Accents live in @channelpilot/shared so the cabinet, the popup and the
      // on-page panel cannot drift apart again.
      for (const [name, value] of Object.entries(
        accentCssVariables(settings.accentColor, resolvedTheme),
      )) {
        root.style.setProperty(name, value);
      }
      root.style.setProperty("--glass-alpha", String(settings.panelTransparency / 100));
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [
    settings.accentColor,
    settings.animationMode,
    settings.density,
    settings.panelTransparency,
    settings.theme,
  ]);
}
