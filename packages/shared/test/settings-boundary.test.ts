import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXTENSION_SETTINGS,
  isExtensionRequest,
  panelLayoutEquals,
  resolvePanelLayout,
  sanitizeContentSettingsPatch,
  toMediaAnalysisSettings,
  toPublicSettings,
} from "../src/index.js";

const SECRET_SETTINGS = {
  ...DEFAULT_EXTENSION_SETTINGS,
  googleClientId: "1234.apps.googleusercontent.com",
  youtubeApiKey: "AIzaSyYOUTUBEKEY",
  geminiApiKey: "AIzaSyTESTKEY",
  groqApiKey: "gsk_testkey",
  twelveLabsApiKey: "tlk_testkey",
};

describe("toPublicSettings", () => {
  it("removes every provider secret and the OAuth client id", () => {
    const publicSettings = toPublicSettings(SECRET_SETTINGS);
    const serialized = JSON.stringify(publicSettings);
    expect(serialized).not.toContain("AIzaSyTESTKEY");
    expect(serialized).not.toContain("AIzaSyYOUTUBEKEY");
    expect(serialized).not.toContain("gsk_testkey");
    expect(serialized).not.toContain("tlk_testkey");
    expect(serialized).not.toContain("apps.googleusercontent.com");
    expect(publicSettings).not.toHaveProperty("youtubeApiKey");
    expect(publicSettings).not.toHaveProperty("geminiApiKey");
    expect(publicSettings).not.toHaveProperty("groqApiKey");
    expect(publicSettings).not.toHaveProperty("twelveLabsApiKey");
    expect(publicSettings).not.toHaveProperty("googleClientId");
  });

  it("never lets a content script write the YouTube key", () => {
    expect(sanitizeContentSettingsPatch({ youtubeApiKey: "AIzaStolen" })).toEqual({});
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS_PATCH",
        payload: { youtubeApiKey: "AIzaStolen" },
      }),
    ).toBe(false);
  });

  it("reports readiness instead of the key itself", () => {
    expect(toPublicSettings(SECRET_SETTINGS)).toMatchObject({
      geminiReady: true,
      groqReady: true,
      twelveLabsReady: true,
      googleClientIdReady: true,
    });
    expect(toPublicSettings(DEFAULT_EXTENSION_SETTINGS)).toMatchObject({
      geminiReady: false,
      groqReady: false,
      twelveLabsReady: false,
      googleClientIdReady: false,
    });
  });

  it("keeps the fields the panel actually renders", () => {
    const publicSettings = toPublicSettings(SECRET_SETTINGS);
    expect(publicSettings.accentColor).toBe(SECRET_SETTINGS.accentColor);
    expect(publicSettings.density).toBe(SECRET_SETTINGS.density);
    expect(publicSettings.panelLayout).toEqual(SECRET_SETTINGS.panelLayout);
  });

  it("uses an explicit allowlist so future private fields cannot leak", () => {
    expect(Object.keys(toPublicSettings(SECRET_SETTINGS)).sort()).toEqual(
      [
        "preferredProvider",
        "interfaceLanguage",
        "generationLanguage",
        "showHeaderWidget",
        "showLauncher",
        "theme",
        "accentColor",
        "panelTransparency",
        "density",
        "animationMode",
        "panelLayout",
        "widgetSections",
        "widgetDockMetrics",
        "analyticsRefreshSeconds",
        "allowAiMediaUploads",
        "geminiReady",
        "groqReady",
        "twelveLabsReady",
        "googleClientIdReady",
      ].sort(),
    );
  });
});

describe("toMediaAnalysisSettings", () => {
  it("never includes the OAuth client ID or unrelated preferences", () => {
    const projection = toMediaAnalysisSettings({
      ...SECRET_SETTINGS,
      preferredProvider: "auto",
    });
    expect(Object.keys(projection).sort()).toEqual(
      [
        "geminiApiKey",
        "groqApiKey",
        "twelveLabsApiKey",
        "geminiModel",
        "groqModel",
        "twelveLabsModel",
        "preferredProvider",
        "interfaceLanguage",
      ].sort(),
    );
    expect(JSON.stringify(projection)).not.toContain("apps.googleusercontent.com");
    expect(projection).toMatchObject({
      geminiApiKey: "AIzaSyTESTKEY",
      groqApiKey: "gsk_testkey",
      twelveLabsApiKey: "tlk_testkey",
    });
  });

  it("omits provider keys outside the selected mode", () => {
    expect(
      toMediaAnalysisSettings({ ...SECRET_SETTINGS, preferredProvider: "gemini" }),
    ).toMatchObject({
      geminiApiKey: "AIzaSyTESTKEY",
      groqApiKey: "",
      twelveLabsApiKey: "",
    });
    expect(
      toMediaAnalysisSettings({ ...SECRET_SETTINGS, preferredProvider: "both" }),
    ).toMatchObject({
      geminiApiKey: "AIzaSyTESTKEY",
      groqApiKey: "gsk_testkey",
      twelveLabsApiKey: "",
    });
  });
});

describe("sanitizeContentSettingsPatch", () => {
  it("drops fields a content script may not write", () => {
    const patch = sanitizeContentSettingsPatch({
      generationLanguage: "en",
      googleClientId: "attacker.apps.googleusercontent.com",
      geminiApiKey: "AIzaStolen",
      debugLogging: true,
    });
    expect(patch).toEqual({ generationLanguage: "en" });
  });

  it("normalizes values that pass the whitelist", () => {
    const patch = sanitizeContentSettingsPatch({
      panelLayout: { width: 99_999, height: -5, x: 10, y: 20 },
      preferredProvider: "not-a-provider",
    });
    // Clamped to the documented bounds rather than trusted as sent.
    expect(patch.panelLayout?.width).toBeLessThanOrEqual(760);
    expect(patch.panelLayout?.height).toBeGreaterThanOrEqual(420);
    expect(patch.preferredProvider).toBe(DEFAULT_EXTENSION_SETTINGS.preferredProvider);
  });

  it("returns an empty patch for a payload with nothing writable", () => {
    expect(sanitizeContentSettingsPatch({ geminiApiKey: "x" })).toEqual({});
    expect(sanitizeContentSettingsPatch(null)).toEqual({});
    expect(sanitizeContentSettingsPatch("nope")).toEqual({});
  });
});

describe("isExtensionRequest", () => {
  it("accepts a well-formed settings payload", () => {
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS",
        payload: DEFAULT_EXTENSION_SETTINGS,
      }),
    ).toBe(true);
  });

  it("rejects unknown fields and wrong field types", () => {
    expect(
      isExtensionRequest({ type: "SAVE_SETTINGS", payload: { smuggled: 1 } }),
    ).toBe(false);
    expect(
      isExtensionRequest({ type: "SAVE_SETTINGS", payload: { debugLogging: "yes" } }),
    ).toBe(false);
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS",
        payload: { panelTransparency: NaN },
      }),
    ).toBe(false);
  });

  it("rejects a patch that reaches outside the content-script whitelist", () => {
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS_PATCH",
        payload: { generationLanguage: "en" },
      }),
    ).toBe(true);
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS_PATCH",
        payload: { geminiApiKey: "AIzaStolen" },
      }),
    ).toBe(false);
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS_PATCH",
        payload: { googleClientId: "attacker.apps.googleusercontent.com" },
      }),
    ).toBe(false);
  });

  it("accepts the dashboard-open request a content script has to delegate", () => {
    // `chrome.runtime.openOptionsPage` is not part of the content-script API
    // surface, so the widget asks the service worker to do it.
    expect(isExtensionRequest({ type: "OPEN_OPTIONS_PAGE" })).toBe(true);
    expect(isExtensionRequest({ type: "OPEN_OPTIONS_PAGE_PLEASE" })).toBe(false);
  });
});

describe("resolvePanelLayout identity", () => {
  const viewport = { width: 1_440, height: 900 };

  it("returns the previous object when nothing changed", () => {
    const first = resolvePanelLayout(
      { width: 440, height: 700, x: 100, y: 80 },
      viewport,
    );
    const second = resolvePanelLayout(
      { width: 440, height: 700, x: 100, y: 80 },
      viewport,
      first,
    );
    // Identity, not just equality: this is what lets setState bail out.
    expect(second).toBe(first);
  });

  it("returns a new object once the rectangle actually moves", () => {
    const first = resolvePanelLayout(
      { width: 440, height: 700, x: 100, y: 80 },
      viewport,
    );
    const second = resolvePanelLayout(
      { width: 440, height: 700, x: 160, y: 80 },
      viewport,
      first,
    );
    expect(second).not.toBe(first);
    expect(second.x).toBe(160);
  });

  it("still clamps to the viewport when a previous rectangle is supplied", () => {
    const first = resolvePanelLayout(
      { width: 440, height: 700, x: 100, y: 80 },
      viewport,
    );
    const narrow = resolvePanelLayout(
      { width: 440, height: 700, x: 100, y: 80 },
      { width: 600, height: 500 },
      first,
    );
    expect(narrow).not.toBe(first);
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(600);
    expect(narrow.y + narrow.height).toBeLessThanOrEqual(500);
  });

  it("panelLayoutEquals handles null and undefined", () => {
    expect(panelLayoutEquals(null, null)).toBe(true);
    expect(panelLayoutEquals(null, undefined)).toBe(false);
    expect(panelLayoutEquals({ width: 1, height: 2, x: 3, y: 4 }, null)).toBe(false);
  });
});

describe("privacy defaults", () => {
  it("keeps media uploads opt-in", () => {
    // README, USER_FLOWS and the audit notes all state this is off by default.
    expect(DEFAULT_EXTENSION_SETTINGS.allowAiMediaUploads).toBe(false);
  });
});
