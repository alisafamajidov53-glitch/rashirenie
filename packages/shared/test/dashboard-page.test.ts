import { describe, expect, it } from "vitest";
import {
  isExtensionRequest,
  readDashboardPageRequest,
  type DashboardPageRequest,
} from "../src/index.js";

describe("dashboard deep links", () => {
  it("validates the optional section of OPEN_OPTIONS_PAGE", () => {
    expect(isExtensionRequest({ type: "OPEN_OPTIONS_PAGE" })).toBe(true);
    expect(isExtensionRequest({ type: "OPEN_OPTIONS_PAGE", page: "planner" })).toBe(
      true,
    );
    expect(isExtensionRequest({ type: "OPEN_OPTIONS_PAGE", page: "admin" })).toBe(
      false,
    );
    expect(isExtensionRequest({ type: "OPEN_OPTIONS_PAGE", page: 3 })).toBe(false);
  });

  it("honours only a fresh, well-formed request", () => {
    const now = 1_000_000;
    const request = (page: string, at: number) =>
      ({ page, at }) as unknown as DashboardPageRequest;
    expect(readDashboardPageRequest(request("settings", now - 1_000), now)).toBe(
      "settings",
    );
    // An old request that nobody consumed must not hijack a later visit.
    expect(readDashboardPageRequest(request("settings", now - 60_000), now)).toBe(null);
    expect(readDashboardPageRequest(request("settings", now + 5_000), now)).toBe(null);
    expect(readDashboardPageRequest(request("nowhere", now), now)).toBe(null);
    expect(readDashboardPageRequest(undefined, now)).toBe(null);
    expect(readDashboardPageRequest("settings", now)).toBe(null);
  });
});
