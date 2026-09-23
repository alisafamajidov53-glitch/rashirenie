import { expect, it } from "vitest";
import { isExtensionRequest } from "./messages.js";

it("accepts only bounded media bridge messages", () => {
  expect(isExtensionRequest({ type: "CREATE_MEDIA_BRIDGE_SESSION" })).toBe(true);
  expect(
    isExtensionRequest({
      type: "REDEEM_MEDIA_BRIDGE_SESSION",
      token: "12345678-1234-1234-1234-123456789abc",
    }),
  ).toBe(true);
  expect(
    isExtensionRequest({ type: "REDEEM_MEDIA_BRIDGE_SESSION", token: "guess" }),
  ).toBe(false);
  expect(isExtensionRequest({ type: "GET_MEDIA_ANALYSIS_SETTINGS" })).toBe(false);
});
