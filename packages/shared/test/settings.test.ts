import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTENSION_SETTINGS,
  diffExtensionSettings,
  isGoogleClientId,
  normalizeExtensionSettings,
  normalizeGoogleClientId,
} from "../src/settings.js";

describe("extension settings", () => {
  it("sends only changed fields when saving from a stale window", () => {
    const baseline = normalizeExtensionSettings({
      ...DEFAULT_EXTENSION_SETTINGS,
      theme: "dark",
      geminiApiKey: "existing-key",
    });
    const draft = {
      ...baseline,
      theme: "light" as const,
      panelLayout: { ...baseline.panelLayout },
      widgetSections: [...baseline.widgetSections],
    };
    expect(diffExtensionSettings(draft, baseline)).toEqual({ theme: "light" });
  });
  it("normalizes untrusted stored values", () => {
    expect(
      normalizeExtensionSettings({
        googleClientId: "  client.apps.googleusercontent.com  ",
        geminiModel: "models/gemini-2.5-flash",
        groqModel: "",
        preferredProvider: "local-fallback",
        interfaceLanguage: "de",
        generationLanguage: "en",
      }),
    ).toEqual({
      ...DEFAULT_EXTENSION_SETTINGS,
      googleClientId: "client.apps.googleusercontent.com",
      generationLanguage: "en",
    });
  });

  it("preserves the supported dual-provider and language choices", () => {
    expect(
      normalizeExtensionSettings({
        preferredProvider: "both",
        interfaceLanguage: "en",
        generationLanguage: "ru",
        geminiModel: "gemini-3.6-flash",
        groqModel: "openai/gpt-oss-120b",
      }),
    ).toMatchObject({
      preferredProvider: "both",
      interfaceLanguage: "en",
      generationLanguage: "ru",
    });
  });

  it("keeps independent YouTube interface visibility preferences", () => {
    expect(
      normalizeExtensionSettings({
        showHeaderWidget: false,
        showLauncher: false,
      }),
    ).toMatchObject({
      showHeaderWidget: false,
      showLauncher: false,
    });
    expect(normalizeExtensionSettings({})).toMatchObject({
      showHeaderWidget: true,
      showLauncher: true,
    });
  });

  it("normalizes visual, polling, privacy and panel preferences", () => {
    expect(
      normalizeExtensionSettings({
        theme: "light",
        accentColor: "cyan",
        panelTransparency: 10,
        density: "compact",
        animationMode: "reduced",
        analyticsRefreshSeconds: 1,
        notificationsEnabled: false,
        allowAiMediaUploads: false,
        debugLogging: true,
        panelLayout: {
          width: 9_000,
          height: 100,
          x: 400,
          y: -50_000,
        },
      }),
    ).toMatchObject({
      theme: "light",
      accentColor: "cyan",
      panelTransparency: 68,
      density: "compact",
      animationMode: "reduced",
      analyticsRefreshSeconds: 30,
      notificationsEnabled: false,
      allowAiMediaUploads: false,
      debugLogging: true,
      panelLayout: {
        width: 760,
        height: 420,
        x: 400,
        y: -10_000,
      },
    });
  });

  it("preserves a TwelveLabs key, model and provider choice", () => {
    expect(
      normalizeExtensionSettings({
        twelveLabsApiKey: "  tlk_example  ",
        twelveLabsModel: "PEGASUS1.5",
        preferredProvider: "twelvelabs",
      }),
    ).toMatchObject({
      twelveLabsApiKey: "tlk_example",
      twelveLabsModel: "pegasus1.5",
      preferredProvider: "twelvelabs",
    });
  });

  it("extracts a Google OAuth Client ID from copied JSON or labelled text", () => {
    const clientId = "123456-example.apps.googleusercontent.com";
    expect(normalizeGoogleClientId(`{"web":{"client_id":"${clientId}"}}`)).toBe(
      clientId,
    );
    expect(normalizeGoogleClientId(`Client ID: ${clientId}`)).toBe(clientId);
    expect(isGoogleClientId(clientId)).toBe(true);
    expect(isGoogleClientId("AIza-not-an-oauth-client")).toBe(false);
  });
});
