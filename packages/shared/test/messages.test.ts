import { describe, expect, it } from "vitest";
import { isExtensionRequest } from "../src/index.js";

describe("runtime message validation", () => {
  it("accepts known bounded requests", () => {
    expect(isExtensionRequest({ type: "AUTH_STATUS" })).toBe(true);
    expect(
      isExtensionRequest({
        type: "GET_COMPETITOR",
        query: "@channel",
        force: true,
      }),
    ).toBe(true);
    expect(
      isExtensionRequest({
        type: "ANALYZE_TEXT",
        payload: {
          provider: "auto",
          context: {
            title: "A real title",
            description: "",
            tags: [],
            language: "en",
          },
        },
      }),
    ).toBe(true);
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS_TRUSTED_PATCH",
        payload: { geminiApiKey: "local-key" },
      }),
    ).toBe(true);
  });

  it("rejects unknown and oversized requests", () => {
    expect(isExtensionRequest({ type: "DELETE_EVERYTHING" })).toBe(false);
    expect(
      isExtensionRequest({
        type: "GET_COMPETITOR",
        query: "x".repeat(301),
      }),
    ).toBe(false);
    expect(
      isExtensionRequest({
        type: "ANALYZE_TEXT",
        payload: {
          provider: "auto",
          context: {
            title: "x",
            description: "x".repeat(20_001),
            tags: [],
            language: "en",
          },
        },
      }),
    ).toBe(false);
    expect(
      isExtensionRequest({
        type: "SAVE_SETTINGS_TRUSTED_PATCH",
        payload: { geminiApiKey: ["invalid"] },
      }),
    ).toBe(false);
  });
});
